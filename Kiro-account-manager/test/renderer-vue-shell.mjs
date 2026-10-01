/* Test driver callbacks are local to the Electron harness. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { access, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(join(project, 'package.json'))
const { resolveConfig } = await import(pathToFileURL(require.resolve('electron-vite')).href)
const { createServer, build } = await import(pathToFileURL(require.resolve('vite')).href)
const artifactDir = await mkdtemp(join(tmpdir(), 'kam-vue-shell-'))
const fixture = fileURLToPath(new URL('./fixtures/vue-shell-electron.cjs', import.meta.url))
const electron = require('electron')
const reports = []
let server
const originalElectronViteEnvironment = process.env.NODE_ENV_ELECTRON_VITE
const sourceIndex = process.argv.indexOf('--ui-source')
assert.ok(
    sourceIndex === -1 || (sourceIndex === 2 && process.argv.length === 4),
    'Usage: test:vue-shell [--ui-source ABSOLUTE_PATH]'
)
const uiSource = sourceIndex === -1 ? null : await realpath(resolve(process.argv[sourceIndex + 1]))
let candidate = null
if (uiSource) {
    const manifest = JSON.parse(await readFile(join(uiSource, 'package.json'), 'utf8'))
    assert.equal(manifest.name, '@lingyzh/ui', '--ui-source must name @lingyzh/ui')
    await Promise.all([
        access(join(uiSource, 'src/ui/index.ts')),
        access(join(uiSource, 'src/ui/styles.css'))
    ])
    candidate = { name: manifest.name, version: manifest.version, path: uiSource }
    console.log(`Candidate UI source: ${candidate.name}@${candidate.version} ${candidate.path}`)
} else {
    const manifest = JSON.parse(
        await readFile(join(project, 'node_modules/@lingyzh/ui/package.json'), 'utf8')
    )
    console.log(`Installed UI dependency: ${manifest.name}@${manifest.version}`)
}

function rendererWithCandidate(renderer) {
    if (!candidate) return renderer
    const existingAliases = Object.entries(renderer.resolve?.alias ?? {}).map(
        ([find, replacement]) => ({
            find,
            replacement
        })
    )
    return {
        ...renderer,
        resolve: {
            ...renderer.resolve,
            alias: [
                {
                    find: /^@lingyzh\/ui\/styles\.css$/,
                    replacement: join(uiSource, 'src/ui/styles.css')
                },
                { find: /^@lingyzh\/ui$/, replacement: join(uiSource, 'src/ui/index.ts') },
                ...existingAliases
            ]
        },
        server: {
            ...renderer.server,
            fs: {
                ...renderer.server?.fs,
                allow: [...(renderer.server?.fs?.allow ?? []), project, uiSource]
            }
        }
    }
}

function assertDefaultVueRenderer(renderer, command) {
    const vueRoot = resolve(project, 'src/renderer-vue')
    const vueSource = join(vueRoot, 'src')
    const sharedSource = resolve(project, 'src/renderer-shared')
    const input = renderer.build?.rollupOptions?.input
    const aliases = renderer.resolve?.alias
    const aliasValue = (name) =>
        Array.isArray(aliases)
            ? aliases.find((entry) => entry.find === name)?.replacement
            : aliases?.[name]

    assert.equal(
        renderer.root && resolve(renderer.root),
        vueRoot,
        `${command} default renderer root`
    )
    assert.equal(typeof input, 'string', `${command} default renderer build input must be a file`)
    assert.equal(resolve(input), join(vueRoot, 'index.html'), `${command} default renderer input`)
    assert.equal(aliasValue('@') && resolve(aliasValue('@')), vueSource, `${command} @ alias`)
    assert.equal(
        aliasValue('@renderer') && resolve(aliasValue('@renderer')),
        vueSource,
        `${command} @renderer alias`
    )
    assert.equal(
        aliasValue('@shared') && resolve(aliasValue('@shared')),
        sharedSource,
        `${command} @shared alias`
    )
}

async function unusedPort() {
    const probe = createNetServer()
    await new Promise((resolveReady) => probe.listen(0, '127.0.0.1', resolveReady))
    const port = probe.address().port
    await new Promise((resolveClose) => probe.close(resolveClose))
    return port
}

async function child(mode, url) {
    const environment = {
        ...process.env,
        KAM_SHELL_MODE: mode,
        KAM_SHELL_URL: url,
        KAM_SHELL_ARTIFACT_DIR: artifactDir,
        KAM_SHELL_CANDIDATE: candidate ? JSON.stringify(candidate) : '',
        KAM_SHELL_DEV_PREWARMED: candidate && mode === 'dev' ? '1' : '0'
    }
    delete environment.ELECTRON_RUN_AS_NODE
    const processHandle = spawn(electron, [fixture], {
        cwd: project,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    processHandle.stdout.setEncoding('utf8').on('data', (chunk) => {
        stdout += chunk
    })
    processHandle.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr += chunk
    })
    const exitCode = await new Promise((resolveExit, reject) => {
        processHandle.once('error', reject)
        processHandle.once('close', (code) => resolveExit(code))
    })
    const report = JSON.parse(await readFile(join(artifactDir, `${mode}-report.json`), 'utf8'))
    reports.push(report)
    assert.equal(
        exitCode,
        0,
        `${mode} Electron test failed: ${JSON.stringify(report.errors)}\n${stdout}\n${stderr}`
    )
    assert.equal(
        report.errors.length,
        0,
        `${mode} renderer errors: ${JSON.stringify(report.errors)}`
    )
    console.log(`${mode}: ${report.checks.length} checks passed`)
}

try {
    process.env.NODE_ENV_ELECTRON_VITE = 'development'
    const { config: dev } = await resolveConfig({}, 'serve')
    assertDefaultVueRenderer(dev.renderer, 'serve')
    const port = await unusedPort()
    server = await createServer({
        ...rendererWithCandidate(dev.renderer),
        cacheDir: join(artifactDir, 'vite-cache'),
        server: {
            ...rendererWithCandidate(dev.renderer).server,
            host: '127.0.0.1',
            port,
            strictPort: true,
            hmr: { port, clientPort: port }
        }
    })
    await server.listen()
    if (candidate) {
        await server.warmupRequest('/src/main.js')
        await server.waitForRequestsIdle()
        console.log('Candidate dev server prewarmed before Electron load')
    }
    const devUrl = server.resolvedUrls.local[0]
    await child('dev', devUrl)
    await server.close()
    server = null

    process.env.NODE_ENV_ELECTRON_VITE = 'production'
    const { config: production } = await resolveConfig({}, 'build')
    assertDefaultVueRenderer(production.renderer, 'build')
    const outDir = join(artifactDir, 'built-renderer')
    await build({
        ...rendererWithCandidate(production.renderer),
        logLevel: 'error',
        build: {
            ...production.renderer.build,
            outDir,
            emptyOutDir: true
        }
    })
    await child('prod', pathToFileURL(join(outDir, 'index.html')).href)
    console.log(`Vue shell screenshots and reports: ${artifactDir}`)
} catch (error) {
    console.error(error)
    console.error(`Vue shell artifacts preserved: ${artifactDir}`)
    process.exitCode = 1
} finally {
    await server?.close()
    if (originalElectronViteEnvironment === undefined) delete process.env.NODE_ENV_ELECTRON_VITE
    else process.env.NODE_ENV_ELECTRON_VITE = originalElectronViteEnvironment
}
