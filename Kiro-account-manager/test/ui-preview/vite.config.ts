import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const previewDir = dirname(fileURLToPath(import.meta.url))
const project = resolve(previewDir, '../..')

export default defineConfig({
    root: previewDir,
    resolve: {
        alias: {
            '@': resolve(project, 'src/renderer/src')
        }
    },
    plugins: [react(), tailwindcss()],
    server: {
        host: '127.0.0.1',
        port: 5175,
        strictPort: true
    }
})
