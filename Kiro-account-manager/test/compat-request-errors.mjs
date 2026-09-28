import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const project = resolve('.')
const virtualFile = resolve(project, 'test/request-errors-bundle.cjs')
const compiled = await build({
    stdin: {
        contents: "export * from './src/main/proxy/kiroApi'; export * from './src/main/proxy/requestErrors'",
        resolveDir: project,
        loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    plugins: [{
        name: 'isolate-desktop-services',
        setup(builder) {
            builder.onResolve({ filter: /^(electron|\.\.\/kproxy|\.\/systemProxy|\.\/logger)$/ }, args => ({ path: args.path, namespace: 'stub' }))
            builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
                contents: args.path === './logger'
                    ? 'export const proxyLogger = new Proxy({}, { get() { return () => undefined } })'
                    : args.path === 'electron'
                        ? 'export const app = { getPath() { throw new Error("Unexpected desktop data access") } }'
                        : args.path === '../kproxy'
                            ? 'export function getKProxyService() { return undefined }; export function generateDeviceId() { return "fixture-device" }'
                            : 'export function getSystemProxy() { return null }; export function safeCreateProxyAgent() { return undefined }',
                loader: 'js'
            }))
        }
    }]
})
const module = new Module(virtualFile)
module.filename = virtualFile
module.paths = Module._nodeModulePaths(project)
module.require = createRequire(virtualFile)
module._compile(compiled.outputFiles[0].text, virtualFile)
const {
    buildKiroPayload,
    callKiroApiStream,
    setEnableTokenBufferReserve,
    setTokenBufferReserve,
    setPayloadSizeLimitKB,
    createKiroHttpError,
    getRequestErrorDetails,
    ContextLimitError,
    PayloadSizeLimitError,
    KiroHttpError
} = module.exports

function user(content, toolResults) {
    return { userInputMessage: { content, modelId: 'claude-sonnet-4.5', origin: 'AI_EDITOR', ...(toolResults ? { userInputMessageContext: { toolResults } } : {}) } }
}

function assistant(content, toolUses) {
    return { assistantResponseMessage: { content, ...(toolUses ? { toolUses } : {}) } }
}

function payload(history, options = {}, toolResults = [], tools = []) {
    return buildKiroPayload('current', 'claude-sonnet-4.5', 'AI_EDITOR', history, tools, toolResults, [], undefined, undefined, options)
}

const knownContext = createKiroHttpError(400, '{"reason":"CONTENT_LENGTH_EXCEEDS_THRESHOLD"}')
assert.ok(knownContext instanceof ContextLimitError)
assert.equal(getRequestErrorDetails(knownContext).code, 'context_length_exceeded')
assert.match(knownContext.message, /capability_rejected: prompt_too_long/)
for (const body of [
    '{"reason":"REQUEST_BODY_INVALID","message":"CONTENT_LENGTH_EXCEEDS_THRESHOLD"}',
    '{"message":"Mentioned CONTENT_LENGTH_EXCEEDS_THRESHOLD"}',
    'Request mentions CONTENT_LENGTH_EXCEEDS_THRESHOLD'
]) {
    const ordinary = createKiroHttpError(400, body)
    assert.ok(ordinary instanceof KiroHttpError)
    assert.equal(getRequestErrorDetails(ordinary).anthropicType, 'invalid_request_error')
}
assert.equal(getRequestErrorDetails(createKiroHttpError(413, '{}')).anthropicType, 'request_too_large')
assert.equal(getRequestErrorDetails(createKiroHttpError(401, '{}')).anthropicType, 'authentication_error')
assert.equal(getRequestErrorDetails(new Error('unknown')), undefined)

