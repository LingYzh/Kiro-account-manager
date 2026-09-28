import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { ReadableStream } from 'node:stream/web'
import { build } from 'esbuild'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const virtualFile = resolve(project, 'test/compat-usage-bundle.cjs')
const isolatedDependencies = {
    name: 'usage-test-isolation',
    setup(esbuild) {
        const stubs = {
            electron: 'export const app = { getPath() { return "" } }',
            '/src/main/proxy/logger.ts': 'export const proxyLogger = { info() {}, warn() {}, error() {}, debug() {} }',
            '/src/main/kproxy/index.ts': 'export function getKProxyService() { return undefined }'
        }
        esbuild.onResolve({ filter: /.*/ }, args => {
            if (args.path === 'electron') return { path: 'electron', namespace: 'usage-test-stub' }
            if (!args.importer || !args.path.startsWith('.')) return
            const resolved = `${resolve(dirname(args.importer), args.path).replaceAll('\\', '/')}.ts`
            const stubKey = Object.keys(stubs).find(key => resolved.endsWith(key))
            if (stubKey) return { path: stubKey, namespace: 'usage-test-stub' }
        })
        esbuild.onLoad({ filter: /.*/, namespace: 'usage-test-stub' }, args => ({
            contents: stubs[args.path],
            loader: 'ts'
        }))
    }
}
const compiled = await build({
    stdin: {
        contents: "export { buildKiroPayload, injectSystemPrompts, parseEventStream } from '../src/main/proxy/kiroApi'",
        resolveDir: resolve(project, 'test'),
        loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [isolatedDependencies],
    write: false
})
const bundledModule = new Module(virtualFile)
bundledModule.filename = virtualFile
bundledModule.paths = Module._nodeModulePaths(project)
bundledModule.require = createRequire(virtualFile)
bundledModule._compile(compiled.outputFiles[0].text, virtualFile)
const { buildKiroPayload, injectSystemPrompts, parseEventStream } = bundledModule.exports

const textEncoder = new TextEncoder()

function fixtureCrc32(bytes) {
    let value = 0xffffffff
    for (const byte of bytes) {
        value ^= byte
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
        }
    }
    return (value ^ 0xffffffff) >>> 0
}

function concatBytes(...parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0)
    const result = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}

function encodeStringHeader(name, value) {
    const nameBytes = textEncoder.encode(name)
    const valueBytes = textEncoder.encode(value)
    return concatBytes(
        Uint8Array.of(nameBytes.length),
        nameBytes,
        Uint8Array.of(7),
        Uint8Array.of((valueBytes.length >>> 8) & 0xff, valueBytes.length & 0xff),
        valueBytes
    )
}

function makeFrame(headers, payload) {
    const totalLength = 12 + headers.length + payload.length + 4
    const frame = new Uint8Array(totalLength)
    const view = new DataView(frame.buffer)
    view.setUint32(0, totalLength, false)
    view.setUint32(4, headers.length, false)
    view.setUint32(8, fixtureCrc32(frame.subarray(0, 8)), false)
    frame.set(headers, 12)
    frame.set(payload, 12 + headers.length)
    view.setUint32(totalLength - 4, fixtureCrc32(frame.subarray(0, totalLength - 4)), false)
    return frame
}

function eventFrame(type, data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    return makeFrame(encodeStringHeader(':event-type', type), textEncoder.encode(payload))
}

async function parseUsage(frames) {
    const chunks = []
    const body = new ReadableStream({
        start(controller) {
            for (const frame of frames) controller.enqueue(frame)
            controller.close()
        }
    })
    let usage
    let error
    await parseEventStream(
        body,
        (text) => { chunks.push(text) },
        (result) => { usage = result },
        (failure) => { error = failure },
        24,
        undefined,
        'claude-sonnet-4-5',
        'synthetic offline payload'
    )
    if (error) throw error
    assert.ok(usage, 'the synthetic EventStream should complete')
    return { usage, chunks }
}

