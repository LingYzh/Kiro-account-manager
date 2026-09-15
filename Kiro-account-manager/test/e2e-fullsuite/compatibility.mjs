/** Offline HTTP regression: real adapters and AWS event parser, synthetic upstream only. */
import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { build } from 'esbuild'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const virtualFile = resolve(project, 'test/compatibility-bundle.cjs')
const compiled = await build({
    stdin: {
        contents: "export { ProxyServer } from './src/main/proxy/proxyServer'; export { clearAllCaches, resolveKiroModel } from './src/main/proxy/kiroApi'",
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
                    ? 'export const proxyLogger = new Proxy({}, { get(_target, level) { return (...args) => console.log("fixture-proxy-log", level, ...args) } })'
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
const bundledModule = new Module(virtualFile)
bundledModule.filename = virtualFile
bundledModule.paths = Module._nodeModulePaths(project)
bundledModule.require = createRequire(virtualFile)
bundledModule._compile(compiled.outputFiles[0].text, virtualFile)
const { ProxyServer, clearAllCaches, resolveKiroModel } = bundledModule.exports

const rawFetch = globalThis.fetch
const output = console.log.bind(console)
const rawError = console.error
const rawWarn = console.warn
const traces = []
const logCalls = []
console.log = console.error = console.warn = (...args) => {
    if (args[0] === 'fixture-proxy-log') {
        logCalls.push({ level: args[1], category: args[2], message: args[3], data: args[4] })
    }
    traces.push(args.join(' '))
}
const models = [
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    'claude-sonnet-4', 'claude-sonnet-4.5', 'claude-opus-4.5', 'claude-haiku-4.5', 'claude-3.7-sonnet',
    'claude-opus-4.6', 'claude-opus-4.7', 'claude-opus-4.8', 'claude-opus-5',
    'claude-sonnet-4.6', 'claude-sonnet-5', 'auto', 'deepseek-3.2', 'minimax-m2.5', 'minimax-m2.1', 'glm-5', 'qwen3-coder-next'
].map(modelId => ({ modelId, modelName: modelId, description: modelId }))
const reasoningSchema = {
    type: 'object',
    properties: { reasoning: { type: 'object', properties: { effort: { type: 'string', enum: ['low', 'high'], default: 'low' } } } }
}
const requests = []
const metadataRequests = []
let upstreamMode = 'text'
let upstreamFrames
let releaseUpstream
let modelMetadata = models
let metadataMode = 'normal'
let proxy
let base
let checks = 0

// Independent bitwise fixture checksum, separate from the production decoder.
function fixtureCrc(bytes) {
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
}
assert.equal(fixtureCrc(Buffer.from('123456789')), 0xcbf43926)

function frame(type, data, extraHeaders = {}, rawPayload) {
    const header = Buffer.concat(Object.entries({ ':event-type': type, ':message-type': 'event', ...extraHeaders }).map(([key, val]) => {
        const name = Buffer.from(key)
        const value = Buffer.from(val)
        const encoded = Buffer.alloc(1 + name.length + 1 + 2 + value.length)
        encoded[0] = name.length
        name.copy(encoded, 1)
        encoded[1 + name.length] = 7
        encoded.writeUInt16BE(value.length, 2 + name.length)
        value.copy(encoded, 4 + name.length)
        return encoded
    }))
    const payload = rawPayload ?? Buffer.from(JSON.stringify(data))
    const result = Buffer.alloc(16 + header.length + payload.length)
    result.writeUInt32BE(result.length, 0)
    result.writeUInt32BE(header.length, 4)
    result.writeUInt32BE(fixtureCrc(result.subarray(0, 8)), 8)
    header.copy(result, 12)
    payload.copy(result, 12 + header.length)
    result.writeUInt32BE(fixtureCrc(result.subarray(0, -4)), result.length - 4)
    return result
}

globalThis.fetch = async function fixtureFetch(url, options = {}) {
    const address = String(url)
    if (address.startsWith('http://127.0.0.1:')) return rawFetch(url, options)
    if (address.endsWith('/ListAvailableProfiles')) return Response.json({ profiles: [{ arn: 'fixture-resolved-profile' }] })
    if (address.includes('/ListAvailableModels')) {
        metadataRequests.push({ url: address, authorization: options.headers.Authorization })
        if (metadataMode === 'failure') return Response.json({ error: 'unavailable' }, { status: 503 })
        if (metadataMode === 'slow') await new Promise(resolve => setTimeout(resolve, 30))
        return Response.json({ models: modelMetadata })
    }
    assert.ok(address.endsWith('/generateAssistantResponse'), `Unexpected external request: ${address}`)
    const payload = JSON.parse(options.body)
    requests.push({ payload, authorization: options.headers.Authorization })
    if (upstreamMode === 'failover' && options.headers.Authorization === 'Bearer fixture-a') {
        return Response.json({ reason: 'quota exhausted' }, { status: 402 })
    }
    const id = payload.conversationState.currentMessage.userInputMessage.modelId
    if (upstreamMode === 'invalid' || id === 'unknown-future-model') {
        return Response.json({ reason: 'INVALID_MODEL_ID' }, { status: 400 })
    }
    const text = ['Hello', ' ', 'fixture'].map(content => frame('assistantResponseEvent', { content }))
    const tool = frame('toolUseEvent', { toolUseId: 'call_fixture', name: 'get_weather', input: { city: 'Paris' }, stop: true })
    const signatureBefore = frame('reasoningContentEvent', { signature: 'sig-before-text' })
    const signatureAfter = frame('reasoningContentEvent', { signature: 'sig-after-text' })
    const thinking = frame('reasoningContentEvent', { text: 'Private reasoning.', signature: 'sig-thinking' })
    const redacted = frame('reasoningContentEvent', { redactedContent: 'opaque-secret' })
    const chunks = upstreamMode === 'tool'
        ? [...text, tool]
        : upstreamMode === 'claude-signature-only'
            ? [signatureBefore, ...text, signatureAfter]
            : upstreamMode === 'claude-thinking'
                ? [thinking, ...text]
                : upstreamMode === 'claude-redacted'
                    ? [redacted, ...text]
                    : text
    return new Response(new ReadableStream({
        start(controller) {
            for (const chunk of upstreamFrames ?? chunks) controller.enqueue(chunk)
            if (upstreamMode === 'interrupted') {
                setTimeout(() => controller.error(new Error('upstream 503 interrupted')), 30)
            } else if (upstreamMode === 'gated') {
                releaseUpstream = () => {
                    releaseUpstream = undefined
                    try {
                        controller.close()
                    } catch {
                        // A cancelled client may already have cancelled the synthetic source.
                    }
                }
            } else {
                controller.close()
            }
        }
    }))
}

async function start(accounts = ['a']) {
    if (proxy) await proxy.stop(0)
    clearAllCaches()
    proxy = new ProxyServer({ port: 0, logRequests: false, maxRetries: 3, retryDelayMs: 1 })
    for (const id of accounts) proxy.getAccountPool().addAccount({ id, accessToken: `fixture-${id}`, profileArn: `profile-${id}`, region: 'us-east-1' })
    await proxy.start()
    base = `http://127.0.0.1:${proxy.server.address().port}`
}

async function post(path, body) {
    const response = await rawFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
    })
    const text = await response.text()
    return { status: response.status, text, json: body.stream ? undefined : JSON.parse(text) }
}

function events(text) {
    return text.split('\n\n').filter(Boolean).map(block => {
        const data = block.split('\n').find(line => line.startsWith('data: '))?.slice(6)
        return data && data !== '[DONE]' ? JSON.parse(data) : undefined
    }).filter(Boolean)
}

async function waitForLog(predicate, description, timeoutMs = 3000) {
    const startedAt = Date.now()
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${description}`)
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

function assertClaudeStreamLifecycle(stream, expected = {}) {
    const starts = stream.filter(event => event.type === 'content_block_start')
    const stops = stream.filter(event => event.type === 'content_block_stop')
    const startIndices = starts.map(event => event.index)
    assert.equal(new Set(startIndices).size, startIndices.length, 'content block indexes must be unique')
    assert.deepEqual(stops.map(event => event.index), startIndices, 'every content block must stop exactly once')

    for (const event of stream.filter(item => item.type === 'content_block_delta')) {
        assert.ok(startIndices.includes(event.index), `delta index ${event.index} must refer to a started block`)
    }

    const text = stream
        .filter(event => event.delta?.type === 'text_delta')
        .map(event => event.delta.text)
        .join('')
    assert.equal(text, expected.text ?? 'Hello fixture')

    const thinkingBlocks = starts.filter(event => event.content_block?.type === 'thinking')
    const thinkingDeltas = stream.filter(event => event.delta?.type === 'thinking_delta')
    const signatureDeltas = stream.filter(event => event.delta?.type === 'signature_delta')
    if (expected.thinking === undefined) {
        assert.equal(thinkingBlocks.length, 0, 'signature-only metadata must not open an empty thinking block')
        assert.equal(thinkingDeltas.length, 0)
        assert.equal(signatureDeltas.length, 0)
    } else {
        assert.equal(thinkingBlocks.length, 1)
        assert.equal(thinkingDeltas.map(event => event.delta.thinking).join(''), expected.thinking)
        assert.deepEqual(signatureDeltas.map(event => event.delta.signature), [expected.signature])
        assert.equal(signatureDeltas[0].index, thinkingBlocks[0].index)
    }

    const redactedBlocks = starts.filter(event => event.content_block?.type === 'redacted_thinking')
    if (expected.redacted === undefined) {
        assert.equal(redactedBlocks.length, 0)
    } else {
        assert.deepEqual(redactedBlocks.map(event => event.content_block.data), [expected.redacted])
    }

    const messageDeltas = stream.filter(event => event.type === 'message_delta')
    const messageStops = stream.filter(event => event.type === 'message_stop')
    assert.equal(messageDeltas.length, 1)
    assert.equal(messageDeltas[0].delta.stop_reason, 'end_turn')
    assert.equal(messageStops.length, 1)
    assert.equal(stream.at(-1).type, 'message_stop', 'message_stop must be the final event')
}

async function check(name, action) {
    try {
        await action()
        checks++
        output(`PASS ${name}`)
    } catch (error) {
        output(traces.slice(-20).join('\n'))
        throw error
    }
}

try {
    await start()
    await check('model matrix resolves without implicit family substitution', async () => {
        for (const model of models) {
            const result = await post('/v1/chat/completions', { model: model.modelId, messages: [{ role: 'user', content: 'hello' }], thinking: { type: 'enabled' }, reasoning_effort: 'high' })
            assert.equal(result.status, 200, result.text)
            assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, model.modelId)
            assert.equal(Object.hasOwn(requests.at(-1).payload, 'additionalModelRequestFields'), false)
        }
        assert.equal(metadataRequests.length, 1, 'cold request loads and reuses metadata without /v1/models')
    })
    await check('Claude legacy aliases strip unsupported thinking and effort', async () => {
        for (const [alias, id] of [['claude-sonnet-4.0', 'claude-sonnet-4'], ['claude-sonnet-4-5-20250929', 'claude-sonnet-4.5'], ['claude-opus-4-5', 'claude-opus-4.5'], ['claude-haiku-4-5', 'claude-haiku-4.5']]) {
            const result = await post('/v1/messages', { model: alias, max_tokens: 100, messages: [{ role: 'user', content: 'hello' }], thinking: { type: 'enabled', budget_tokens: 16000 }, output_config: { effort: 'high' } })
            assert.equal(result.status, 200, result.text)
            assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, id)
            assert.equal(Object.hasOwn(requests.at(-1).payload, 'additionalModelRequestFields'), false)
        }
    })
    await check('unknown model is sent unchanged and fatal 400 is not retried', async () => {
        const before = requests.length
        const result = await post('/v1/chat/completions', { model: 'unknown-future-model', messages: [{ role: 'user', content: 'hello' }] })
        assert.equal(result.status, 400, result.text)
        assert.equal(requests.length - before, 1)
        assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, 'unknown-future-model')
    })
    await check('Responses flat function tools survive conversion and output retains text plus call', async () => {
        upstreamMode = 'tool'
        const result = await post('/v1/responses', { model: 'gpt-5.6-sol', input: 'weather', tools: [{ type: 'function', name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }] })
        assert.equal(result.status, 200, result.text)
        assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools.length, 1)
        assert.ok(result.json.output.some(item => item.type === 'message'))
        assert.ok(result.json.output.some(item => item.type === 'function_call' && item.call_id === 'call_fixture'))
    })
    await check('Responses tool-result history reaches Kiro', async () => {
        upstreamMode = 'text'
        const result = await post('/v1/responses', { model: 'gpt-5.6-terra', tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }], input: [
            { role: 'user', content: 'weather' },
            { type: 'function_call', call_id: 'call_fixture', name: 'get_weather', arguments: '{"city":"Paris"}' },
            { type: 'function_call_output', call_id: 'call_fixture', output: 'sunny' }
        ] })
        assert.equal(result.status, 200, result.text)
        const context = requests.at(-1).payload.conversationState.currentMessage.userInputMessage.userInputMessageContext
        assert.equal(context.toolResults[0].toolUseId, 'call_fixture')
    })
    await check('Responses streaming lifecycle and function call IDs', async () => {
        upstreamMode = 'tool'
        const result = await post('/v1/responses', { model: 'gpt-5.6-luna', input: 'weather', stream: true, tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }] })
        assert.equal(result.status, 200, result.text)
        const stream = events(result.text)
        for (const type of ['response.created', 'response.in_progress', 'response.output_text.delta', 'response.function_call_arguments.delta', 'response.completed']) assert.ok(stream.some(event => event.type === type), type)
        assert.equal(stream.at(-1).response.status, 'completed')
        assert.ok(stream.at(-1).response.output.some(item => item.call_id === 'call_fixture'))
        assert.deepEqual(stream.map(event => event.sequence_number), stream.map((_, index) => index))
    })
    await check('Chat Completions streaming preserves spaces and tool calls', async () => {
        upstreamMode = 'tool'
        const result = await post('/v1/chat/completions', { model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'hello' }], stream: true })
        const stream = events(result.text)
        assert.equal(stream.map(event => event.choices?.[0]?.delta?.content || '').join(''), 'Hello fixture')
        assert.ok(stream.some(event => event.choices?.[0]?.delta?.tool_calls?.[0]?.id === 'call_fixture'))
        assert.ok(result.text.endsWith('data: [DONE]\n\n'))
    })
    await check('legacy Claude streaming preserves text and omits unsupported fields', async () => {
        upstreamMode = 'text'
        const result = await post('/v1/messages', { model: 'claude-sonnet-4.5', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100, stream: true, thinking: { type: 'enabled', budget_tokens: 1024 } })
        const stream = events(result.text)
        assert.equal(stream.filter(event => event.delta?.type === 'text_delta').map(event => event.delta.text).join(''), 'Hello fixture')
        assert.equal(stream.at(-1).type, 'message_stop')
        assert.equal(Object.hasOwn(requests.at(-1).payload, 'additionalModelRequestFields'), false)
    })
    await check('Claude signature-only events before and after text do not create empty thinking blocks', async () => {
        upstreamMode = 'claude-signature-only'
        const streamed = await post('/v1/messages', { model: 'claude-sonnet-4.5', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100, stream: true })
        assert.equal(streamed.status, 200, streamed.text)
        assertClaudeStreamLifecycle(events(streamed.text))

        const completed = await post('/v1/messages', { model: 'claude-sonnet-4.5', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 })
        assert.equal(completed.status, 200, completed.text)
        assert.deepEqual(completed.json.content, [{ type: 'text', text: 'Hello fixture' }])
        assert.equal(completed.json.stop_reason, 'end_turn')
    })
    await check('Claude thinking signatures and redacted thinking have valid stream blocks', async () => {
        upstreamMode = 'claude-thinking'
        const thinking = await post('/v1/messages', { model: 'claude-sonnet-4.5', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100, stream: true })
        assert.equal(thinking.status, 200, thinking.text)
        assertClaudeStreamLifecycle(events(thinking.text), { thinking: 'Private reasoning.', signature: 'sig-thinking' })

        upstreamMode = 'claude-redacted'
        const redacted = await post('/v1/messages', { model: 'claude-sonnet-4.5', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100, stream: true })
        assert.equal(redacted.status, 200, redacted.text)
        assertClaudeStreamLifecycle(events(redacted.text), { redacted: 'opaque-secret' })
    })
    await check('supported reasoning schema is loaded on first request; account caches are isolated', async () => {
        upstreamMode = 'text'
        modelMetadata = [{ ...models[0], additionalModelRequestFieldsSchema: reasoningSchema }]
        await start(['b'])
        const result = await post('/v1/responses', { model: 'gpt-5.6-sol', input: 'hello', reasoning: { effort: 'high' } })
        assert.equal(result.status, 200, result.text)
        assert.deepEqual(requests.at(-1).payload.additionalModelRequestFields, { reasoning: { effort: 'high' } })
        modelMetadata = models
        const resolved = await resolveKiroModel({ id: 'c', accessToken: 'fixture-c', profileArn: 'profile-c', region: 'eu-west-1' }, 'gpt-5.6-sol')
        assert.equal(resolved.model.additionalModelRequestFieldsSchema, undefined)
        assert.ok(metadataRequests.at(-1).url.includes('q.eu-central-1.amazonaws.com'))
    })
    await check('model mapping reasoning defaults respect explicit controls, metadata, and API key scope', async () => {
        const previousMappings = proxy.config.modelMappings
        const previousModelMetadata = modelMetadata
        const previousUpstreamMode = upstreamMode
        const modelMapping = {
            id: 'fixture',
            name: 'fixture',
            enabled: true,
            type: 'replace',
            sourceModel: 'claude-haiku-*',
            targetModels: ['gpt-5.6-luna'],
            priority: 0,
            defaultReasoningEffort: 'high'
        }

        try {
            upstreamMode = 'text'
            modelMetadata = [{ ...models.find(model => model.modelId === 'gpt-5.6-luna'), additionalModelRequestFieldsSchema: reasoningSchema }]
            clearAllCaches()
            proxy.updateConfig({ modelMappings: [modelMapping] })

            const claudeDefault = await post('/v1/messages', { model: 'claude-haiku-4.5', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] })
            assert.equal(claudeDefault.status, 200, claudeDefault.text)
            assert.deepEqual(requests.at(-1).payload.additionalModelRequestFields, { reasoning: { effort: 'high' } })

            const claudeExplicitLow = await post('/v1/messages', { model: 'claude-haiku-4.5', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }], output_config: { effort: 'low' } })
            assert.equal(claudeExplicitLow.status, 200, claudeExplicitLow.text)
            assert.deepEqual(requests.at(-1).payload.additionalModelRequestFields, { reasoning: { effort: 'low' } })

            const claudeDisabled = await post('/v1/messages', { model: 'claude-haiku-4.5', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }], thinking: { type: 'disabled' } })
            assert.equal(claudeDisabled.status, 200, claudeDisabled.text)
            assert.equal(Object.hasOwn(requests.at(-1).payload, 'additionalModelRequestFields'), false)

            const chatDefault = await post('/v1/chat/completions', { model: 'claude-haiku-4.5', messages: [{ role: 'user', content: 'hello' }] })
            assert.equal(chatDefault.status, 200, chatDefault.text)
            assert.deepEqual(requests.at(-1).payload.additionalModelRequestFields, { reasoning: { effort: 'high' } })

            const chatExplicitLow = await post('/v1/chat/completions', { model: 'claude-haiku-4.5', messages: [{ role: 'user', content: 'hello' }], reasoning_effort: 'low' })
            assert.equal(chatExplicitLow.status, 200, chatExplicitLow.text)
            assert.deepEqual(requests.at(-1).payload.additionalModelRequestFields, { reasoning: { effort: 'low' } })

            const responsesDefault = await post('/v1/responses', { model: 'claude-haiku-4.5', input: 'hello' })
            assert.equal(responsesDefault.status, 200, responsesDefault.text)
            assert.deepEqual(requests.at(-1).payload.additionalModelRequestFields, { reasoning: { effort: 'high' } })

            const responsesExplicitLow = await post('/v1/responses', { model: 'claude-haiku-4.5', input: 'hello', reasoning: { effort: 'low' } })
            assert.equal(responsesExplicitLow.status, 200, responsesExplicitLow.text)
            assert.deepEqual(requests.at(-1).payload.additionalModelRequestFields, { reasoning: { effort: 'low' } })

            modelMetadata = models
            clearAllCaches()
            const unsupported = await post('/v1/chat/completions', { model: 'claude-haiku-4.5', messages: [{ role: 'user', content: 'hello' }] })
            assert.equal(unsupported.status, 200, unsupported.text)
            assert.equal(Object.hasOwn(requests.at(-1).payload, 'additionalModelRequestFields'), false)

            proxy.updateConfig({ modelMappings: [{ ...modelMapping, apiKeyIds: ['some-key'] }] })
            const unmappedRequest = {}
            assert.equal(proxy.applyModelMapping('claude-haiku-4.5', undefined, unmappedRequest), 'claude-haiku-4.5')
            assert.deepEqual(unmappedRequest, {}, 'an API-key-scoped mapping must not match without a request key')
        } finally {
            proxy.updateConfig({ modelMappings: previousMappings })
            modelMetadata = previousModelMetadata
            upstreamMode = previousUpstreamMode
            clearAllCaches()
        }
    })
    await check('Responses streams text before upstream finishes', async () => {
        upstreamMode = 'gated'
        await start()
        const response = await rawFetch(`${base}/v1/responses`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-5.6-sol', input: 'hello', stream: true }),
            signal: AbortSignal.timeout(10000)
        })
        const reader = response.body.getReader()
        let received = ''
        while (!received.includes('response.output_text.delta')) {
            const { value, done } = await reader.read()
            assert.equal(done, false)
            received += new TextDecoder().decode(value)
        }
        assert.equal(received.includes('response.completed'), false)
        releaseUpstream()
        while (true) {
            const { value, done } = await reader.read()
            if (done) break
            received += new TextDecoder().decode(value)
        }
        assert.ok(received.includes('response.completed'))
    })
    await check('Claude diagnostics correlate concurrent requests without logging tool contents', async () => {
        const previousLogRequests = proxy.config.logRequests
        const previousUpstreamMode = upstreamMode
        const logStart = logCalls.length
        const continuation = suffix => ({
            model: 'claude-sonnet-4.5',
            max_tokens: 100,
            stream: true,
            tools: [{ name: 'get_weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
            messages: [
                { role: 'user', content: 'Get weather.' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Calling tool.' },
                        { type: 'tool_use', id: `history-${suffix}`, name: 'get_weather', input: { city: `TOOL_ARGUMENT_SECRET_${suffix}` } }
                    ]
                },
                {
                    role: 'user',
                    content: [
                        { type: 'tool_result', tool_use_id: `history-${suffix}`, is_error: true, content: `TOOL_RESULT_SECRET_${suffix}` },
                        { type: 'text', text: `FOLLOWUP_SECRET_${suffix}` }
                    ]
                }
            ]
        })

        try {
            proxy.updateConfig({ logRequests: true })
            upstreamMode = 'tool'
            const results = await Promise.all([
                post('/v1/messages', continuation('first')),
                post('/v1/messages', continuation('second'))
            ])
            for (const result of results) assert.equal(result.status, 200, result.text)
            for (const attempt of requests.slice(-2)) {
                assert.equal(attempt.payload.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].status, 'error')
            }

            await waitForLog(
                () => logCalls.slice(logStart).filter(call => call.message === 'HTTP response finished').length === 2,
                'two completed HTTP responses'
            )
            const recent = logCalls.slice(logStart).filter(call => call.category === 'ProxyServer' && call.data?.requestId)
            const requestEvents = recent.filter(call => call.message === 'Claude request received')
            const requestIds = [...new Set(requestEvents.map(call => call.data.requestId))]
            assert.equal(requestEvents.length, 2)
            assert.equal(requestIds.length, 2, 'concurrent requests must keep distinct diagnostic IDs')

            for (const requestEvent of requestEvents) {
                const requestId = requestEvent.data.requestId
                const suffix = requestEvent.data.lastMessageBlocks[0].toolUseId.slice('history-'.length)
                assert.deepEqual(requestEvent.data.lastMessageBlocks, [
                    { type: 'tool_result', toolUseId: `history-${suffix}`, isError: true },
                    { type: 'text' }
                ])

                const forRequest = recent.filter(call => call.data.requestId === requestId)
                const toolEmitted = forRequest.filter(call => call.message === 'Claude tool emitted')
                const completed = forRequest.filter(call => call.message === 'Claude response completed')
                const finished = forRequest.filter(call => call.message === 'HTTP response finished')
                assert.equal(toolEmitted.length, 1)
                assert.equal(completed.length, 1)
                assert.equal(finished.length, 1)
                assert.equal(toolEmitted[0].data.requestId, completed[0].data.requestId)
                assert.equal(completed[0].data.requestId, finished[0].data.requestId)
                assert.equal(toolEmitted[0].data.messageId, completed[0].data.messageId)
                assert.equal(toolEmitted[0].data.toolUseId, 'call_fixture')
                assert.equal(toolEmitted[0].data.name, 'get_weather')
                assert.ok(completed[0].data.blockTypes.includes('text'))
                assert.ok(completed[0].data.blockTypes.includes('tool_use'))
                assert.equal(completed[0].data.stopReason, 'tool_use')
                assert.equal(finished[0].data.path, '/v1/messages')
                assert.equal(finished[0].data.status, 200)
                assert.equal(Object.hasOwn(finished[0].data, 'messageId'), false, 'HTTP completion must stay distinct from adapter completion')
                assert.equal(Object.hasOwn(finished[0].data, 'blockTypes'), false)

                const toolIndex = recent.indexOf(toolEmitted[0])
                const completedIndex = recent.indexOf(completed[0])
                const finishedIndex = recent.indexOf(finished[0])
                assert.ok(toolIndex < completedIndex && completedIndex < finishedIndex)

                const serializedMilestones = JSON.stringify(forRequest.map(call => ({ message: call.message, data: call.data })))
                for (const secret of [`TOOL_ARGUMENT_SECRET_${suffix}`, `TOOL_RESULT_SECRET_${suffix}`, `FOLLOWUP_SECRET_${suffix}`]) {
                    assert.equal(serializedMilestones.includes(secret), false, `${secret} must not appear in request diagnostics`)
                }
            }
        } finally {
            proxy.updateConfig({ logRequests: previousLogRequests })
            upstreamMode = previousUpstreamMode
        }
    })
    await check('Claude client cancellation logs closed-before-finish without a false finish', async () => {
        const previousLogRequests = proxy.config.logRequests
        const previousUpstreamMode = upstreamMode
        const previousReleaseUpstream = releaseUpstream
        const logStart = logCalls.length
        const aborter = new AbortController()
        let reader

        try {
            proxy.updateConfig({ logRequests: true })
            upstreamMode = 'gated'
            const response = await rawFetch(`${base}/v1/messages`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: 'claude-sonnet-4.5', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }], stream: true }),
                signal: aborter.signal
            })
            assert.equal(response.status, 200)
            reader = response.body.getReader()
            let received = ''
            while (!received.includes('content_block_delta')) {
                const { value, done } = await reader.read()
                assert.equal(done, false)
                received += new TextDecoder().decode(value)
            }

            aborter.abort(new Error('fixture client cancelled response'))
            try {
                await reader.cancel()
            } catch {
                // The fetch abort may already have cancelled the response stream.
            }
            await waitForLog(
                () => logCalls.slice(logStart).some(call => call.message === 'HTTP response closed before finish'),
                'HTTP response close before finish'
            )

            const recent = logCalls.slice(logStart).filter(call => call.category === 'ProxyServer' && call.data?.requestId)
            const closed = recent.filter(call => call.message === 'HTTP response closed before finish')
            assert.equal(closed.length, 1)
            const requestId = closed[0].data.requestId
            assert.equal(closed[0].data.path, '/v1/messages')
            assert.equal(recent.filter(call => call.message === 'Claude request received' && call.data.requestId === requestId).length, 1)
            assert.equal(recent.filter(call => call.message === 'HTTP response finished' && call.data.requestId === requestId).length, 0)
            assert.equal(recent.filter(call => call.message === 'Claude response completed' && call.data.requestId === requestId).length, 0)
        } finally {
            aborter.abort()
            if (reader) {
                try {
                    await reader.cancel()
                } catch {
                    // The response may already be cancelled.
                }
            }
            const release = releaseUpstream
            releaseUpstream = undefined
            release?.()
            proxy.updateConfig({ logRequests: previousLogRequests })
            upstreamMode = previousUpstreamMode
            if (previousReleaseUpstream) {
                releaseUpstream = previousReleaseUpstream
            }
        }
    })
    await check('directory failure keeps model ID and omits optional reasoning', async () => {
        metadataMode = 'failure'
        upstreamMode = 'text'
        await start()
        const result = await post('/v1/chat/completions', { model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'hello' }], thinking: { type: 'adaptive' }, reasoning_effort: 'high' })
        assert.equal(result.status, 200, result.text)
        assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, 'gpt-5.6-sol')
        assert.equal(Object.hasOwn(requests.at(-1).payload, 'additionalModelRequestFields'), false)
        metadataMode = 'normal'
    })
    await check('concurrent model lookup shares metadata; cancelling one client leaves the other intact', async () => {
        metadataMode = 'slow'
        clearAllCaches()
        const account = { id: 'shared', accessToken: 'fixture-shared', profileArn: 'shared-profile', region: 'us-east-1' }
        const before = metadataRequests.length
        const aborter = new AbortController()
        const cancelled = resolveKiroModel(account, 'gpt-5.6-sol', aborter.signal)
        const remaining = resolveKiroModel(account, 'gpt-5.6-sol')
        aborter.abort(new Error('fixture cancelled'))
        await assert.rejects(cancelled, /fixture cancelled/)
        assert.equal((await remaining).modelId, 'gpt-5.6-sol')
        assert.equal(metadataRequests.length - before, 1)
        metadataMode = 'normal'
    })
    await check('resolved Enterprise profile is not cached under the old fallback profile', async () => {
        clearAllCaches()
        const account = { id: 'enterprise', provider: 'Enterprise', accessToken: 'fixture-enterprise', region: 'us-east-1' }
        const before = metadataRequests.length
        await resolveKiroModel(account, 'gpt-5.6-sol')
        assert.equal(account.profileArn, 'fixture-resolved-profile')
        await resolveKiroModel(account, 'gpt-5.6-sol')
        assert.equal(metadataRequests.length - before, 1)
        const unresolvedCopy = { ...account, profileArn: undefined }
        await resolveKiroModel(unresolvedCopy, 'gpt-5.6-sol')
        assert.equal(unresolvedCopy.profileArn, 'fixture-resolved-profile')
        assert.equal(metadataRequests.length - before, 2)
    })
    await check('Responses retries before first delta without dropping tools', async () => {
        upstreamMode = 'failover'
        await start(['a', 'b'])
        const before = requests.length
        const result = await post('/v1/responses', { model: 'gpt-5.6-sol', input: 'hello', stream: true, tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }] })
        const stream = events(result.text)
        assert.equal(stream.at(-1).type, 'response.completed', result.text)
        assert.equal(stream.filter(event => event.type === 'response.output_text.delta').map(event => event.delta).join(''), 'Hello fixture')
        const attempts = requests.slice(before)
        assert.equal(attempts.at(-1).authorization, 'Bearer fixture-b')
        assert.ok(attempts.every(attempt => attempt.payload.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools.length === 1))
    })
    await check('Responses fails once after output and never replays another account', async () => {
        upstreamMode = 'interrupted'
        await start(['a', 'b'])
        const before = requests.length
        const result = await post('/v1/responses', { model: 'gpt-5.6-sol', input: 'hello', stream: true })
        const stream = events(result.text)
        assert.equal(requests.length - before, 1)
        assert.equal(stream.filter(event => event.type === 'response.failed').length, 1)
        assert.equal(stream.at(-1).type, 'response.failed')
        assert.equal(stream.some(event => event.type === 'response.completed'), false)
        assert.equal(stream.at(-1).response.id, stream[0].response.id)
    })
    await check('corrupt upstream streams fail without completing or executing malformed tools', async () => {
        upstreamMode = 'text'
        const validText = frame('assistantResponseEvent', { content: 'prefix' })
        const badCrc = Buffer.from(validText)
        badCrc[badCrc.length - 1] ^= 1
        const pendingTool = { toolUseId: 'bad-call', name: 'get_weather', input: '{"city":' }
        const cases = [
            [],
            [badCrc],
            [validText, validText.subarray(0, -1)],
            [Buffer.alloc(16)],
            [frame('assistantResponseEvent', {}, {}, Buffer.from('{bad'))],
            [frame('assistantResponseEvent', {}, {}, Buffer.from([0xff]))],
            [frame('exception', { message: 'failure' }, { ':message-type': 'exception', ':exception-type': 'InternalServerException' })],
            [frame('error', {}, { ':message-type': 'error', ':error-code': 'InternalFailure' })],
            [frame('invalidStateEvent', { reason: 'INVALID_STATE', message: 'fixture' })],
            [frame('toolUseEvent', { ...pendingTool, stop: true })],
            [frame('toolUseEvent', pendingTool)],
            [frame('toolUseEvent', pendingTool), frame('toolUseEvent', { toolUseId: 'next', name: 'get_weather', input: {}, stop: true })],
            [frame('toolUseEvent', { ...pendingTool, input: 'null', stop: true })]
        ]
        try {
            for (const chunks of cases) {
                await start()
                upstreamFrames = chunks
                const before = requests.length
                const claude = await post('/v1/messages', { model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100, stream: true })
                const stream = events(claude.text)
                assert.equal(stream.at(-1).type, 'error', claude.text)
                assert.equal(stream.filter(event => event.type === 'error').length, 1)
                assert.equal(stream.some(event => event.type === 'message_stop' || event.content_block?.type === 'tool_use'), false)
                assert.equal(requests.length - before, 1)
            }
            // All three protocols must retain the failure after partial output.
            upstreamFrames = [validText, badCrc]
            for (const path of ['/v1/responses', '/v1/chat/completions']) {
                await start()
                const before = requests.length
                const result = await post(path, { model: 'gpt-5.6-luna', input: 'hello', messages: [{ role: 'user', content: 'hello' }], stream: true })
                const stream = events(result.text)
                assert.equal(requests.length - before, 1)
                if (path === '/v1/responses') {
                    assert.equal(stream.at(-1).type, 'response.failed')
                    assert.equal(stream.some(event => event.type === 'response.completed'), false)
                } else {
                    assert.ok(stream.at(-1).error)
                    assert.equal(result.text.includes('[DONE]'), false)
                }
            }
            const nonstream = await post('/v1/messages', { model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 })
            assert.ok(nonstream.status >= 400)
            assert.ok(nonstream.json.error)
        } finally {
            upstreamFrames = undefined
        }
    })
    await check('valid split frames and complete tool arguments without stop stay compatible', async () => {
        upstreamMode = 'text'
        const tool = frame('toolUseEvent', { toolUseId: 'complete-call', name: 'get_weather', input: '{"city":"Paris"}' })
        const text = frame('assistantResponseEvent', { content: 'split text' })
        try {
            upstreamFrames = [text.subarray(0, 5), text.subarray(5, 14), Buffer.concat([text.subarray(14), tool])]
            const result = await post('/v1/messages', { model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100, stream: true })
            const stream = events(result.text)
            assert.equal(stream.at(-1).type, 'message_stop')
            assert.equal(stream.find(event => event.delta?.type === 'input_json_delta').delta.partial_json, '{"city":"Paris"}')
            assert.equal(stream.find(event => event.type === 'message_delta').delta.stop_reason, 'tool_use')
        } finally {
            upstreamFrames = undefined
        }
    })
    await check('parallel tool results follow call order and retain failure status', async () => {
        upstreamMode = 'text'
        const result = await post('/v1/messages', {
            model: 'claude-haiku-4.5', max_tokens: 100,
            tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
            messages: [
                { role: 'user', content: 'weather' },
                { role: 'assistant', content: [
                    { type: 'tool_use', id: 'first-call', name: 'get_weather', input: {} },
                    { type: 'tool_use', id: 'second-call', name: 'get_weather', input: {} }
                ] },
                { role: 'user', content: [
                    { type: 'tool_result', tool_use_id: 'second-call', content: 'failure', is_error: true },
                    { type: 'tool_result', tool_use_id: 'first-call', content: 'sunny' }
                ] }
            ]
        })
        assert.equal(result.status, 200, result.text)
        const results = requests.at(-1).payload.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults
        assert.deepEqual(results.map(item => [item.toolUseId, item.status, item.content[0].text]), [
            ['first-call', 'success', 'sunny'], ['second-call', 'error', 'failure']
        ])
    })
    output(`Compatibility HTTP checks passed: ${checks}`)
} finally {
    if (proxy) await proxy.stop(0)
    globalThis.fetch = rawFetch
    console.log = output
    console.error = rawError
    console.warn = rawWarn
}
