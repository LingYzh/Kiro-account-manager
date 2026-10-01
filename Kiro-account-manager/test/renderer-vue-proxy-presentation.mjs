/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const bundle = await build({
    entryPoints: [resolve('src/renderer-vue/src/lib/proxyPoolPresentation.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': resolve('src/renderer-shared') }
})
const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
const { computePoolHealth, filterProxies } = await import(url)
const now = Date.UTC(2026, 9, 1)
const makeProxy = (id, values = {}) => ({
    id,
    host: `${id}.invalid`,
    port: 8080,
    protocol: 'http',
    url: `http://${id}.invalid:8080`,
    status: 'untested',
    enabled: true,
    usedCount: 0,
    failCount: 0,
    ...values
})
const proxies = [
    makeProxy('alive', {
        status: 'alive',
        latencyMs: 199,
        usedCount: 8,
        failCount: 2,
        lastTestedAt: now - 3600000,
        username: 'synthetic-user',
        tags: ['blue'],
        source: 'manual'
    }),
    makeProxy('slow', {
        status: 'slow',
        latencyMs: 200,
        usedCount: 4,
        failCount: 1,
        lastTestedAt: now - 86400000,
        lastBoundEmail: 'bound@example.invalid'
    }),
    makeProxy('dead', {
        status: 'dead',
        latencyMs: 1000,
        usedCount: 2,
        failCount: 9,
        lastTestedAt: now - 8 * 86400000,
        enabled: false
    }),
    makeProxy('untested', { label: 'Fresh proxy' }),
    makeProxy('testing', { status: 'testing', latencyMs: 0 })
]
const health = computePoolHealth(proxies)
assert.deepEqual(
    [
        health.total,
        health.enabled,
        health.alive,
        health.slow,
        health.dead,
        health.untested,
        health.testing
    ],
    [5, 4, 1, 1, 1, 1, 1]
)
assert.equal(health.totalUsed, 14)
assert.equal(health.totalFailed, 12)
assert.equal(health.totalSuccess, 2)
assert.equal(health.successRate, 2 / 14)
assert.equal(health.avgLatencyMs, 200)
assert.deepEqual(
    health.topUsed.map((entry) => entry.id),
    ['alive', 'slow', 'dead']
)
assert.equal(health.topUsed[2].success, 0)

const all = {
    text: '',
    status: 'all',
    protocol: 'all',
    enabled: 'all',
    latency: 'all',
    testedWithin: 'all'
}
const ids = (patch) => filterProxies(proxies, { ...all, ...patch }, now).map((item) => item.id)
assert.deepEqual(ids({ latency: 'fast' }), ['alive', 'testing'])
assert.deepEqual(ids({ latency: 'medium' }), ['slow'])
assert.deepEqual(ids({ latency: 'slow' }), ['dead'])
assert.deepEqual(ids({ latency: 'unknown' }), ['untested'])
assert.deepEqual(ids({ testedWithin: '1h' }), ['alive'])
assert.deepEqual(ids({ testedWithin: '1d' }), ['alive', 'slow'])
assert.deepEqual(ids({ testedWithin: '7d' }), ['alive', 'slow'])
assert.deepEqual(ids({ testedWithin: 'never' }), ['untested', 'testing'])
assert.deepEqual(ids({ status: 'dead', enabled: 'disabled' }), ['dead'])
for (const field of ['synthetic-user', 'blue', 'manual'])
    assert.deepEqual(ids({ text: field }), ['alive'])
assert.deepEqual(ids({ text: 'bound@example.invalid' }), ['slow'])
assert.deepEqual(ids({ text: 'fresh proxy' }), ['untested'])
assert.deepEqual(
    ids({ text: '8080' }),
    proxies.map((proxy) => proxy.id)
)

console.log('Vue proxy presentation golden checks passed')