assert.equal(injectSystemPrompts('stable system', false, false), 'stable system', 'system prompt injection must not add a moving timestamp')
const whitespacePreserved = buildKiroPayload('  keep boundary whitespace  ', 'model', 'AI_EDITOR')
assert.equal(
    whitespacePreserved.conversationState.currentMessage.userInputMessage.content,
    '  keep boundary whitespace  ',
    'current user content must keep its exact prefix and suffix whitespace'
)

const realBreakdown = await parseUsage([
    eventFrame('messageMetadataEvent', {
        messageMetadataEvent: {
            tokenUsage: {
                uncachedInputTokens: 40,
                cacheReadInputTokens: 15,
                cacheWriteInputTokens: 5,
                outputTokens: 7
            }
        }
    })
])
assert.equal(realBreakdown.usage.inputTokens, 60)
assert.equal(realBreakdown.usage.cacheReadTokens, 15)
assert.equal(realBreakdown.usage.cacheWriteTokens, 5)
assert.equal(realBreakdown.usage.outputTokens, 7)

const realZeroes = await parseUsage([
    eventFrame('usageEvent', { usageEvent: { inputTokens: 0, outputTokens: 0 } }),
    eventFrame('messageMetadataEvent', {
        messageMetadataEvent: {
            tokenUsage: {
                uncachedInputTokens: 0,
                cacheReadInputTokens: 0,
                cacheWriteInputTokens: 0,
                outputTokens: 0,
                totalTokens: 0
            }
        }
    })
])
assert.equal(realZeroes.usage.inputTokens, 0, 'real input zero must replace the initial estimate')
assert.equal(realZeroes.usage.outputTokens, 0, 'real output zero must remain zero')
assert.equal(realZeroes.usage.cacheReadTokens, 0, 'real cache read zero must be retained')
assert.equal(realZeroes.usage.cacheWriteTokens, 0, 'real cache write zero must be retained')

const missingCacheFields = await parseUsage([
    eventFrame('messageMetadataEvent', {
        messageMetadataEvent: { tokenUsage: { outputTokens: 7 } }
    })
])
assert.ok(missingCacheFields.usage.inputTokens > 0, 'missing input telemetry should retain the estimate')
assert.equal(Object.hasOwn(missingCacheFields.usage, 'cacheReadTokens'), false, 'missing cache read usage must stay unknown')
assert.equal(Object.hasOwn(missingCacheFields.usage, 'cacheWriteTokens'), false, 'missing cache write usage must stay unknown')

const estimatedInputBaseline = await parseUsage([eventFrame('unknownEvent', { unknownEvent: {} })])
const uncachedWithoutCacheBreakdown = await parseUsage([
    eventFrame('messageMetadataEvent', {
        messageMetadataEvent: { tokenUsage: { uncachedInputTokens: 42, outputTokens: 7 } }
    })
])
assert.equal(uncachedWithoutCacheBreakdown.usage.uncachedInputTokens, 42, 'real uncached input should be retained separately')
assert.equal(uncachedWithoutCacheBreakdown.usage.inputTokens, estimatedInputBaseline.usage.inputTokens, 'uncached alone is not a complete total input breakdown')
assert.equal(Object.hasOwn(uncachedWithoutCacheBreakdown.usage, 'cacheReadTokens'), false)
assert.equal(Object.hasOwn(uncachedWithoutCacheBreakdown.usage, 'cacheWriteTokens'), false)

const totalOverridesEstimate = await parseUsage([
    eventFrame('messageMetadataEvent', {
        messageMetadataEvent: { tokenUsage: { totalTokens: 100, outputTokens: 8 } }
    })
])
assert.equal(totalOverridesEstimate.usage.inputTokens, 92, 'total minus output must override the nonzero estimate')

