import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const bundle = await build({
    entryPoints: [resolve('src/renderer-vue/src/lib/registration.js')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': resolve('src/renderer-shared') }
})
const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
const {
    REGISTER_STORAGE,
    buildManualSteps,
    classifyError,
    createSourcePicker,
    diagnoseRegError,
    injectProxySession,
    loadRegisterConfig,
    nextProtonEmail,
    phaseToStep,
    shuffleOutlookLines
} = await import(url)

const values = new Map()
globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
}
values.set(REGISTER_STORAGE.config, JSON.stringify({ mode: 'moemail', batchRetries: 3 }))
values.set(REGISTER_STORAGE.mixedSources, JSON.stringify(['moemail', 'proton', 'gptmail']))
assert.equal(loadRegisterConfig().mode, 'outlook')
assert.equal(loadRegisterConfig().batchRetries, 3)
assert.deepEqual(loadRegisterConfig().mixedEnabledSources, ['proton', 'gptmail'])

const pick = createSourcePicker()
const sequence = Array.from({ length: 8 }, () =>
    pick(['outlook', 'proton'], { outlook: 3, proton: 1 })
)
assert.equal(sequence.filter((source) => source === 'outlook').length, 6)
assert.equal(sequence.filter((source) => source === 'proton').length, 2)
const zeroPick = createSourcePicker()
assert.deepEqual(
    Array.from({ length: 4 }, () => zeroPick(['outlook', 'proton'], { outlook: 0, proton: 0 })),
    ['outlook', 'proton', 'outlook', 'proton']
)
const mixedZeroPick = createSourcePicker()
assert.deepEqual(
    Array.from({ length: 10 }, () =>
        mixedZeroPick(['outlook', 'proton'], { outlook: 3, proton: 0 })
    ),
    [
        'outlook',
        'outlook',
        'outlook',
        'proton',
        'outlook',
        'outlook',
        'outlook',
        'outlook',
        'outlook',
        'proton'
    ]
)

assert.equal(
    injectProxySession('http://user_area-us:secret@proxy.invalid:8080', () => 0),
    'http://user_area-us_session-aaaaaaaa:secret@proxy.invalid:8080'
)
assert.equal(
    injectProxySession('http://user:secret@proxy.invalid:8080', () => 0),
    'http://user:secret@proxy.invalid:8080'
)
assert.equal(
    injectProxySession('socks5://user:{session}@proxy.invalid:1080', () => 0),
    'socks5://user:aaaaaaaa@proxy.invalid:1080'
)
assert.deepEqual(
    shuffleOutlookLines('a----b\ninvalid\nc----d', () => 0),
    ['c----d', 'a----b']
)

const used = new Set()
const first = nextProtonEmail('offline@protonmail.com', used)
assert.match(first, /@protonmail\.com$/)
used.add(first.toLowerCase())
assert.notEqual(nextProtonEmail('offline@protonmail.com', used), first)
assert.equal(nextProtonEmail('invalid', used), null)

const steps = buildManualSteps(true, true)
assert.deepEqual(steps, [
    'OIDC',
    'Email',
    'Verify',
    'Password',
    'Token',
    'Import',
    'ProLink',
    'Done'
])
assert.equal(phaseToStep('importing', '', steps), 5)
assert.equal(phaseToStep('fetching-link', '', steps), 6)
assert.equal(phaseToStep('finalized', '', steps), 7)
assert.equal(classifyError('AWS-RISK-CONTROL: try again later'), 'risk_control')
assert.equal(classifyError('proxychain EOF'), 'network')
assert.equal(classifyError('OTP timeout'), 'otp_timeout')
assert.equal(classifyError('email already exists'), 'email_used')
assert.equal(diagnoseRegError('610 whitelist').category, 'proxy_whitelist')
assert.equal(diagnoseRegError('suspended').category, 'suspended')

console.log('Vue registration pure helpers passed')
