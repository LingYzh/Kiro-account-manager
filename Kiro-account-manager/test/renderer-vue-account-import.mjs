import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const bundle = await build({
    entryPoints: [resolve('src/renderer-vue/src/lib/accountFileImport.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': resolve('src/renderer-shared') }
})
const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
const { parseAccountFile, parseCsvLine, AccountImportParseError } = await import(url)

assert.deepEqual(parseCsvLine('"one, two","a""b", plain'), ['one, two', 'a"b', 'plain'])

const fullExport = {
    version: 'synthetic-v1',
    exportedAt: 1,
    accounts: [{ email: 'export@example.invalid', credentials: { refreshToken: 'synthetic' } }],
    groups: [{ id: 'group-export', name: 'Exported', order: 0, createdAt: 1 }],
    tags: [{ id: 'tag-export', name: 'Exported', color: '#80abcdef' }]
}
assert.deepEqual(parseAccountFile(JSON.stringify(fullExport), 'json', 'group-current'), {
    kind: 'export',
    data: fullExport
})

const csv =
    '\ufeff"邮箱","昵称","登录方式","RefreshToken","ClientId","ClientSecret","Region"\n' +
    '"comma@example.invalid","Name, ""quoted""","Github","synthetic-refresh","","","eu-west-1"\r\n' +
    '"skip@example.invalid","No token","Google","","","",""'
assert.deepEqual(parseAccountFile(csv, 'csv', 'group-current'), {
    kind: 'accounts',
    source: 'csv',
    items: [
        {
            email: 'comma@example.invalid',
            nickname: 'Name, "quoted"',
            idp: 'Github',
            refreshToken: 'synthetic-refresh',
            clientId: '',
            clientSecret: '',
            region: 'eu-west-1',
            groupId: 'group-current'
        }
    ]
})

assert.deepEqual(
    parseAccountFile(
        'a@example.invalid,token-a,A,Google\nb@example.invalid|token-b|B|Github',
        'txt'
    ),
    {
        kind: 'accounts',
        source: 'txt',
        items: [
            {
                email: 'a@example.invalid',
                refreshToken: 'token-a',
                nickname: 'A',
                idp: 'Google',
                groupId: undefined
            },
            {
                email: 'b@example.invalid',
                refreshToken: 'token-b',
                nickname: 'B',
                idp: 'Github',
                groupId: undefined
            }
        ]
    }
)

const kami = parseAccountFile(
    'social@example.invalid\tno_password\tsynthetic-token\t\t\n' +
        'idc@example.invalid----synthetic-pass----synthetic-token----client-id----client-secret----BuilderId',
    'txt',
    'group-current'
)
assert.equal(kami.kind, 'accounts')
assert.equal(kami.source, 'kami')
assert.deepEqual(kami.items, [
    {
        email: 'social@example.invalid',
        password: undefined,
        refreshToken: 'synthetic-token',
        clientId: undefined,
        clientSecret: undefined,
        idp: 'Google',
        groupId: 'group-current'
    },
    {
        email: 'idc@example.invalid',
        password: 'synthetic-pass',
        refreshToken: 'synthetic-token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        idp: 'BuilderId',
        groupId: 'group-current'
    }
])

for (const delimiter of ['\t', '  ']) {
    const line = [
        'tab@example.invalid',
        'synthetic-pass',
        'synthetic-token',
        'client-id',
        'client-secret',
        'Github'
    ].join(delimiter)
    const parsed = parseAccountFile(line, 'txt')
    assert.equal(parsed.kind, 'accounts')
    assert.equal(parsed.source, 'kami')
    assert.equal(parsed.items[0].idp, 'Github')
    assert.equal(parsed.items[0].clientSecret, 'client-secret')
}

for (const [content, format, code] of [
    ['{}', 'json', 'invalid-json'],
    ['broken', 'json', 'invalid-json'],
    ['header only', 'csv', 'empty-csv'],
    ['email,token\ninvalid,', 'csv', 'empty-csv-accounts'],
    ['# comment\n', 'txt', 'empty-txt-accounts'],
    ['anything', 'xml', 'unsupported-format']
]) {
    assert.throws(
        () => parseAccountFile(content, format),
        (error) => error instanceof AccountImportParseError && error.code === code
    )
}

console.log('renderer-vue-account-import: JSON, CSV, TXT, credential and error formats passed')
