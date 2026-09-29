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
        contents: "export { ProxyServer } from './src/main/proxy/proxyServer'; export { clearAllCaches, resolveKiroModel, setPayloadSizeLimitKB, setEnableTokenBufferReserve, setTokenBufferReserve, setModelContextWindow } from './src/main/proxy/kiroApi'",
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
const { ProxyServer, clearAllCaches, resolveKiroModel, setPayloadSizeLimitKB, setEnableTokenBufferReserve, setTokenBufferReserve, setModelContextWindow } = bundledModule.exports

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
    if (upstreamMode === 'prompt-too-long') {
        return Response.json({ reason: 'CONTENT_LENGTH_EXCEEDS_THRESHOLD', message: 'Input is too long.' }, { status: 400 })
    }
    if (upstreamMode === 'payload-too-large') {
        return Response.json({ reason: 'PAYLOAD_TOO_LARGE', message: 'Request entity is too large.' }, { status: 413 })
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
    // Windows can allocate an ephemeral port that Fetch forbids (for example
    // 6000 or 6667). Probe /health and retry only that specific allocation.
    for (let attempt = 0; attempt < 20; attempt++) {
        proxy = new ProxyServer({ port: 0, logRequests: false, maxRetries: 3, retryDelayMs: 1 })
        for (const id of accounts) proxy.getAccountPool().addAccount({ id, accessToken: `fixture-${id}`, profileArn: `profile-${id}`, region: 'us-east-1' })
        await proxy.start()
        base = `http://127.0.0.1:${proxy.server.address().port}`
        try {
            const probe = await rawFetch(`${base}/health`, { signal: AbortSignal.timeout(3000) })
            assert.equal(probe.status, 200, 'fixture health check')
            return
        } catch (error) {
            if (error?.cause?.message !== 'bad port') throw error
            await proxy.stop(0)
        }
    }
    throw new Error('Could not allocate a Fetch-compatible fixture port')
}

