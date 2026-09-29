import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// Every file lives in an explicit temporary root; never redirect or read the real HOME.
const temporary = await mkdtemp(join(tmpdir(), 'kam-desktop-config-'))
try {
    const bundle = join(temporary, 'config.mjs')
    await build({
        stdin: { contents: "export * from './src/main/clientConfig/claudeDesktop'; export * from './src/main/clientConfig/fileTransaction'; export * from './src/shared/desktopConfig'", resolveDir: resolve('.'), loader: 'ts' },
        bundle: true, platform: 'node', format: 'esm', outfile: bundle
    })
    const { ClaudeDesktopConfigService, FileTransactionStore, DESKTOP_PROFILE_ID, defaultDesktopRoutes, latestClaudeModel, resolveDesktopModel, desktopConfigRoot, desktopGatewayOrigin, desktopClientModelId, desktopModelName, validateDesktopInput } = await import(pathToFileURL(bundle).href)
    const root = join(temporary, 'fresh')
    const state = join(temporary, 'state')
    const service = new ClaudeDesktopConfigService(root, state)
    const connection = { host: '0.0.0.0', port: 5580, apiKey: 'fixture-secret-do-not-preview' }
    const input = defaultDesktopRoutes([
        { id: 'claude-opus-4.8' }, { id: 'claude-opus-4.6' }, { id: 'claude-opus-5' },
        { id: 'claude-sonnet-4.5' }, { id: 'claude-sonnet-4.6' }, { id: 'claude-haiku-4.5' }
    ])
    assert.equal(desktopModelName('claude-opus-5'), 'Claude Opus 5')
    assert.equal(desktopModelName('claude-sonnet-4.6'), 'Claude Sonnet 4.6')
    assert.equal(desktopModelName('claude-3-7-sonnet-20250219'), 'Claude Sonnet 3.7')
    assert.equal(input.routes[0].modelId, 'claude-opus-5')
    assert.equal(input.routes[1].modelId, 'claude-sonnet-4.6')
    assert.equal(latestClaudeModel([{ id: 'claude-3-7-sonnet-20250219' }, { id: 'claude-sonnet-4-5-20250929' }], 'sonnet'), 'claude-sonnet-4-5-20250929')
    assert.equal(latestClaudeModel([{ id: 'gpt-5.6-sol' }], 'haiku'), '')
    assert.equal(desktopClientModelId(input.routes[0]), 'claude-opus-5')
    assert.equal(desktopClientModelId(input.routes[1]), 'claude-sonnet-4-6')
    assert.equal(desktopClientModelId({ ...input.routes[0], modelId: 'claude-opus-4.8' }), 'claude-opus-4-8')
    assert.equal(desktopClientModelId({ ...input.routes[0], modelId: 'claude-3.7-sonnet-20250219' }), 'claude-3-7-sonnet-20250219')
    assert.equal(resolveDesktopModel(input, 'claude-opus-5'), 'claude-opus-5')
    assert.throws(() => resolveDesktopModel(input, 'claude-opus-4-6'), /Unknown/)
    assert.throws(() => validateDesktopInput({ ...input, routes: [...input.routes, { ...input.routes[0], id: 'claude-opus-5-kam-2' }] }), /Duplicate/)
    input.routes[0].modelId = 'gpt-5.6-sol'
    input.routes.push({ id: 'claude-sonnet-4-6-kam-2', family: 'sonnet', label: 'Qwen', modelId: 'qwen3-coder-next' })
    assert.equal(resolveDesktopModel(input, input.routes[0].id), 'gpt-5.6-sol')
    assert.equal(resolveDesktopModel(input, 'haiku'), 'claude-haiku-4.5')
    assert.throws(() => resolveDesktopModel(input, 'unknown'), /Unknown/)
    assert.equal(desktopGatewayOrigin({ ...connection, host: '::' }), 'http://[::1]:5580')
    assert.throws(() => desktopGatewayOrigin({ ...connection, host: '192.168.1.2' }), /HTTPS/)
    assert.equal(desktopConfigRoot('win32', { LOCALAPPDATA: root }), root)
    assert.equal(desktopConfigRoot('darwin', {}, '/home/test'), join('/home/test', 'Library', 'Application Support'))

    const preview = await service.preview(input, connection)
    assert.equal(preview.files.length, 5)
    assert.equal(preview.files.every(file => !file.exists && file.changed), true)
    assert.equal(JSON.stringify(preview).includes(connection.apiKey), false)
    await assert.rejects(access(root))
    const applied = await service.apply(preview.token, connection)
    assert.equal(applied.status, 'applied')
    const profilePath = join(root, 'Claude-3p', 'configLibrary', `${DESKTOP_PROFILE_ID}.json`)
    const profile = JSON.parse(await readFile(profilePath, 'utf8'))
    assert.equal(profile.inferenceGatewayBaseUrl, 'http://127.0.0.1:5580/claude-desktop')
    assert.equal(profile.inferenceGatewayApiKey, connection.apiKey)
    assert.equal(profile.inferenceModels[0].name, input.defaultRouteId)
    assert.equal(profile.inferenceModels.length, 4)
    assert.deepEqual(profile.inferenceModels.map(model => model.labelOverride), ['Claude Sonnet 4.6', 'GPT 5.6 Sol', 'Claude Haiku 4.5', 'Qwen3 Coder Next'])
    assert.equal(Object.hasOwn(profile, 'coworkEgressAllowedHosts'), false)
    const metadata = JSON.parse(await readFile(join(root, 'Claude-3p', 'configLibrary', '_meta.json'), 'utf8'))
    assert.equal(metadata.appliedId, DESKTOP_PROFILE_ID)
    for (const dir of ['Claude', 'Claude-3p']) {
        assert.equal(JSON.parse(await readFile(join(root, dir, 'claude_desktop_config.json'), 'utf8')).deploymentMode, '3p')
    }
    // Persisted routes and restore history survive a process restart.
    const restarted = new ClaudeDesktopConfigService(root, state)
    assert.deepEqual(await restarted.readRoutes(), { ...input, routes: input.routes.map(route => ({ ...route, label: desktopModelName(route.modelId) })) })
    const same = await restarted.preview(input, connection)
    assert.equal(same.files.every(file => !file.changed), true)
    assert.equal(await restarted.apply(same.token, connection), null)
    await restarted.transactions.restore(applied.id)
    await assert.rejects(access(profilePath))
    assert.equal(await restarted.readRoutes(), undefined)

    // Existing settings and other managers' profiles remain intact. Byte-exact restore.
    const settingsPath = join(root, 'Claude', 'claude_desktop_config.json')
    const original = '\uFEFF{\r\n  "mcpServers": {"fixture": {"command":"test"}}, "deploymentMode": "1p"\r\n}\r\n'
    await writeFile(settingsPath, original)
    const metaPath = join(root, 'Claude-3p', 'configLibrary', '_meta.json')
    await writeFile(metaPath, JSON.stringify({ entries: [{ id: 'another-profile', name: 'Other' }], appliedId: 'another-profile', extra: true }))
    const next = await service.preview(input, connection)
    const nextApplied = await service.apply(next.token, connection)
    assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')).mcpServers, { fixture: { command: 'test' } })
    assert.equal(JSON.parse(await readFile(metaPath, 'utf8')).entries.length, 2)
    await writeFile(settingsPath, '{"userEdited":true}')
    await assert.rejects(service.transactions.restore(nextApplied.id), /conflict/)
    assert.equal(await readFile(settingsPath, 'utf8'), '{"userEdited":true}')
    // Restore after the conflicting file has been put back to the KAM-written state.
    const plannedSettings = JSON.parse(original.replace(/^\uFEFF/, ''))
    plannedSettings.deploymentMode = '3p'
    await writeFile(settingsPath, JSON.stringify(plannedSettings, null, 4) + '\n')
    await service.transactions.restore(nextApplied.id)
    assert.equal(await readFile(settingsPath, 'utf8'), original)

    // Invalid last file prevents every write, and errors do not echo secrets.
    await writeFile(settingsPath, '{"secret":"fixture-secret-do-not-preview", BROKEN')
    await assert.rejects(service.preview(input, connection), error => /Invalid JSON/.test(error.message) && !error.message.includes(connection.apiKey))
    await assert.rejects(access(profilePath))
    await writeFile(settingsPath, original)
    const stale = await service.preview(input, connection)
    await writeFile(settingsPath, '{}')
    await assert.rejects(service.apply(stale.token, connection), /changed since preview/)
    await assert.rejects(access(profilePath))
    const changedConnection = await service.preview(input, connection)
    await assert.rejects(service.apply(changedConnection.token, { ...connection, port: 9999 }), /Proxy settings changed/)

    // Inject an OS write failure after the first publish: restore both new and existing files.
    const tx = new FileTransactionStore(join(temporary, 'transaction-tests'))
    const first = join(temporary, 'first.json')
    const second = join(temporary, 'second.json')
    await writeFile(first, 'before')
    const files = [{ path: first, before: Buffer.from('before'), after: Buffer.from('after'), fields: [] }, { path: second, before: null, after: Buffer.from('new'), fields: [] }]
    await assert.rejects(tx.apply(files, async index => { if (index === 1) throw new Error('simulated failure') }), /simulated failure/)
    assert.equal(await readFile(first, 'utf8'), 'before')
    await assert.rejects(access(second))
    assert.equal((await tx.list())[0].status, 'restored')

    // Concurrent external modification blocks rollback without destroying the external content.
    await assert.rejects(tx.apply(files, async index => {
        if (index === 1) { await writeFile(first, 'external'); throw new Error('simulated failure') }
    }), /recovery required/)
    assert.equal(await readFile(first, 'utf8'), 'external')
    const pending = (await tx.list()).find(operation => operation.status === 'pending')
    assert.ok(pending)
    await assert.rejects(tx.apply(files), /Recover/)
    await writeFile(first, 'after')
    await new FileTransactionStore(join(temporary, 'transaction-tests')).restore(pending.id)
    assert.equal(await readFile(first, 'utf8'), 'before')
    console.log('PASS Desktop configuration: fresh bootstrap, mappings, preservation, idempotence, preview conflicts, rollback and restart recovery')
} finally {
    await rm(temporary, { recursive: true, force: true })
}
