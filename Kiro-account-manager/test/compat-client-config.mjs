import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'kiro-client-config-'))

try {
    const compiled = await build({
        stdin: {
            contents: "export { configureProxyClients } from './src/main/proxy/clientConfig'; export { toClaudeClientModelId, matchesClientModelPattern } from './src/main/proxy/modelIdentity'",
            resolveDir: project,
            loader: 'ts'
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        plugins: [{
            name: 'isolated-homedir',
            setup(esbuild) {
                esbuild.onResolve({ filter: /^os$/ }, () => ({ path: 'os', namespace: 'isolated-homedir' }))
                esbuild.onLoad({ filter: /.*/, namespace: 'isolated-homedir' }, () => ({
                    contents: `export function homedir() { return ${JSON.stringify(tempDir)} }`,
                    loader: 'js'
                }))
            }
        }]
    })
    const virtualFile = resolve(project, 'test/compat-client-config-bundle.cjs')
    const bundledModule = new Module(virtualFile)
    bundledModule.filename = virtualFile
    bundledModule.paths = Module._nodeModulePaths(project)
    bundledModule.require = createRequire(virtualFile)
    bundledModule._compile(compiled.outputFiles[0].text, virtualFile)
    const { configureProxyClients, toClaudeClientModelId, matchesClientModelPattern } = bundledModule.exports

    for (const [input, expected] of [
        ['claude-opus-5.5', 'claude-opus-5-5'],
        ['claude-sonnet-4.6-20260101', 'claude-sonnet-4-6-20260101'],
        ['claude-opus-5.5[1m]', 'claude-opus-5-5[1m]'],
        ['claude-3.7-sonnet', 'claude-3-7-sonnet'],
        ['claude-opus-5-5', 'claude-opus-5-5'],
        ['claude-sonnet-5', 'claude-sonnet-5'],
        ['gpt-5.6-sol', 'gpt-5.6-sol'],
        ['custom-claude-opus-5.5', 'custom-claude-opus-5.5'],
        ['claude-opus-5.5-custom', 'claude-opus-5.5-custom'],
        ['CLAUDE_SONNET_4_20250514_V1_0', 'CLAUDE_SONNET_4_20250514_V1_0']
    ]) assert.equal(toClaudeClientModelId(input), expected)
    for (const [model, pattern] of [
        ['claude-opus-5-5', 'claude-opus-5.5'],
        ['claude-opus-5.5', 'claude-opus-5-5'],
        ['claude-opus-5-5', 'claude-opus-5.*'],
        ['claude-opus-5.5', 'claude-opus-5-*'],
        ['claude-sonnet-4-6[1m]', 'claude-sonnet-4.6[1m]'],
        ['claude-3-7-sonnet', 'claude-3.7-*']
    ]) assert.equal(matchesClientModelPattern(model, pattern), true, `${model} should match ${pattern}`)
    assert.equal(matchesClientModelPattern('claude-opus-5x5', 'claude-opus-5.5'), false)
    assert.equal(matchesClientModelPattern('claude-opus-5.5', 'claude-opus-5.5[1m]'), false)
    assert.equal(matchesClientModelPattern('gpt-5.6-sol', 'claude-*'), false)
    assert.equal(matchesClientModelPattern('unmatched', '['), false, 'literal brackets cannot produce an invalid regex')

    const claudePath = join(tempDir, '.claude', 'settings.json')
    const openCodePath = join(tempDir, '.config', 'opencode', 'opencode.json')
    await mkdir(dirname(claudePath), { recursive: true })
    await mkdir(dirname(openCodePath), { recursive: true })
    const originalClaude = JSON.stringify({
        env: { KEEP_ME: 'untouched', ANTHROPIC_MODEL: 'old-model' },
        permissions: { allow: ['Read'] },
        customSetting: { enabled: true }
    }, null, 2) + '\n'
    await writeFile(claudePath, originalClaude, 'utf8')
    await writeFile(openCodePath, JSON.stringify({ theme: 'custom' }), 'utf8')

    const input = {
        clients: ['claudeCode', 'opencode'],
        host: '127.0.0.1',
        port: 3300,
        apiKey: 'test-key',
        modelId: 'claude-sonnet-4.5',
        models: [
            { id: 'claude-sonnet-4.5' },
            { id: 'claude-opus-5.5' },
            { id: 'claude-haiku-4.5' }
        ]
    }
    const first = await configureProxyClients(input)
    assert.equal(first.success, true)
    const claude = JSON.parse(await readFile(claudePath, 'utf8'))
    assert.equal(claude.env.ANTHROPIC_MODEL, 'claude-sonnet-4-5')
    assert.equal(claude.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-sonnet-4-5')
    assert.equal(claude.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-opus-5-5')
    assert.equal(claude.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'claude-haiku-4-5')
    assert.equal(claude.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1')
    assert.equal(claude.env.KEEP_ME, 'untouched')
    assert.deepEqual(claude.permissions, { allow: ['Read'] })
    assert.deepEqual(claude.customSetting, { enabled: true })
    assert.equal(Object.keys(claude.env).some(key => key.endsWith('_SUPPORTED_CAPABILITIES')), false)
    assert.equal(first.results[0].backupPaths.length, 1)
    assert.equal(await readFile(first.results[0].backupPaths[0], 'utf8'), originalClaude)

    const openCode = JSON.parse(await readFile(openCodePath, 'utf8'))
    assert.equal(openCode.model, 'kiro/claude-sonnet-4.5')
    assert.ok(Object.hasOwn(openCode.provider.kiro.models, 'claude-opus-5.5'))
    assert.equal(openCode.theme, 'custom')

    const opus = await configureProxyClients({ ...input, clients: ['claudeCode'], modelId: 'claude-opus-5.5' })
    assert.equal(opus.success, true)
    const opusClaude = JSON.parse(await readFile(claudePath, 'utf8'))
    assert.equal(opusClaude.env.ANTHROPIC_MODEL, 'claude-opus-5-5')

    const rawIds = await configureProxyClients({ ...input, clients: ['claudeCode'], claudeModelIdMappingEnabled: false })
    assert.equal(rawIds.success, true)
    const rawClaude = JSON.parse(await readFile(claudePath, 'utf8'))
    assert.equal(rawClaude.env.ANTHROPIC_MODEL, 'claude-sonnet-4.5')
    assert.equal(rawClaude.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-opus-5.5')
    assert.equal(rawClaude.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'claude-haiku-4.5')
    assert.equal(rawClaude.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1')

    const unknown = await configureProxyClients({ ...input, clients: ['claudeCode'], modelId: 'custom.experimental-1', models: [] })
    assert.equal(unknown.success, true)
    const unknownClaude = JSON.parse(await readFile(claudePath, 'utf8'))
    assert.equal(unknownClaude.env.ANTHROPIC_MODEL, 'custom.experimental-1')
    assert.equal(unknownClaude.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'custom.experimental-1')
    assert.equal(unknownClaude.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'custom.experimental-1')
    assert.equal(unknownClaude.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'claude-haiku-4-5')

    console.log('Client configuration compatibility checks passed')
} finally {
    await rm(tempDir, { recursive: true, force: true })
}
