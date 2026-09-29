// Local visual fixture: real configuration service, synthetic models and temporary files only.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const temporary = await mkdtemp(join(tmpdir(), 'kam-desktop-ui-'))
const bundle = join(temporary, 'service.mjs')
await build({ entryPoints: ['src/main/clientConfig/claudeDesktop.ts'], bundle: true, platform: 'node', format: 'esm', outfile: bundle })
const { ClaudeDesktopConfigService } = await import(pathToFileURL(bundle).href)
const service = new ClaudeDesktopConfigService(join(temporary, 'client'), join(temporary, 'kam'))
const connection = { host: '127.0.0.1', port: 5580, apiKey: 'synthetic-key' }
const server = await createServer({
    configFile: false,
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), {
        name: 'isolated-config-fixture',
        configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
                if (req.url === '/') {
                    const html = await vite.transformIndexHtml('/', '<html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/test/client-config-preview.tsx"></script></body></html>')
                    res.setHeader('Content-Type', 'text/html')
                    res.end(html)
                } else if (req.url?.startsWith('/fixture/')) {
                    try {
                        let body = ''
                        for await (const chunk of req) body += chunk
                        const input = body ? JSON.parse(body) : undefined
                        const data = req.url === '/fixture/state' ? { input: await service.readRoutes(), operations: await service.transactions.list(), proxyRunning: false }
                            : req.url === '/fixture/preview' ? await service.preview(input, connection)
                            : req.url === '/fixture/apply' ? await service.apply(input, connection)
                            : req.url === '/fixture/restore' ? await service.transactions.restore(input) : null
                        res.setHeader('Content-Type', 'application/json')
                        res.end(JSON.stringify({ success: true, data }))
                    } catch (error) {
                        res.setHeader('Content-Type', 'application/json')
                        res.end(JSON.stringify({ success: false, error: error.message }))
                    }
                } else next()
            })
        }
    }],
    server: { host: '127.0.0.1', port: 5199, strictPort: true }
})
await server.listen()
console.log('Isolated Desktop configuration fixture: http://127.0.0.1:5199')
async function close() {
    await server.close()
    await rm(temporary, { recursive: true, force: true })
    process.exit(0)
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