const partialMetadataRetainsCache = await parseUsage([
    eventFrame('messageMetadataEvent', {
        messageMetadataEvent: {
            tokenUsage: {
                uncachedInputTokens: 10,
                cacheReadInputTokens: 20,
                cacheWriteInputTokens: 3,
                outputTokens: 5
            }
        }
    }),
    eventFrame('metadataEvent', { metadataEvent: { tokenUsage: { uncachedInputTokens: 12, outputTokens: 0 } } })
])
assert.equal(partialMetadataRetainsCache.usage.inputTokens, 35)
assert.equal(partialMetadataRetainsCache.usage.cacheReadTokens, 20, 'omitted cache read must not clear the last real value')
assert.equal(partialMetadataRetainsCache.usage.cacheWriteTokens, 3, 'omitted cache write must not clear the last real value')
assert.equal(partialMetadataRetainsCache.usage.outputTokens, 0)

const explicitInputIsTotal = await parseUsage([
    eventFrame('messageMetadataEvent', {
        messageMetadataEvent: {
            tokenUsage: { cacheReadInputTokens: 5, cacheWriteInputTokens: 2 },
            inputTokens: 100
        }
    })
])
assert.equal(explicitInputIsTotal.usage.inputTokens, 100, 'explicit inputTokens must not have cache tokens added again')
assert.equal(explicitInputIsTotal.usage.cacheReadTokens, 5)
assert.equal(explicitInputIsTotal.usage.cacheWriteTokens, 2)

const contextDoesNotOverrideRealBreakdown = await parseUsage([
    eventFrame('contextUsageEvent', { contextUsageEvent: { contextUsagePercentage: 80 } }),
    eventFrame('messageMetadataEvent', {
        messageMetadataEvent: {
            tokenUsage: {
                uncachedInputTokens: 45,
                cacheReadInputTokens: 10,
                cacheWriteInputTokens: 5,
                outputTokens: 3
            }
        }
    })
])
assert.equal(contextDoesNotOverrideRealBreakdown.usage.inputTokens, 60)

const realOutputZeroSuppressesFallback = await parseUsage([
    eventFrame('assistantResponseEvent', { assistantResponseEvent: { content: 'some generated text' } }),
    eventFrame('messageMetadataEvent', { messageMetadataEvent: { tokenUsage: { outputTokens: 0 } } })
])
assert.ok(realOutputZeroSuppressesFallback.chunks.some((chunk) => chunk.includes('generated text')))
assert.equal(realOutputZeroSuppressesFallback.usage.outputTokens, 0, 'real output zero must suppress output estimation')

const invalidCounts = await parseUsage([
    eventFrame('messageMetadataEvent', '{"messageMetadataEvent":{"tokenUsage":{"uncachedInputTokens":-1,"cacheReadInputTokens":-2,"cacheWriteInputTokens":1e10000,"outputTokens":-3,"totalTokens":1e10000}}}')
])
assert.ok(invalidCounts.usage.inputTokens > 0, 'invalid input counts must not replace the estimate')
assert.equal(invalidCounts.usage.outputTokens, 0, 'invalid output counts must not replace the fallback value')
assert.equal(Object.hasOwn(invalidCounts.usage, 'cacheReadTokens'), false)
assert.equal(Object.hasOwn(invalidCounts.usage, 'cacheWriteTokens'), false)

const creditsStayScalar = await parseUsage([
    eventFrame('meteringEvent', { meteringEvent: { usage: 1.25 } }),
    eventFrame('meteringEvent', { meteringEvent: { usage: -2 } }),
    eventFrame('meteringEvent', '{"meteringEvent":{"usage":1e10000}}'),
    eventFrame('meteringEvent', { meteringEvent: { usage: { inputTokens: 99, cacheReadInputTokens: 88 } } })
])
assert.equal(creditsStayScalar.usage.credits, 1.25, 'only finite nonnegative scalar metering usage contributes credits')
assert.equal(Object.hasOwn(creditsStayScalar.usage, 'cacheReadTokens'), false, 'metering objects must not be inferred as token usage')
assert.equal(Object.hasOwn(creditsStayScalar.usage, 'cacheWriteTokens'), false, 'metering objects must not be inferred as token usage')

console.log('compat-usage: passed')
