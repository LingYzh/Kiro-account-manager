import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compiled = await build({
    stdin: {
        contents: `
            export {
                buildClaudeConversationIdentity,
                captureClaudeGatewayContext,
                cloneClaudeRequest
            } from '../src/main/proxy/claudeGateway'
            export { inspectClaudeCapabilities } from '../src/main/proxy/claudeCapabilities'
        `,
        resolveDir: resolve(project, 'test'),
        loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false
})
const bundleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
const {
    buildClaudeConversationIdentity,
    captureClaudeGatewayContext,
    cloneClaudeRequest,
    inspectClaudeCapabilities
} = await import(bundleUrl)

const captured = captureClaudeGatewayContext({
    'Anthropic-Version': '2025-01-01',
    'ANTHROPIC-BETA': ['future-beta-2026-01-01', 'second-beta'],
    'X-Claude-Code-Session-Id': 'session-1',
    'x-claude-code-agent-id': 'agent-1',
    'x-claude-code-parent-agent-id': 'parent-1',
    'x-claude-code-request-class': 'subagent',
    'x-claude-code-agent-type': 'worker',
    'x-claude-code-prompt-id': 'prompt-1',
    'x-claude-code-compaction': 'requested',
    'x-claude-code-context-compacted': 'true',
    'X-Claude-Code-Future-Flag': ['raw-one', 'raw-two'],
    Authorization: 'Bearer must-not-be-captured',
    'x-api-key': 'api-key-must-not-be-captured',
    Cookie: 'cookie-must-not-be-captured',
    'User-Agent': 'test-client/1.0'
})

assert.deepEqual(captured, {
    requestHeaders: {
        'anthropic-version': '2025-01-01',
        'anthropic-beta': ['future-beta-2026-01-01', 'second-beta'],
        'x-claude-code-session-id': 'session-1',
        'x-claude-code-agent-id': 'agent-1',
        'x-claude-code-parent-agent-id': 'parent-1',
        'x-claude-code-request-class': 'subagent',
        'x-claude-code-agent-type': 'worker',
        'x-claude-code-prompt-id': 'prompt-1',
        'x-claude-code-compaction': 'requested',
        'x-claude-code-context-compacted': 'true',
        'x-claude-code-future-flag': ['raw-one', 'raw-two']
    },
    version: '2025-01-01',
    beta: 'future-beta-2026-01-01',
    sessionId: 'session-1',
    agentId: 'agent-1',
    parentAgentId: 'parent-1',
    requestClass: 'subagent',
    agentType: 'worker',
    promptId: 'prompt-1',
    compaction: 'requested',
    contextCompacted: 'true',
    isClaudeCode: true,
    preserveHistory: true
})
assert.doesNotMatch(JSON.stringify(captured), /must-not-be-captured/)

assert.equal(captureClaudeGatewayContext({ 'User-Agent': 'Claude-CLI/2.0.0' }).isClaudeCode, true)
assert.equal(captureClaudeGatewayContext({ 'User-Agent': 'my CLAUDE-CODE/1.2' }).preserveHistory, true)
assert.equal(captureClaudeGatewayContext({ 'User-Agent': 'unrelated/1.0' }).isClaudeCode, false)
assert.equal(captureClaudeGatewayContext({ 'x-claude-code-custom': undefined }).isClaudeCode, true)

function context(overrides = {}) {
    return {
        requestHeaders: {},
        version: undefined,
        beta: undefined,
        sessionId: undefined,
        agentId: undefined,
        parentAgentId: undefined,
        requestClass: undefined,
        agentType: undefined,
        promptId: undefined,
        compaction: undefined,
        contextCompacted: undefined,
        isClaudeCode: false,
        preserveHistory: false,
        ...overrides
    }
}

const main = context({ sessionId: 'session-stable', requestClass: 'main', promptId: 'prompt-a' })
const mainIdentity = buildClaudeConversationIdentity(main, 'fallback-a', 'tenant-key-1')
assert.equal(mainIdentity, buildClaudeConversationIdentity({ ...main, promptId: 'prompt-b' }, 'fallback-b', 'tenant-key-1'))
assert.equal(mainIdentity, buildClaudeConversationIdentity(context({ sessionId: 'session-stable' }), undefined, 'tenant-key-1'))
assert.match(mainIdentity, /^claude:[a-f0-9]{64}$/)
assert.equal(buildClaudeConversationIdentity(context(), undefined, 'tenant-key-1'), undefined)

const agentOne = buildClaudeConversationIdentity(context({ sessionId: 'shared-session', agentId: 'agent-1' }), undefined, 'tenant-key-1')
const agentTwo = buildClaudeConversationIdentity(context({ sessionId: 'shared-session', agentId: 'agent-2' }), undefined, 'tenant-key-1')
assert.notEqual(agentOne, agentTwo)

const tenantOne = buildClaudeConversationIdentity(context({ sessionId: 'shared-session' }), undefined, 'tenant-12345678-one')
const tenantTwo = buildClaudeConversationIdentity(context({ sessionId: 'shared-session' }), undefined, 'tenant-12345678-two')
assert.equal('tenant-12345678-one'.slice(0, 8), 'tenant-12345678-two'.slice(0, 8))
assert.notEqual(tenantOne, tenantTwo)

const compaction = buildClaudeConversationIdentity(context({ sessionId: 'shared-session', requestClass: 'compaction' }), undefined, 'tenant-key-1')
const auxiliary = buildClaudeConversationIdentity(context({ sessionId: 'shared-session', requestClass: 'auxiliary' }), undefined, 'tenant-key-1')
const futureClass = buildClaudeConversationIdentity(context({ sessionId: 'shared-session', requestClass: 'future-class-v2' }), undefined, 'tenant-key-1')
assert.notEqual(compaction, mainIdentity)
assert.notEqual(auxiliary, mainIdentity)
assert.notEqual(futureClass, mainIdentity)
assert.notEqual(compaction, auxiliary)

const fallbackContext = context({ promptId: 'prompt-stable' })
const fallbackIdentity = buildClaudeConversationIdentity(fallbackContext, 'body-conversation-id', 'tenant-key-1')
assert.equal(fallbackIdentity, buildClaudeConversationIdentity({ ...fallbackContext }, 'body-conversation-id', 'tenant-key-1'))
assert.notEqual(fallbackIdentity, buildClaudeConversationIdentity(fallbackContext, 'body-conversation-id', 'tenant-key-2'))
assert.notEqual(
    buildClaudeConversationIdentity(context({ sessionId: 'header-session' }), 'body-conversation-id', 'tenant-key-1'),
    fallbackIdentity
)
assert.equal(
    buildClaudeConversationIdentity(context({ sessionId: 'shared-session', contextCompacted: 'true' }), undefined, 'tenant-key-1'),
    buildClaudeConversationIdentity(context({ sessionId: 'shared-session', contextCompacted: 'false' }), undefined, 'tenant-key-1')
)

const incoming = {
    conversation_id: 'body-conversation-id',
    future_extension: { ttl: { seconds: 300 } },
    messages: [{ role: 'user', content: [{ type: 'future_block', payload: { untouched: true } }] }],
    tools: [{ name: 'lookup', input_schema: { type: 'object' }, future_tool_field: ['keep-me'] }]
}
const cloned = cloneClaudeRequest(incoming)
assert.deepEqual(cloned, incoming)
assert.notEqual(cloned, incoming)
assert.notEqual(cloned.future_extension, incoming.future_extension)
assert.notEqual(cloned.messages[0].content[0].payload, incoming.messages[0].content[0].payload)
assert.notEqual(cloned.tools[0].future_tool_field, incoming.tools[0].future_tool_field)
cloned.future_extension.ttl.seconds = 60
cloned.messages[0].content[0].payload.untouched = false
cloned.tools[0].future_tool_field.push('clone-only')
assert.equal(incoming.future_extension.ttl.seconds, 300)
assert.equal(incoming.messages[0].content[0].payload.untouched, true)
assert.deepEqual(incoming.tools[0].future_tool_field, ['keep-me'])

function claudeRequest(overrides = {}) {
    return {
        model: 'claude-sonnet-4.5',
        messages: [],
        max_tokens: 512,
        ...overrides
    }
}

assert.deepEqual(inspectClaudeCapabilities(claudeRequest({ context_management: {} })), [])
assert.deepEqual(inspectClaudeCapabilities(claudeRequest({ context_management: { edits: [] } })), [])
assert.throws(
    () => inspectClaudeCapabilities(claudeRequest({ context_management: { edits: [{ type: 'clear' }] } })),
    /context_management edits/
)

assert.deepEqual(inspectClaudeCapabilities(claudeRequest({ output_config: { effort: 'high' } })), [])
assert.throws(
    () => inspectClaudeCapabilities(claudeRequest({ output_config: { format: { type: 'json_schema' } } })),
    /output_config\.format/
)
assert.throws(
    () => inspectClaudeCapabilities(claudeRequest({ output_config: { task_budget: { type: 'tokens', total: 4096 } } })),
    /output_config\.task_budget/
)

assert.throws(
    () => inspectClaudeCapabilities(claudeRequest({ tools: [{ name: 'lookup', strict: true }] })),
    /tools\.strict/
)
assert.throws(
    () => inspectClaudeCapabilities(claudeRequest({ tools: [{ name: 'lookup', defer_loading: true }] })),
    /tools\.defer_loading/
)
assert.throws(
    () => inspectClaudeCapabilities(claudeRequest({ tools: [{ name: 'advisor', type: 'advisor_20260301' }] })),
    /Input tag 'advisor_20260301'/
)

for (const toolChoice of [
    { type: 'any' },
    { type: 'tool', name: 'lookup' },
    { type: 'auto', disable_parallel_tool_use: true }
]) {
    assert.throws(
        () => inspectClaudeCapabilities(claudeRequest({ tool_choice: toolChoice })),
        /tool_choice/
    )
}

const extensibleRequest = claudeRequest({
    future_top_level: { enabled: true, values: ['preserve'] },
    messages: [{ role: 'user', content: 'Hello.' }],
    tools: [{ name: 'lookup', type: 'custom', input_schema: { type: 'object' }, future_tool_field: { revision: 3 } }]
})
const extensibleSnapshot = structuredClone(extensibleRequest)
assert.deepEqual(inspectClaudeCapabilities(extensibleRequest), [])
assert.deepEqual(extensibleRequest, extensibleSnapshot)

for (const type of ['future_content_block', 'tool_reference']) {
    assert.throws(
        () => inspectClaudeCapabilities(claudeRequest({
            messages: [{ role: 'user', content: [{ type }] }]
        })),
        new RegExp(`messages content block type '${type}'`)
    )
}
assert.throws(
    () => inspectClaudeCapabilities(claudeRequest({
        tools: [{ name: 'lookup', type: 'tool_reference' }]
    })),
    /Input tag 'tool_reference'/
)
assert.throws(
    () => inspectClaudeCapabilities(claudeRequest({
        messages: [{ role: 'user', content: [null] }]
    })),
    /Claude content blocks require a type/
)

const ttlDiagnostics = inspectClaudeCapabilities(claudeRequest({
    cache_control: { type: 'ephemeral', ttl: '5m' },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral', ttl: '1h' } }] }]
}))
assert.ok(ttlDiagnostics.includes('cache_ttl_not_supported'))
assert.ok(ttlDiagnostics.includes('automatic_cache_control_not_supported'))

const internalCacheDiagnostics = inspectClaudeCapabilities(claudeRequest({
    messages: [{ role: 'user', content: [
        { type: 'text', text: 'first', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'second' }
    ] }]
}))
assert.ok(internalCacheDiagnostics.includes('internal_cache_boundary_not_supported'))

const mergedCacheDiagnostics = inspectClaudeCapabilities(claudeRequest({
    messages: [
        { role: 'user', content: 'first', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'second' }
    ]
}))
assert.ok(mergedCacheDiagnostics.includes('merged_cache_boundary_not_supported'))

const thinkingRequest = claudeRequest({
    messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'prior reasoning' }] }]
})
const thinkingSnapshot = structuredClone(thinkingRequest)
assert.deepEqual(inspectClaudeCapabilities(thinkingRequest), ['thinking_history_not_supported'])
assert.deepEqual(thinkingRequest, thinkingSnapshot)

console.log('compat-gateway: passed')
