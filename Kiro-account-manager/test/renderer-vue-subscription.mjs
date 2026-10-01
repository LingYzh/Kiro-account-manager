import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const bundle = await build({
    entryPoints: [resolve('src/renderer-vue/src/lib/subscription.js')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node'
})
const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
const {
    checkUpgradeEligibility,
    isFreeForBatch,
    isSubscribed,
    parseImportedLinks,
    subscriptionUrlArgs,
    subscriptionAccountArgs,
    overageArgs
} = await import(url)

const account = {
    id: 'synthetic-id',
    email: 'offline@example.invalid',
    status: 'active',
    subscription: { type: 'Free', title: 'FREE Tier' },
    credentials: {
        accessToken: 'synthetic-token',
        region: 'eu-west-1',
        provider: 'Github',
        authMethod: 'social'
    },
    profileArn: 'synthetic-profile',
    machineId: 'synthetic-machine',
    idp: 'BuilderId'
}
assert.equal(checkUpgradeEligibility(account).eligible, true)
assert.equal(isFreeForBatch(account), true)
assert.equal(isSubscribed(account), false)
assert.equal(checkUpgradeEligibility({ ...account, credentials: {} }).reason, 'no-token')
assert.equal(
    checkUpgradeEligibility({ ...account, subscription: { type: 'Pro' } }).reason,
    'already-pro'
)
assert.equal(
    checkUpgradeEligibility({ ...account, subscription: { type: 'Mystery' } }).reason,
    'unknown-status'
)
const banned = { ...account, status: 'error', lastError: 'Temporarily suspended' }
assert.equal(checkUpgradeEligibility(banned).reason, 'banned')
assert.equal(isFreeForBatch(banned), true)
const cannotUpgrade = {
    ...account,
    subscription: { type: 'Free', upgradeCapability: 'NOT_ALLOWED' }
}
assert.equal(checkUpgradeEligibility(cannotUpgrade).reason, 'cant-upgrade')
assert.equal(isFreeForBatch(cannotUpgrade), true)
assert.equal(isSubscribed({ ...account, subscription: { title: 'Teams' } }), true)

assert.deepEqual(subscriptionAccountArgs(account), [
    'synthetic-token',
    'eu-west-1',
    'synthetic-profile',
    'synthetic-machine',
    'Github',
    'social',
    'synthetic-id'
])
assert.deepEqual(subscriptionUrlArgs(account, 'PRO'), [
    'synthetic-token',
    'PRO',
    'eu-west-1',
    'synthetic-profile',
    'synthetic-machine',
    'Github',
    'social',
    'synthetic-id'
])
assert.deepEqual(overageArgs(account, 'ENABLED'), subscriptionUrlArgs(account, 'ENABLED'))
assert.equal(
    subscriptionAccountArgs({ ...account, credentials: { accessToken: 'synthetic-token' } })[4],
    'BuilderId'
)
assert.deepEqual(
    parseImportedLinks(
        'offline@example.invalid ---- https://example.invalid/path),\nhttps://example.invalid/other\nno-link'
    ),
    [
        { email: 'offline@example.invalid', url: 'https://example.invalid/path' },
        { email: '', url: 'https://example.invalid/other' }
    ]
)

process.stdout.write('Vue subscription pure contract checks passed.\n')
