import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(
    new URL('../node_modules/electron-vite/bin/electron-vite.js', import.meta.url)
)
if (!existsSync(cli)) {
    process.stderr.write(`Electron Vite CLI not found: ${cli}\n`)
    process.exitCode = 1
} else {
    let ready = true
    if (process.platform === 'win32' && (process.stdout.isTTY || process.stderr.isTTY)) {
        const systemRoot = process.env.SystemRoot
        if (!systemRoot || !isAbsolute(systemRoot)) {
            process.stderr.write('SystemRoot is unavailable; cannot set the console code page.\n')
            ready = false
        } else {
            const chcp = join(systemRoot, 'System32', 'chcp.com')
            const result = spawnSync(chcp, ['65001'], { stdio: 'inherit' })
            if (result.error || result.status !== 0) {
                process.stderr.write(
                    `Failed to set console code page: ${result.error?.message || result.status}\n`
                )
                ready = false
            }
        }
    }
    if (ready) {
        const child = spawn(process.execPath, [cli, 'dev', ...process.argv.slice(2)], {
            stdio: 'inherit'
        })
        child.on('error', (error) => {
            process.stderr.write(`Failed to start Electron Vite: ${error.message}\n`)
            process.exitCode = 1
        })
        child.on('exit', (code) => {
            process.exitCode = code ?? 1
        })
    } else {
        process.exitCode = 1
    }
}