async function post(path, body, headers = {}) {
    const response = await rawFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
    })
    const text = await response.text()
    const contentType = response.headers.get('content-type') || ''
    const json = contentType.includes('application/json') ? JSON.parse(text) : undefined
    return { status: response.status, text, json, headers: response.headers }
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
    await check('Desktop uses current Claude identity and isolates non-Claude tier routes', async () => {
        const routes = { routes: [
            { id: 'claude-opus-4-6', family: 'opus', label: 'Opus', modelId: 'claude-opus-4.8' },
            { id: 'claude-sonnet-4-6', family: 'sonnet', label: 'GPT', modelId: 'gpt-5.6-sol' }
        ], defaultRouteId: 'claude-opus-4-6' }
        proxy.events.getDesktopRoutes = async () => routes
        try {
            proxy.updateConfig({ apiKey: 'fixture-desktop-secret' })
            assert.equal((await rawFetch(`${base}/claude-desktop/v1/models`)).status, 401)
            assert.equal((await rawFetch(`${base}/claude-desktop/v1/models`, { headers: { Authorization: 'Bearer fixture-desktop-secret' } })).status, 200)
            proxy.updateConfig({ apiKey: '' })
            const listing = await (await rawFetch(`${base}/claude-desktop/v1/models`)).json()
            assert.deepEqual(listing.data.map(model => model.id), ['claude-opus-4-8', 'claude-sonnet-4-6'])
            for (const [model, target] of [['claude-opus-4-8', 'claude-opus-4.8'], ['claude-sonnet-4-6', 'gpt-5.6-sol']]) {
                for (const stream of [false, true]) {
                    const result = await post('/claude-desktop/v1/messages', { model, stream, max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] })
                    assert.equal(result.status, 200, result.text)
                    assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, target)
                    if (stream) assert.ok(result.text.includes(`"model":"${model}"`))
                    else assert.equal(JSON.parse(result.text).model, model)
                }
            }
            const bad = await post('/claude-desktop/v1/messages', { model: 'claude-opus-4-6', max_tokens: 100, messages: [] })
            assert.equal(bad.status, 400)
            const count = await post('/claude-desktop/v1/messages/count_tokens', { model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hello' }] })
            assert.equal(count.status, 200)
            const normal = await post('/v1/messages', { model: 'claude-sonnet-4-6', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] })
            assert.equal(normal.status, 200)
            assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, 'claude-sonnet-4.6')
        } finally {
            proxy.updateConfig({ apiKey: '' })
            delete proxy.events.getDesktopRoutes
        }
    })
    await check('Claude legacy aliases strip unsupported thinking and effort', async () => {
        for (const [alias, id] of [['claude-sonnet-4.0', 'claude-sonnet-4'], ['claude-sonnet-4-5-20250929', 'claude-sonnet-4.5'], ['claude-opus-4-5', 'claude-opus-4.5'], ['claude-haiku-4-5', 'claude-haiku-4.5']]) {
            const result = await post('/v1/messages', { model: alias, max_tokens: 100, messages: [{ role: 'user', content: 'hello' }], thinking: { type: 'enabled', budget_tokens: 16000 }, output_config: { effort: 'high' } })
            assert.equal(result.status, 200, result.text)
            assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, id)
            assert.equal(Object.hasOwn(requests.at(-1).payload, 'additionalModelRequestFields'), false)
        }
    })
    await check('Claude inline system messages preserve position, blocks, and cache points', async () => {
        upstreamMode = 'text'
        const result = await post('/v1/messages', {
            model: 'claude-sonnet-4.5',
            max_tokens: 100,
            messages: [
                { role: 'system', content: 'FULL_PLAN_MARKER' },
                { role: 'user', content: 'NORMAL_USER_MARKER' },
                { role: 'assistant', content: [{ type: 'text', text: 'ASSISTANT_MARKER' }] },
                { role: 'system', content: [{ type: 'text', text: 'SPARSE_MARKER', cache_control: { type: 'ephemeral' } }] },
                { role: 'system', content: 'EXIT_MARKER' },
                { role: 'user', content: 'FINAL_USER_MARKER' }
            ]
        })
        assert.equal(result.status, 200, result.text)
        const payload = requests.at(-1).payload
        const history = payload.conversationState.history
        const serialized = JSON.stringify(payload)
        const markers = ['FULL_PLAN_MARKER', 'NORMAL_USER_MARKER', 'ASSISTANT_MARKER', 'SPARSE_MARKER', 'EXIT_MARKER', 'FINAL_USER_MARKER']
        const conversationMessages = [
            ...history,
            { userInputMessage: payload.conversationState.currentMessage.userInputMessage }
        ]
        const orderedText = conversationMessages.map(message =>
            message.userInputMessage?.content ?? message.assistantResponseMessage?.content ?? ''
        ).join('\n')
        const positions = markers.map(marker => orderedText.indexOf(marker))
        assert.ok(positions.every(position => position >= 0), 'every system and conversation marker must reach Kiro')
        assert.deepEqual(positions, [...positions].sort((left, right) => left - right), 'Kiro payload text must retain the client order')
        assert.equal(history[0].userInputMessage.content, 'FULL_PLAN_MARKER\nNORMAL_USER_MARKER')
        assert.equal(history[1].assistantResponseMessage.content, 'ASSISTANT_MARKER')
        assert.equal(payload.conversationState.currentMessage.userInputMessage.content, 'SPARSE_MARKER\nEXIT_MARKER\nFINAL_USER_MARKER')
        assert.equal(payload.conversationState.currentMessage.userInputMessage.cachePoint, undefined)
        assert.equal(serialized.includes('execution_discipline'), false)
    })
    await check('Claude conversation identity keeps session, agent, and request lanes separate', async () => {
        upstreamMode = 'text'
        const body = {
            model: 'claude-sonnet-4.5', max_tokens: 100,
            messages: [{ role: 'user', content: 'First prompt.' }]
        }
        const session = { 'x-claude-code-session-id': 'fixture-session' }
        async function identity(extraHeaders = {}, changedBody = body) {
            const result = await post('/v1/messages', changedBody, { ...session, ...extraHeaders })
            assert.equal(result.status, 200, result.text)
            return requests.at(-1).payload.conversationState.conversationId
        }
        const main = await identity({ 'x-claude-code-request-class': 'main' })
        assert.equal(await identity({ 'x-claude-code-context-compacted': 'true' }, {
            ...body, messages: [{ role: 'user', content: 'Changed prompt after compaction.' }]
        }), main)
        assert.equal(await identity({ 'x-claude-code-request-class': 'workflow' }), main)
        const agent = await identity({ 'x-claude-code-agent-id': 'agent-1' })
        assert.notEqual(agent, main)
        assert.equal(await identity({ 'x-claude-code-agent-id': 'agent-1', 'x-claude-code-request-class': 'subagent' }), agent)
        assert.notEqual(await identity({ 'x-claude-code-request-class': 'auxiliary' }), main)
        assert.notEqual(await identity({ 'x-claude-code-request-class': 'compaction' }), main)

        const stableBody = {
            ...body, conversation_id: 'explicit-fixture-id',
            system: [
                { type: 'text', text: 'Stable system.', cache_control: { type: 'ephemeral' } },
                { type: 'text', text: 'Dynamic system.' }
            ]
        }
        const first = await post('/v1/messages', stableBody)
        assert.equal(first.status, 200, first.text)
        const firstPayload = requests.at(-1).payload
        const second = await post('/v1/messages', stableBody)
        assert.equal(second.status, 200, second.text)
        const secondPayload = requests.at(-1).payload
        assert.deepEqual(firstPayload.conversationState.history, secondPayload.conversationState.history)
        assert.deepEqual(firstPayload.conversationState.currentMessage, secondPayload.conversationState.currentMessage)
        assert.equal(firstPayload.conversationState.conversationId, secondPayload.conversationState.conversationId)
        assert.equal(firstPayload.conversationState.history[0].userInputMessage.content, 'Stable system.')
        assert.deepEqual(firstPayload.conversationState.history[0].userInputMessage.cachePoint, { type: 'default' })
        assert.equal(firstPayload.conversationState.history[2].userInputMessage.content, 'Dynamic system.')
        assert.equal(firstPayload.conversationState.history[2].userInputMessage.cachePoint, undefined)
    })
    await check('Claude CORS preflight permits future Anthropic and Claude Code headers', async () => {
        const response = await rawFetch(`${base}/v1/messages`, {
            method: 'OPTIONS',
            headers: { 'access-control-request-headers': 'anthropic-future-flag, x-claude-code-future-flag' }
        })
        assert.ok(response.ok)
        const allowed = response.headers.get('access-control-allow-headers') || ''
        assert.match(allowed, /anthropic-future-flag/)
        assert.match(allowed, /x-claude-code-future-flag/)
    })
    await check('Claude rejects unsupported semantic fields before upstream and reports cache limitations', async () => {
        upstreamMode = 'text'
        const baseBody = {
            model: 'claude-sonnet-4.5', max_tokens: 100,
            messages: [{ role: 'user', content: 'Hello.' }]
        }
        const unsupported = [
            { context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] } },
            { output_config: { format: { type: 'json_schema' } } },
            { tool_choice: { type: 'tool', name: 'lookup' } },
            { tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
            { messages: [{ role: 'user', content: [{ type: 'tool_reference', tool_name: 'lookup' }] }] },
            { system: [null] },
            { system: [{ type: 'image', text: 'Invalid.' }] }
        ]
        for (const fields of unsupported) {
            for (const stream of [false, true]) {
                const before = requests.length
                const metadataBefore = metadataRequests.length
                const result = await post('/v1/messages', { ...baseBody, ...fields, stream })
                assert.equal(result.status, 400, result.text)
                assert.equal(result.json?.error?.type, 'invalid_request_error', result.text)
                assert.equal(requests.length, before)
                assert.equal(metadataRequests.length, metadataBefore)
                if (fields.tools?.[0]?.type === 'web_search_20250305') {
                    assert.match(result.json?.error?.message || '', /Input tag 'web_search_20250305'/)
                }
            }
        }
        const allowed = await post('/v1/messages', {
            ...baseBody,
            context_management: { edits: [] },
            future_extension: { value: true },
            system: [{ type: 'text', text: 'Cache for one hour.', cache_control: { type: 'ephemeral', ttl: '1h' } }]
        })
        assert.equal(allowed.status, 200, allowed.text)
        assert.match(allowed.headers.get('x-kiro-compatibility') || '', /cache_ttl_not_supported/)
    })
    await check('Claude cache fields and stats require upstream telemetry', async () => {
        upstreamMode = 'text'
        const body = {
            model: 'claude-sonnet-4.5', max_tokens: 100,
            system: [{ type: 'text', text: 'Cached instruction.', cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: 'Hello.' }]
        }
        const before = proxy.getStats()
        try {
            upstreamFrames = [frame('assistantResponseEvent', { content: 'Hello fixture' })]
            for (const stream of [false, true]) {
                for (let repeat = 0; repeat < 2; repeat++) {
                    const result = await post('/v1/messages', { ...body, stream })
                    assert.equal(result.status, 200, result.text)
                    const usage = stream
                        ? events(result.text).find(event => event.type === 'message_delta')?.usage
                        : result.json.usage
                    assert.equal(usage.cache_read_input_tokens, undefined)
                    assert.equal(usage.cache_creation_input_tokens, undefined)
                }
            }
        } finally {
            upstreamFrames = undefined
        }
        const after = proxy.getStats()
        assert.equal(after.cacheReadTokens, before.cacheReadTokens)
        assert.equal(after.cacheWriteTokens, before.cacheWriteTokens)
    })
    await check('Claude JSON and SSE usage report real cache breakdown and zeros', async () => {
        upstreamMode = 'text'
        const body = { model: 'claude-sonnet-4.5', max_tokens: 100, messages: [{ role: 'user', content: 'Usage.' }] }
        const beforeCredits = proxy.getStats().totalCredits
        try {
            for (const [read, write, uncached, total] of [[200, 30, 100, 337], [0, 0, 100, 107]]) {
                upstreamFrames = [
                    frame('assistantResponseEvent', { content: 'Hello fixture' }),
                    frame('messageMetadataEvent', { tokenUsage: {
                        uncachedInputTokens: uncached, cacheReadInputTokens: read,
                        cacheWriteInputTokens: write, outputTokens: 7, totalTokens: total
                    } }),
                    frame('meteringEvent', { usage: 1.25 })
                ]
                for (const stream of [false, true]) {
                    const result = await post('/v1/messages', { ...body, stream })
                    assert.equal(result.status, 200, result.text)
                    const usage = stream
                        ? events(result.text).find(event => event.type === 'message_delta')?.usage
                        : result.json.usage
                    assert.equal(usage.input_tokens, uncached)
                    assert.equal(usage.cache_read_input_tokens, read)
                    assert.equal(usage.cache_creation_input_tokens, write)
                    assert.equal(usage.output_tokens, 7)
                }
            }
        } finally {
            upstreamFrames = undefined
        }
        assert.equal(proxy.getStats().totalCredits - beforeCredits, 5)
    })
    await check('Claude Code keeps history and tool results under explicit proxy trimming', async () => {
        upstreamMode = 'text'
        const oldText = 'old:' + Array.from({ length: 3000 }, (_, index) =>
            `fixture history line ${index}: varied words for token estimation.\n`).join('')
        const body = {
            model: 'claude-sonnet-4.5', max_tokens: 100,
            tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
            messages: [
                { role: 'user', content: oldText },
                { role: 'assistant', content: 'Old answer.' },
                { role: 'user', content: 'Use lookup.' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'trim-call', name: 'lookup', input: {} }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'trim-call', content: 'Retained result.' }] }
            ]
        }
        try {
            setModelContextWindow('claude-sonnet-4.5', 12000)
            setTokenBufferReserve(5000)
            setEnableTokenBufferReserve(true)
            const cc = await post('/v1/messages', body, { 'x-claude-code-session-id': 'trim-fixture' })
            assert.equal(cc.status, 200, cc.text)
            const preserved = requests.at(-1).payload.conversationState
            assert.ok(preserved.history.some(message => message.userInputMessage?.content === oldText))
            assert.equal(preserved.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content[0].text, 'Retained result.')
            const ordinary = await post('/v1/messages', body)
            assert.equal(ordinary.status, 200, ordinary.text)
            const trimmed = requests.at(-1).payload.conversationState
            assert.equal(trimmed.history.some(message => message.userInputMessage?.content === oldText), false)
            assert.equal(trimmed.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content[0].text, 'Retained result.')
        } finally {
            setEnableTokenBufferReserve(false)
            setTokenBufferReserve(20000)
            setModelContextWindow('claude-sonnet-4.5', 200000)
        }
    })
    await check('Claude discovery IDs preserve Kiro identity and schema on cold and warm requests', async () => {
        const opus = {
            modelId: 'claude-opus-5.5', modelName: 'Claude Opus 5.5', description: 'Synthetic Opus fixture',
            tokenLimits: { maxInputTokens: 1000000, maxOutputTokens: 64000 },
            additionalModelRequestFieldsSchema: {
                type: 'object', properties: {
                    thinking: { type: 'object', properties: { type: { enum: ['adaptive'] } } },
                    output_config: { type: 'object', properties: { effort: { enum: ['low', 'medium', 'high', 'xhigh', 'max'] } } }
                }
            }
        }
        try {
            modelMetadata = [
                opus,
                { modelId: 'claude-3-7-sonnet', modelName: 'Dynamic legacy model', tokenLimits: { maxInputTokens: 123456 }, additionalModelRequestFieldsSchema: reasoningSchema },
                ...models.filter(model => model.modelId !== 'claude-3.7-sonnet'),
                { modelId: 'custom-claude-opus-5.5', modelName: 'Custom deployment' }
            ]
            clearAllCaches()
            const beforeMetadata = metadataRequests.length
            const request = { model: 'claude-opus-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }], thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' } }
            const cold = await post('/v1/messages', request)
            assert.equal(cold.status, 200, cold.text)
            assert.equal(cold.json.model, request.model)
            assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, opus.modelId)
            assert.deepEqual(requests.at(-1).payload.additionalModelRequestFields, { thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' } })
            assert.equal(metadataRequests.length, beforeMetadata + 1, 'no discovery request is required to resolve capabilities')

            const response = await rawFetch(`${base}/v1/models?limit=1000`)
            assert.equal(response.status, 200)
            const { data } = await response.json()
            assert.equal(data.filter(model => model.id === 'claude-opus-5-5').length, 1)
            assert.ok(!data.some(model => model.id === opus.modelId), 'picker must not offer the unrecognized dot alias')
            const discovered = data.find(model => model.id === request.model)
            assert.equal(discovered.display_name, opus.modelName)
            assert.equal(discovered.root, opus.modelId)
            assert.equal(discovered.context_length, 1000000)
            assert.deepEqual(discovered.thinkingEfforts, ['low', 'medium', 'high', 'xhigh', 'max'])
            const legacy = data.find(model => model.id === 'claude-3-7-sonnet')
            assert.equal(legacy.root, 'claude-3-7-sonnet', 'hidden dot fallback cannot replace a real dynamic entry')
            assert.equal(legacy.context_length, 123456)
            assert.deepEqual(legacy.thinkingEfforts, ['low', 'high'])
            assert.ok(data.some(model => model.id === 'gpt-5.6-sol'))
            assert.ok(data.some(model => model.id === 'custom-claude-opus-5.5'), 'custom names are not guessed')

            for (const model of [opus.modelId, request.model, 'claude-opus-5-5-20260901']) {
                const result = await post('/v1/messages', { ...request, model, stream: true })
                assert.equal(result.status, 200, result.text)
                const stream = events(result.text)
                assert.equal(stream.find(event => event.type === 'message_start').message.model, model)
                assertClaudeStreamLifecycle(stream)
                assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, opus.modelId)
                assert.equal(requests.at(-1).payload.additionalModelRequestFields.output_config.effort, 'xhigh')
            }
            assert.equal(proxy.getConfig().claudeModelIdMappingEnabled, true, 'old configurations default to compatibility enabled')
            const uiModels = await proxy.getAvailableModels()
            assert.deepEqual(
                Object.fromEntries(['id', 'upstreamId', 'clientId'].map(key => [key, uiModels.models.find(model => model.id === opus.modelId)[key]])),
                { id: opus.modelId, upstreamId: opus.modelId, clientId: request.model }
            )
            proxy.updateConfig({ claudeModelIdMappingEnabled: false })
            assert.equal(proxy.getConfig().claudeModelIdMappingEnabled, false)
            assert.equal(proxy.needsRestart(), false, 'name compatibility is a hot setting')
            const rawDiscovery = await (await rawFetch(`${base}/v1/models`)).json()
            assert.ok(rawDiscovery.data.some(model => model.id === opus.modelId))
            assert.ok(!rawDiscovery.data.some(model => model.id === request.model))
            const rawUiModels = await proxy.getAvailableModels()
            assert.equal(rawUiModels.models.find(model => model.id === opus.modelId).clientId, opus.modelId)
            const existingClient = await post('/v1/messages', request)
            assert.equal(existingClient.status, 200, 'turning discovery spelling off must not break configured clients')
            assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, opus.modelId)
            proxy.updateConfig({ claudeModelIdMappingEnabled: true })
            // A recognized spelling must not fabricate support for another account/schema.
            modelMetadata = [{ ...opus, additionalModelRequestFieldsSchema: undefined }]
            clearAllCaches()
            const unsupported = await post('/v1/messages', request)
            assert.equal(unsupported.status, 200, unsupported.text)
            assert.equal(Object.hasOwn(requests.at(-1).payload, 'additionalModelRequestFields'), false)
        } finally {
            modelMetadata = models
            proxy.updateConfig({ claudeModelIdMappingEnabled: true })
            clearAllCaches()
        }
    })
    await check('Claude account affinity follows session and moves after quota exhaustion', async () => {
        upstreamMode = 'text'
        await start(['a', 'b'])
        proxy.updateConfig({ sessionAffinityEnabled: true, enableMultiAccount: true })
        const body = { model: 'claude-sonnet-4.5', max_tokens: 100, messages: [{ role: 'user', content: 'Affinity.' }] }
        const headers = { 'x-claude-code-session-id': 'affinity-fixture', 'x-claude-code-agent-id': 'agent-a' }
        try {
            const first = await post('/v1/messages', body, headers)
            assert.equal(first.status, 200, first.text)
            const firstAccount = requests.at(-1).authorization
            const repeat = await post('/v1/messages', body, headers)
            assert.equal(repeat.status, 200, repeat.text)
            assert.equal(requests.at(-1).authorization, firstAccount)
            const exhaustedId = firstAccount.endsWith('fixture-a') ? 'a' : 'b'
            const replacementId = exhaustedId === 'a' ? 'b' : 'a'
            proxy.getAccountPool().updateAccount(exhaustedId, {
                quotaUsed: 100, quotaLimit: 100,
                quotaExhaustedAt: Date.now(), quotaResetAt: Date.now() + 3600000
            })
            const switched = await post('/v1/messages', body, headers)
            assert.equal(switched.status, 200, switched.text)
            assert.equal(requests.at(-1).authorization, `Bearer fixture-${replacementId}`)
            const stable = await post('/v1/messages', body, headers)
            assert.equal(stable.status, 200, stable.text)
            assert.equal(requests.at(-1).authorization, `Bearer fixture-${replacementId}`)
        } finally {
            await start()
        }
    })
    await check('Claude retry binds the successful account and respects API key account limits', async () => {
        await start(['a', 'b', 'c'])
        proxy.updateConfig({
            sessionAffinityEnabled: true, enableMultiAccount: true,
            apiKeys: [
                { id: 'bound', key: 'fixture-bound', enabled: true, usage: { totalRequests: 0, totalCredits: 0, totalInputTokens: 0, totalOutputTokens: 0, daily: {} } },
                { id: 'only-a', key: 'fixture-only-a', enabled: true, usage: { totalRequests: 0, totalCredits: 0, totalInputTokens: 0, totalOutputTokens: 0, daily: {} } }
            ],
            apiKeyAccountBindings: { bound: ['a', 'b'], 'only-a': ['a'] }
        })
        const body = { model: 'claude-sonnet-4.5', max_tokens: 100, messages: [{ role: 'user', content: 'Retry.' }] }
        upstreamMode = 'failover'
        try {
            const before = requests.length
            const headers = { 'x-api-key': 'fixture-bound', 'x-claude-code-session-id': 'retry-session' }
            const first = await post('/v1/messages', body, headers)
            assert.equal(first.status, 200, first.text)
            const attempts = requests.slice(before).map(request => request.authorization)
            assert.ok(attempts.includes('Bearer fixture-a'))
            assert.equal(attempts.at(-1), 'Bearer fixture-b')
            assert.equal(attempts.includes('Bearer fixture-c'), false)
            const repeatBefore = requests.length
            const repeat = await post('/v1/messages', body, headers)
            assert.equal(repeat.status, 200, repeat.text)
            assert.deepEqual(requests.slice(repeatBefore).map(request => request.authorization), ['Bearer fixture-b'])

            const restrictedBefore = requests.length
            const restricted = await post('/v1/messages', body, {
                'x-api-key': 'fixture-only-a', 'x-claude-code-session-id': 'restricted-session'
            })
            assert.notEqual(restricted.status, 200)
            assert.ok(requests.slice(restrictedBefore).every(request => request.authorization === 'Bearer fixture-a'))
        } finally {
            upstreamMode = 'text'
            await start()
        }
    })
    await check('Claude sticky affinity expires and rejects cooldown and backoff accounts', async () => {
        await start(['a', 'b'])
        proxy.updateConfig({ sessionAffinityEnabled: true })
        const pool = proxy.getAccountPool()
        try {
            proxy.rememberAffinity('ttl-fixture', 'a')
            proxy.sessionAffinity.get('ttl-fixture').lastAt = Date.now() - 600001
            assert.equal(proxy.pickAccountWithAffinity('ttl-fixture'), null)
            assert.equal(proxy.sessionAffinity.has('ttl-fixture'), false)

            proxy.rememberAffinity('cooldown-fixture', 'a')
            pool.updateAccount('a', { cooldownUntil: Date.now() + 60000 })
            assert.equal(proxy.pickAccountWithAffinity('cooldown-fixture'), null)
            pool.updateAccount('a', { cooldownUntil: undefined })

            proxy.rememberAffinity('backoff-fixture', 'a')
            pool.updateAccount('a', { errorCount: 1, lastUsed: Date.now() })
            assert.equal(proxy.pickAccountWithAffinity('backoff-fixture'), null)
        } finally {
            await start()
        }
    })
    await check('Claude token refresh fallback respects bindings and refreshes replacement once', async () => {
        await start(['a', 'b', 'c'])
        proxy.updateConfig({
            sessionAffinityEnabled: true,
            enableMultiAccount: true,
            apiKeyAccountBindings: { bound: ['a', 'c'] }
        })
        const refreshCalls = []
        proxy.isTokenExpiringSoon = account => account.id === 'a' || account.id === 'c'
        proxy.refreshToken = async account => {
            refreshCalls.push(account.id)
            return account.id === 'c'
        }
        try {
            const selected = await proxy.getAvailableAccount(undefined, 'refresh-fixture', 'bound')
            assert.equal(selected?.id, 'c')
            assert.deepEqual(refreshCalls, ['a', 'c'])
            assert.equal(proxy.pickAccountWithAffinity('refresh-fixture')?.id, 'c')
        } finally {
            await start()
        }
    })
    await check('explicit Claude conversation IDs remain isolated across API keys', async () => {
        upstreamMode = 'text'
        const apiKey = (id) => ({
            id, name: id, key: `test-key-${id}`, format: 'simple', enabled: true,
            createdAt: Date.now(),
            usage: { totalRequests: 0, totalCredits: 0, totalInputTokens: 0, totalOutputTokens: 0, daily: {} }
        })
        proxy.updateConfig({ apiKeys: [apiKey('tenant-a'), apiKey('tenant-b')] })
        const body = {
            model: 'claude-sonnet-4.5', max_tokens: 100,
            conversation_id: 'shared-explicit-id', messages: [{ role: 'user', content: 'Tenant identity.' }]
        }
        try {
            const a = await post('/v1/messages', body, { 'x-api-key': 'test-key-tenant-a' })
            assert.equal(a.status, 200, a.text)
            const aId = requests.at(-1).payload.conversationState.conversationId
            const b = await post('/v1/messages', body, { 'x-api-key': 'test-key-tenant-b' })
            assert.equal(b.status, 200, b.text)
            const bId = requests.at(-1).payload.conversationState.conversationId
            assert.notEqual(aId, bId)
        } finally {
            proxy.updateConfig({ apiKeys: [] })
        }
    })
    await check('Claude rejects an unknown inline message role before generating upstream requests', async () => {
        const before = requests.length
        const result = await post('/v1/messages', {
            model: 'claude-sonnet-4.5',
            max_tokens: 100,
            messages: [{ role: 'system-typo', content: 'must not be forwarded' }]
        })
        assert.equal(result.status, 400, result.text)
        assert.equal(result.json?.error?.type, 'invalid_request_error', result.text)
        assert.equal(requests.length, before)

        const unsupportedSystemBlock = await post('/v1/messages', {
            model: 'claude-sonnet-4.5',
            max_tokens: 100,
            messages: [{
                role: 'system',
                content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }]
            }]
        })
        assert.equal(unsupportedSystemBlock.status, 400, unsupportedSystemBlock.text)
        assert.equal(unsupportedSystemBlock.json?.error?.type, 'invalid_request_error', unsupportedSystemBlock.text)
        assert.equal(requests.length, before)
    })
    await check('Claude tool use, intervening system message, and tool result remain intact', async () => {
        upstreamMode = 'text'
        const result = await post('/v1/messages', {
            model: 'claude-sonnet-4.5',
            max_tokens: 100,
            messages: [
                { role: 'user', content: 'TOOL_SCENARIO_START' },
                { role: 'assistant', content: [
                    { type: 'text', text: 'I will call a tool.' },
                    { type: 'tool_use', id: 'system-gap-call', name: 'lookup_data', input: { query: 'fixture-query' } }
                ] },
                { role: 'system', content: [{ type: 'text', text: 'SYSTEM_BETWEEN_TOOL_AND_RESULT' }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'system-gap-call', is_error: true, content: [{ type: 'text', text: 'TOOL_RESULT_BODY' }] }] }
            ],
            tools: [{ name: 'lookup_data', description: 'Fixture lookup', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }]
        })
        assert.equal(result.status, 200, result.text)
        const payload = requests.at(-1).payload
        const assistant = payload.conversationState.history
            .map(item => item.assistantResponseMessage)
            .find(message => message?.toolUses?.some(toolUse => toolUse.toolUseId === 'system-gap-call'))
        assert.ok(assistant)
        assert.equal(assistant.toolUses[0].toolUseId, 'system-gap-call')
        assert.deepEqual(assistant.toolUses[0].input, { query: 'fixture-query' })
        const current = payload.conversationState.currentMessage.userInputMessage
        assert.ok(current.content.includes('SYSTEM_BETWEEN_TOOL_AND_RESULT'))
        assert.deepEqual(current.userInputMessageContext.toolResults.map(item => ({ id: item.toolUseId, status: item.status, text: item.content[0].text })), [
            { id: 'system-gap-call', status: 'error', text: 'TOOL_RESULT_BODY' }
        ])
    })
    await check('Claude prompt-too-long errors fail once for stream and non-stream requests', async () => {
        upstreamMode = 'prompt-too-long'
        await start(['a', 'b'])
        for (const stream of [false, true]) {
            const before = requests.length
            const result = await post('/v1/messages', {
                model: 'claude-sonnet-4.5',
                max_tokens: 100,
                messages: [{ role: 'user', content: 'fixture prompt' }],
                stream
            })
            assert.equal(result.status, 400, result.text)
            assert.equal(result.json?.error?.type, 'invalid_request_error', result.text)
            assert.match(result.json?.error?.message || '', /capability_rejected: prompt_too_long/)
            assert.equal(requests.length - before, 1, 'fatal prompt size rejection must not fail over to another account')
        }
    })
    await check('Claude invalid model and upstream 413 do not become prompt-too-long errors', async () => {
        await start(['a', 'b'])
        upstreamMode = 'invalid'
        const invalidModel = await post('/v1/messages', {
            model: 'claude-sonnet-4.5',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'fixture prompt' }]
        })
        assert.equal(invalidModel.status, 400, invalidModel.text)
        assert.equal(invalidModel.json?.error?.type, 'invalid_request_error', invalidModel.text)
        assert.equal(invalidModel.json?.error?.message?.includes('prompt_too_long'), false)

        upstreamMode = 'payload-too-large'
        for (const stream of [false, true]) {
            const tooLarge = await post('/v1/messages', {
                model: 'claude-sonnet-4.5',
                max_tokens: 100,
                messages: [{ role: 'user', content: 'fixture prompt' }],
                stream
            })
            assert.equal(tooLarge.status, 413, tooLarge.text)
            assert.equal(tooLarge.json?.error?.type, 'request_too_large', tooLarge.text)
            assert.equal(tooLarge.json?.error?.message?.includes('prompt_too_long'), false)
        }
    })
    await check('Claude invalidStateEvent maps context errors before and after output without replay', async () => {
        upstreamMode = 'text'
        const contextRejected = frame('invalidStateEvent', {
            reason: 'CONTENT_LENGTH_EXCEEDS_THRESHOLD',
            message: 'Input is too long.'
        })
        try {
            await start(['a', 'b'])
            upstreamFrames = [contextRejected]
            const before = requests.length
            const beforeOutput = await post('/v1/messages', {
                model: 'claude-sonnet-4.5',
                max_tokens: 100,
                messages: [{ role: 'user', content: 'fixture prompt' }],
                stream: true
            })
            assert.equal(beforeOutput.status, 400, beforeOutput.text)
            assert.equal(beforeOutput.json?.error?.type, 'invalid_request_error', beforeOutput.text)
            assert.match(beforeOutput.json?.error?.message || '', /capability_rejected: prompt_too_long/)
            assert.equal(requests.length - before, 1)

            await start(['a', 'b'])
            upstreamFrames = [
                frame('assistantResponseEvent', { content: 'prefix' }),
                contextRejected
            ]
            const afterBefore = requests.length
            const afterOutput = await post('/v1/messages', {
                model: 'claude-sonnet-4.5',
                max_tokens: 100,
                messages: [{ role: 'user', content: 'fixture prompt' }],
                stream: true
            })
            assert.equal(afterOutput.status, 200, afterOutput.text)
            const stream = events(afterOutput.text)
            const errors = stream.filter(event => event.type === 'error')
            assert.equal(errors.length, 1)
            assert.equal(errors[0].error.type, 'invalid_request_error')
            assert.match(errors[0].error.message, /capability_rejected: prompt_too_long/)
            assert.equal(stream.some(event => event.type === 'message_stop' || event.type === 'message_delta'), false)
            assert.equal(requests.length - afterBefore, 1)
        } finally {
            upstreamFrames = undefined
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

            proxy.updateConfig({ modelMappings: [{ ...modelMapping, sourceModel: 'claude-haiku-4.5' }] })
            const canonicalDefault = await post('/v1/messages', { model: 'claude-haiku-4-5', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] })
            assert.equal(canonicalDefault.status, 200, canonicalDefault.text)
            assert.equal(requests.at(-1).payload.conversationState.currentMessage.userInputMessage.modelId, 'gpt-5.6-luna')
            assert.deepEqual(requests.at(-1).payload.additionalModelRequestFields, { reasoning: { effort: 'high' } })
            proxy.updateConfig({ modelMappings: [modelMapping] })

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
                assert.equal(claude.status, 502, claude.text)
                assert.equal(claude.json?.error?.type, 'api_error', claude.text)
                assert.equal(claude.text.includes('event: '), false, 'pre-output failures must remain HTTP errors')
                assert.equal(requests.length - before, 1)
            }
            // Once text has reached the client, a corrupt frame must become one SSE error without a success terminator.
            for (const chunks of [[validText, badCrc], [validText, validText.subarray(0, -1)]]) {
                await start()
                upstreamFrames = chunks
                const afterOutputBefore = requests.length
                const claudeAfterOutput = await post('/v1/messages', { model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100, stream: true })
                assert.equal(claudeAfterOutput.status, 200, claudeAfterOutput.text)
                const claudeAfterOutputEvents = events(claudeAfterOutput.text)
                assert.equal(claudeAfterOutputEvents.at(-1).type, 'error', claudeAfterOutput.text)
                assert.equal(claudeAfterOutputEvents.filter(event => event.type === 'error').length, 1)
                assert.equal(claudeAfterOutputEvents.some(event => event.type === 'message_stop' || event.type === 'message_delta' || event.content_block?.type === 'tool_use'), false)
                assert.equal(requests.length - afterOutputBefore, 1)
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
    await check('payload limits count UTF-8 bytes and preserve tool results under the limit', async () => {
        try {
            upstreamMode = 'text'
            await start()
            setPayloadSizeLimitKB(256)
            setEnableTokenBufferReserve(false)

            const unicodeText = '中'.repeat(90000)
            assert.ok(unicodeText.length < 256 * 1024)
            assert.ok(Buffer.byteLength(unicodeText, 'utf8') > 256 * 1024)
            const beforeOversized = requests.length
            for (const stream of [false, true]) {
                const oversized = await post('/v1/messages', {
                    model: 'claude-sonnet-4.5',
                    max_tokens: 100,
                    messages: [{ role: 'user', content: unicodeText }],
                    stream
                })
                assert.equal(oversized.status, 413, oversized.text)
                assert.equal(oversized.json?.error?.type, 'request_too_large', oversized.text)
            }
            assert.equal(requests.length, beforeOversized, 'an oversized Kiro payload must not call generateAssistantResponse')

            const sourceToolResult = `${'fixture tool output line\n'.repeat(8000)}TOOL_RESULT_TAIL_MARKER`
            const beforeToolResult = requests.length
            const retainedResult = await post('/v1/messages', {
                model: 'claude-sonnet-4.5',
                max_tokens: 100,
                messages: [
                    { role: 'user', content: 'H'.repeat(1000) },
                    { role: 'assistant', content: [{ type: 'tool_use', id: 'large-result-call', name: 'lookup_data', input: {} }] },
                    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'large-result-call', content: sourceToolResult }] },
                    { role: 'assistant', content: 'Tool result received.' },
                    { role: 'user', content: 'Continue with the next step.' }
                ],
                tools: [{ name: 'lookup_data', description: 'Fixture lookup', input_schema: { type: 'object', properties: {} } }]
            })
            assert.equal(retainedResult.status, 200, retainedResult.text)
            assert.equal(requests.length - beforeToolResult, 1)
            const payload = requests.at(-1).payload
            const toolResult = payload.conversationState.history
                .flatMap(message => message.userInputMessage?.userInputMessageContext?.toolResults ?? [])
                .find(item => item.toolUseId === 'large-result-call')
            assert.ok(toolResult)
            assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') < 256 * 1024)
            assert.equal(toolResult.content[0].text, sourceToolResult, 'the result tail must remain intact below the configured limit')
        } finally {
            setPayloadSizeLimitKB(153600)
            setEnableTokenBufferReserve(false)
            upstreamFrames = undefined
        }
    })
    output(`Compatibility HTTP checks passed: ${checks}`)
} finally {
    if (proxy) await proxy.stop(0)
    globalThis.fetch = rawFetch
    console.log = output
    console.error = rawError
    console.warn = rawWarn
}
