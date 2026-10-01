import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { extractFile, listPackage } = require('@electron/asar')
const electronBinary = require('electron')
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function normalizeArchivePath(entry) {
    return entry.replaceAll('\\', '/').replace(/^\/+/, '')
}

function containsPath(entries, path) {
    return entries.has(path)
}

function containsTree(entries, path) {
    for (const entry of entries) {
        if (entry === path || entry.startsWith(`${path}/`)) {
            return true
        }
    }
    return false
}

function checkArchive(archivePath) {
    const entries = new Set(listPackage(archivePath).map(normalizeArchivePath))

    for (const path of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']) {
        assert.ok(containsPath(entries, path), `Missing packaged file: ${path}`)
    }

    for (const path of ['src', 'test', 'scripts/dev.mjs']) {
        assert.ok(!containsTree(entries, path), `Unexpected packaged path: ${path}`)
    }

    for (const name of ['react', 'react-dom', 'zustand', 'tailwindcss', 'lucide-react']) {
        const path = `node_modules/${name}`
        assert.ok(!containsTree(entries, path), `Unexpected legacy runtime dependency: ${path}`)
    }

    const html = extractFile(archivePath, join('out', 'renderer', 'index.html')).toString('utf8')
    assert.match(html, /<[^>]+\bid\s*=\s*(["'])app\1/i, 'Renderer HTML must contain #app')

    const assetReferences = new Set()
    for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(["'])(\.\/assets\/[^"']+)\1/gi)) {
        const relativePath = decodeURIComponent(match[2].split(/[?#]/, 1)[0])
        assetReferences.add(`out/renderer/${relativePath.slice(2)}`)
    }
    assert.ok(assetReferences.size > 0, 'Renderer HTML must reference relative ./assets/ files')
    for (const asset of assetReferences) {
        assert.ok(containsPath(entries, asset), `Missing packaged renderer asset: ${asset}`)
    }

    return { assetCount: assetReferences.size, entryCount: entries.size }
}

function runOfflineFixture(archivePath, artifactDir) {
    const fixturePath = join(projectRoot, 'test', 'fixtures', 'vue-shell-electron.cjs')
    const rendererPath = join(archivePath, 'out', 'renderer', 'index.html')
    const environment = {
        ...process.env,
        KAM_SHELL_MODE: 'packaged',
        KAM_SHELL_URL: pathToFileURL(rendererPath).href,
        KAM_SHELL_PAGE_GROUPS: 'home,proxy',
        KAM_SHELL_ARTIFACT_DIR: artifactDir
    }
    delete environment.ELECTRON_RUN_AS_NODE

    return new Promise((resolve, reject) => {
        const child = spawn(electronBinary, [fixturePath], {
            cwd: projectRoot,
            env: environment,
            stdio: 'inherit',
            windowsHide: true
        })
        child.once('error', reject)
        child.once('exit', (code, signal) => resolve({ code, signal }))
    })
}

async function main() {
    const archivePath = process.argv[2]
    assert.ok(
        archivePath && process.argv.length === 3,
        'Usage: node test/renderer-packaged.mjs <absolute-app.asar>'
    )
    assert.ok(isAbsolute(archivePath), 'app.asar path must be absolute')
    assert.ok(
        existsSync(archivePath) && statSync(archivePath).isFile(),
        `app.asar file does not exist: ${archivePath}`
    )

    const archive = checkArchive(archivePath)
    const artifactDir = await mkdtemp(join(tmpdir(), 'kam-vue-packaged-'))
    const result = await runOfflineFixture(archivePath, artifactDir)
    const reportPath = join(artifactDir, 'packaged-report.json')
    let report
    try {
        report = JSON.parse(await readFile(reportPath, 'utf8'))
    } catch (error) {
        throw new Error(
            `Offline fixture did not produce ${reportPath}; exit=${result.code}, signal=${result.signal}`,
            { cause: error }
        )
    }

    assert.equal(result.code, 0, `Offline fixture failed; report: ${reportPath}`)
    assert.ok(Array.isArray(report.errors), `Invalid offline fixture errors in ${reportPath}`)
    assert.deepEqual(report.errors, [], `Offline fixture reported errors in ${reportPath}`)
    assert.ok(Array.isArray(report.checks), `Invalid offline fixture checks in ${reportPath}`)
    assert.equal(report.mode, 'packaged', 'Expected packaged entry report')
    assert.deepEqual(report.pageGroups, ['home', 'proxy'], 'Expected packaged page coverage')
    assert.ok(
        report.checks.includes('all page and app listeners released'),
        'Packaged fixture must complete page checks and release subscriptions'
    )
    console.log(
        `Packaged renderer: ${report.checks.length} offline checks passed; ${archive.assetCount} referenced assets present in ${archive.entryCount} archive entries.`
    )
    console.log(`Report and artifacts: ${artifactDir}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