const toolUse = { toolUseId: 'current-tool', name: 'get_weather', input: {} }
const toolResult = { toolUseId: 'current-tool', content: [{ text: 'sunny' }], status: 'success' }
const tool = { toolSpecification: { name: 'get_weather', description: 'weather', inputSchema: { json: {} } } }
const systemMessages = [user('top system'), assistant('acknowledged')]
const history = [
    user('a'.repeat(100000)), assistant('first reply'),
    user('b'.repeat(100000)), assistant('calling tool', [toolUse])
]
try {
    setPayloadSizeLimitKB(153600)
    setTokenBufferReserve(150000)
    setEnableTokenBufferReserve(false)
    const unchanged = payload(history, { systemMessages }, [toolResult], [tool])
    assert.equal(unchanged.conversationState.history.length, systemMessages.length + history.length)

    setEnableTokenBufferReserve(true)
    const preserved = payload(history, { systemMessages, preserveHistory: true }, [toolResult], [tool])
    assert.equal(preserved.conversationState.history.length, systemMessages.length + history.length)
    const trimmed = payload(history, { systemMessages }, [toolResult], [tool])
    assert.deepEqual(trimmed.conversationState.history.slice(0, 2), systemMessages)
    assert.equal(trimmed.conversationState.history.at(-1).assistantResponseMessage.toolUses[0].toolUseId, toolUse.toolUseId)
    assert.equal(trimmed.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].toolUseId, toolUse.toolUseId)
    assert.match(trimmed.conversationState.history[2].userInputMessage.content, /Earlier conversation history was omitted/)
    assert.equal(trimmed.conversationState.history[2].userInputMessage.content.match(/Earlier conversation history was omitted/g).length, 1)

    // Without a system prefix, the current tool result still requires its assistant call.
    const noPrefix = payload(history, {}, [toolResult], [tool])
    assert.equal(noPrefix.conversationState.history.at(-1).assistantResponseMessage.toolUses[0].toolUseId, toolUse.toolUseId)
    assert.equal(noPrefix.conversationState.history[0].userInputMessage.userInputMessageContext?.toolResults, undefined)

    const oldResult = { toolUseId: 'old-tool', content: [{ text: 'old result' }], status: 'success' }
    const oldUse = { toolUseId: 'old-tool', name: 'get_weather', input: {} }
    const orphanCandidate = [
        user('x'.repeat(100000)), assistant('old call', [oldUse]), user('', [oldResult]), assistant('old done'),
        user('y'.repeat(100000)), assistant('current call', [toolUse])
    ]
    const noOrphan = payload(orphanCandidate, {}, [toolResult], [tool])
    assert.equal(noOrphan.conversationState.history[0].userInputMessage.userInputMessageContext?.toolResults, undefined)
    assert.equal(noOrphan.conversationState.history.at(-1).assistantResponseMessage.toolUses[0].toolUseId, toolUse.toolUseId)

    setPayloadSizeLimitKB(256)
    assert.doesNotThrow(() => payload([], {}, []))
    assert.throws(() => payload([], { systemMessages: [user('中'.repeat(90000)), assistant('ack')] }), PayloadSizeLimitError)

    setTokenBufferReserve(20000)
    const largeResult = { ...toolResult, content: [{ text: '中'.repeat(90000) }] }
    const byteHistory = [user('start'), assistant('calling tool', [toolUse]), user('', [largeResult]), assistant('done')]
    setEnableTokenBufferReserve(false)
    assert.throws(() => payload(byteHistory, {}, [], [tool]), PayloadSizeLimitError)
    setEnableTokenBufferReserve(true)
    assert.throws(() => payload(byteHistory, { preserveHistory: true }, [], [tool]), PayloadSizeLimitError)
    const shortened = payload(byteHistory, {}, [], [tool])
    assert.match(shortened.conversationState.history[2].userInputMessage.userInputMessageContext.toolResults[0].content[0].text, /Truncated by proxy/)
    const currentResultHistory = [user('start'), assistant('calling tool', [toolUse])]
    assert.throws(() => payload(currentResultHistory, {}, [largeResult], [tool]), PayloadSizeLimitError)

    // Account/profile changes can push a previously accepted payload over the limit.
    const nearLimit = payload([])
    const remaining = 256 * 1024 - Buffer.byteLength(JSON.stringify(nearLimit), 'utf8') - 100
    nearLimit.conversationState.currentMessage.userInputMessage.content += 'x'.repeat(remaining)
    const account = { id: 'fixture', accessToken: 'fixture', provider: 'BuilderId', profileArn: `arn:${'x'.repeat(1000)}` }
    const originalFetch = globalThis.fetch
    const proxyNames = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
    const originalProxies = Object.fromEntries(proxyNames.map(name => [name, process.env[name]]))
    let posted = false
    try {
        for (const name of proxyNames) delete process.env[name]
        globalThis.fetch = async url => {
            if (String(url).includes('/ListAvailableModels')) return Response.json({ models: [{ modelId: 'claude-sonnet-4.5', modelName: 'Claude Sonnet' }] })
            posted = true
            throw new Error(`Unexpected upstream request: ${url}`)
        }
        let finalError
        await callKiroApiStream(account, nearLimit, () => undefined, () => undefined, error => { finalError = error })
        assert.ok(finalError instanceof PayloadSizeLimitError)
        assert.equal(posted, false)
    } finally {
        globalThis.fetch = originalFetch
        for (const name of proxyNames) {
            if (originalProxies[name] === undefined) delete process.env[name]
            else process.env[name] = originalProxies[name]
        }
    }
} finally {
    setEnableTokenBufferReserve(false)
    setTokenBufferReserve(20000)
    setPayloadSizeLimitKB(153600)
}
console.log('compat-request-errors: passed')
