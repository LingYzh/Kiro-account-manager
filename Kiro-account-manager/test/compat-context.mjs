import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const virtualFile = resolve(project, 'test/compat-context-bundle.cjs')
const isolatedDependencies = {
    name: 'context-test-isolation',
    setup(esbuild) {
        const stubs = {
            electron: 'export const app = { getPath() { return "" } }',
            '/src/main/proxy/logger.ts': 'export const proxyLogger = { info() {}, warn() {}, error() {}, debug() {} }',
            '/src/main/kproxy/index.ts': 'export function getKProxyService() { return undefined }'
        }
        esbuild.onResolve({ filter: /.*/ }, args => {
            if (args.path === 'electron') return { path: 'electron', namespace: 'context-test-stub' }
            if (!args.importer || !args.path.startsWith('.')) return
            const resolved = `${resolve(dirname(args.importer), args.path).replaceAll('\\', '/')}.ts`
            const stubKey = Object.keys(stubs).find(key => resolved.endsWith(key))
            if (stubKey) return { path: stubKey, namespace: 'context-test-stub' }
        })
        esbuild.onLoad({ filter: /.*/, namespace: 'context-test-stub' }, args => ({
            contents: stubs[args.path],
            loader: 'ts'
        }))
    }
}
const compiled = await build({
    stdin: {
        contents: `
            export { claudeToKiro, openaiToKiro } from '../src/main/proxy/translator'
            export { setEnableTokenBufferReserve, setPayloadSizeLimitKB, setTokenBufferReserve }
                from '../src/main/proxy/kiroApi'
            export { PayloadSizeLimitError } from '../src/main/proxy/requestErrors'
            export { setModelContextWindow } from '../src/main/proxy/tokenCounter'
        `,
        resolveDir: resolve(project, 'test'),
        loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins: [isolatedDependencies]
})
const bundledModule = new Module(virtualFile)
bundledModule.filename = virtualFile
bundledModule.paths = Module._nodeModulePaths(project)
bundledModule.require = createRequire(virtualFile)
bundledModule._compile(compiled.outputFiles[0].text, virtualFile)
const {
    claudeToKiro, openaiToKiro, setEnableTokenBufferReserve,
    setPayloadSizeLimitKB, setTokenBufferReserve, setModelContextWindow,
    PayloadSizeLimitError
} = bundledModule.exports

function claude(messages, extra = {}) {
    return claudeToKiro({ model: 'claude-sonnet-4.5', max_tokens: 512, messages, ...extra })
}

const lookupTool = { name: 'lookup', description: 'Look up a record.', input_schema: { type: 'object', properties: {} } }

function sequence(payload) {
    return [...(payload.conversationState.history || []), payload.conversationState.currentMessage]
}

function userTexts(payload) {
    return sequence(payload).flatMap(message =>
        message.userInputMessage ? [message.userInputMessage.content] : [])
}

function assertNoDirective(payload) {
    assert.doesNotMatch(JSON.stringify(payload), /execution_discipline/)
}

const first = claude([
    { role: 'system', content: 'Enter plan mode.' },
    { role: 'user', content: 'Task one.' },
    { role: 'assistant', content: 'Planned.' },
    { role: 'system', content: [
        { type: 'text', text: 'Exit plan mode.', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Proceed with implementation.' }
    ] },
    { role: 'user', content: 'Task two.' }
], { system: [{ type: 'text', text: 'Top rule.', cache_control: { type: 'ephemeral' } }] })
const firstTexts = userTexts(first)
assert.match(firstTexts[0], /^\[Context: Current time is /)
assert.match(firstTexts[0], /Top rule\./)
assert.deepEqual(first.conversationState.history[0].userInputMessage.cachePoint, { type: 'default' })
assert.ok(firstTexts.some(text => text === 'Enter plan mode.\nTask one.'))
assert.equal(first.conversationState.currentMessage.userInputMessage.content,
    'Exit plan mode.\nProceed with implementation.\nTask two.')
assert.deepEqual(first.conversationState.currentMessage.userInputMessage.cachePoint, { type: 'default' })
assertNoDirective(first)

const middle = claude([
    { role: 'user', content: 'Start.' },
    { role: 'assistant', content: 'Started.' },
    { role: 'system', content: 'Enter review mode.' },
    { role: 'system', content: 'Review carefully.' },
    { role: 'user', content: 'Review this.' },
    { role: 'assistant', content: 'Reviewed.' },
    { role: 'system', content: 'Exit review mode.' }
])
assert.ok(userTexts(middle).some(text => text === 'Enter review mode.\nReview carefully.\nReview this.'))
assert.equal(middle.conversationState.currentMessage.userInputMessage.content, 'Exit review mode.')

const toolPair = claude([
    { role: 'user', content: 'Look up the record.' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'lookup', input: { id: 1 } }] },
    { role: 'system', content: 'Use the returned facts.' },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'Record found.' }] }
], { tools: [lookupTool] })
const pairedMessages = sequence(toolPair)
const callIndex = pairedMessages.findIndex(message =>
    message.assistantResponseMessage?.toolUses?.some(call => call.toolUseId === 'call_1'))
