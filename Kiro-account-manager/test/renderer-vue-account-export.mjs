import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const bundle = await build({
    entryPoints: [resolve('src/renderer-vue/src/lib/accountExport.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node'
})
const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
const { formatAccountExport } = await import(url)
const account = {
    id: 'synthetic-account',
    email: 'offline@example.invalid',
    password: 'synthetic-password',
    nickname: 'A,"B',
    idp: 'Github',
    credentials: {
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        csrfToken: 'synthetic-csrf',
        clientId: 'synthetic-client',
        clientSecret: 'synthetic-secret',
        region: 'eu-west-1',
        expiresAt: 1,
        unrelatedCredential: 'retained'
    },
    subscription: { type: 'Pro', title: 'Pro,"Plan' },
    usage: { current: 3, limit: 10, percentUsed: 30, lastUpdated: 1 },
    tags: ['tag-a'],
    groupId: 'group-a',
    status: 'active',
    isActive: true,
    createdAt: 1,
    lastUsedAt: 1
}
const accounts = [account]
const { isActive, ...exportAccount } = account
void isActive
const exportData = {
    version: 'synthetic-version',
    exportedAt: 123,
    accounts: [exportAccount],
    groups: [{ id: 'group-a', name: 'Synthetic group', order: 0, createdAt: 1 }],
    tags: [{ id: 'tag-a', name: 'Synthetic tag', color: '#123456' }]
}
const expectedMaskedData = {
    ...exportData,
    accounts: [
        {
            ...exportAccount,
            credentials: {
                ...account.credentials,
                accessToken: '',
                refreshToken: '',
                csrfToken: ''
            }
        }
    ]
}
assert.equal(
    formatAccountExport('json', accounts, true, exportData),
    JSON.stringify(exportData, null, 2)
)
assert.equal(
    formatAccountExport('json', accounts, false, exportData),
    JSON.stringify(expectedMaskedData, null, 2)
)
assert.equal(exportData.accounts[0].credentials.accessToken, 'synthetic-access')
assert.deepEqual(exportData.groups, [
    { id: 'group-a', name: 'Synthetic group', order: 0, createdAt: 1 }
])
assert.throws(() => formatAccountExport('json', accounts, true), /required/)

const oidc = JSON.stringify(
    [
        {
            email: account.email,
            refreshToken: 'synthetic-refresh',
            provider: 'Github',
            password: 'synthetic-password',
            clientId: 'synthetic-client',
            clientSecret: 'synthetic-secret'
        }
    ],
    null,
    2
)
assert.equal(formatAccountExport('oidc', accounts, true), oidc)
assert.equal(formatAccountExport('oidc', accounts, false), oidc)

assert.equal(
    formatAccountExport('txt', accounts, true),
    'offline@example.invalid,synthetic-refresh,A,"B,Github'
)
assert.equal(
    formatAccountExport('txt', accounts, false),
    '邮箱: offline@example.invalid\n昵称: A,"B\n登录方式: Github\n订阅: Pro,"Plan\n用量: 3/10'
)
assert.equal(
    formatAccountExport('csv', accounts, true),
    '\ufeff"邮箱","昵称","登录方式","RefreshToken","ClientId","ClientSecret","Region"\n' +
        '"offline@example.invalid","A,""B","Github","synthetic-refresh","synthetic-client","synthetic-secret","eu-west-1"'
)
assert.equal(
    formatAccountExport('csv', accounts, false),
    '\ufeff"邮箱","昵称","登录方式","订阅类型","订阅标题","已用量","总额度"\n' +
        '"offline@example.invalid","A,""B","Github","Pro","Pro,""Plan","3","10"'
)
const kami =
    'offline@example.invalid----synthetic-password----synthetic-refresh----synthetic-client----synthetic-secret----Github'
assert.equal(formatAccountExport('kami', accounts, true), kami)
assert.equal(formatAccountExport('kami', accounts, false), kami)
assert.equal(
    formatAccountExport('clipboard', accounts, true),
    'offline@example.invalid,synthetic-refresh'
)
assert.equal(
    formatAccountExport('clipboard', accounts, false),
    'offline@example.invalid (A,"B) - Pro,"Plan'
)

const minimal = [
    {
        ...account,
        password: undefined,
        idp: undefined,
        credentials: { accessToken: '', csrfToken: '', expiresAt: 1 }
    }
]
assert.equal(
    formatAccountExport('oidc', minimal, false),
    JSON.stringify([{ email: account.email, refreshToken: '', provider: 'BuilderId' }], null, 2)
)
assert.equal(
    formatAccountExport('kami', minimal, false),
    'offline@example.invalid----no_password----------------BuilderId'
)
console.log('renderer-vue-account-export: six synthetic export formats passed')