assert.ok(callIndex >= 0)
assert.equal(pairedMessages[callIndex + 1].userInputMessage.userInputMessageContext.toolResults[0].toolUseId, 'call_1')
assert.equal(pairedMessages[callIndex + 1].userInputMessage.userInputMessageContext.toolResults[0].content[0].text, 'Record found.')
assert.match(pairedMessages[callIndex + 1].userInputMessage.content, /Use the returned facts\./)

assert.throws(() => claude([{ role: 'developer', content: 'Unsupported.' }]), /Unsupported Claude message role/)
assert.throws(() => claude([{ role: 'system', content: [{ type: 'image' }] }]), /Unsupported Claude system content block/)

const openai = openaiToKiro({
    model: 'claude-sonnet-4.5',
    messages: [
        { role: 'system', content: [
            { type: 'text', text: 'OpenAI top rule.' },
            { type: 'text', text: 'Keep the boundary.', cache_control: { type: 'ephemeral' } }
        ] },
        { role: 'user', content: 'Hello.' }
    ]
})
assert.match(userTexts(openai)[0], /OpenAI top rule\./)
assert.match(userTexts(openai)[0], /OpenAI top rule\.\nKeep the boundary\./)
assert.deepEqual(openai.conversationState.history[0].userInputMessage.cachePoint, { type: 'default' })
assertNoDirective(openai)

// 默认关闭裁剪时，大历史与工具输出末尾必须保持字节级内容。
const longHistory = 'history:' + 'h'.repeat(65000) + ':history-end'
const longResult = 'result:' + 'r'.repeat(90000) + ':result-end'
setEnableTokenBufferReserve(false)
const untrimmed = claude([
    { role: 'user', content: longHistory },
    { role: 'assistant', content: 'Earlier answer.' },
    { role: 'user', content: 'Run lookup.' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call_large', name: 'lookup', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_large', content: longResult }] }
], { tools: [lookupTool] })
assert.ok(userTexts(untrimmed).some(text => text.endsWith(':history-end')))
assert.equal(untrimmed.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content[0].text, longResult)

// 开启显式裁剪时顶层 system 和当前工具闭环仍应存在。
setModelContextWindow('claude-sonnet-4.5', 12000)
setTokenBufferReserve(5000)
setEnableTokenBufferReserve(true)
const trimmed = claude([
    { role: 'user', content: 'old:' + 'a'.repeat(50000) },
    { role: 'assistant', content: 'Old answer.' },
    { role: 'user', content: 'Use lookup.' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call_recent', name: 'lookup', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_recent', content: 'Recent result.' }] }
], { system: 'Always keep this top-level rule.', tools: [lookupTool] })
assert.match(userTexts(trimmed)[0], /Always keep this top-level rule\./)
assert.ok(!userTexts(trimmed).some(text => text.startsWith('old:')))
const trimmedPair = sequence(trimmed)
const recentCallIndex = trimmedPair.findIndex(message =>
    message.assistantResponseMessage?.toolUses?.some(call => call.toolUseId === 'call_recent'))
assert.ok(recentCallIndex >= 0)
assert.equal(trimmedPair[recentCallIndex + 1].userInputMessage.userInputMessageContext.toolResults[0].toolUseId, 'call_recent')

// 中途 system 的作用域无法安全推断；即使开了裁剪也须完整保留，超 byte 限额则拒绝。
const preserved = claude([
    { role: 'system', content: 'Keep this scoped rule.' },
    { role: 'user', content: 'old:' + 'b'.repeat(50000) },
    { role: 'assistant', content: 'Old answer.' },
    { role: 'user', content: 'Latest.' }
])
assert.ok(userTexts(preserved).some(text => text.includes('Keep this scoped rule.')))
assert.ok(userTexts(preserved).some(text => text.includes('old:')))

setPayloadSizeLimitKB(256)
assert.throws(() => claude([
    { role: 'system', content: 'Retain all turns.' },
    { role: 'user', content: 'too large:' + '中'.repeat(100000) }
]), error => error instanceof PayloadSizeLimitError && error.statusCode === 413)

console.log('Context compatibility checks passed')
