import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// electron-vite's conventional source root is src/renderer; KAM keeps its Vue source path.
export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()]
    },
    preload: {
        plugins: [externalizeDepsPlugin()]
    },
    renderer: {
        root: resolve('src/renderer-vue'),
        resolve: {
            alias: {
                '@renderer': resolve('src/renderer-vue/src'),
                '@': resolve('src/renderer-vue/src'),
                '@shared': resolve('src/renderer-shared')
            },
            dedupe: ['vue']
        },
        optimizeDeps: {
            // Compile UI source SFCs with Vue and explicitly prebundle their nested CJS dependencies.
            exclude: ['@lingyzh/ui'],
            include: [
                '@lingyzh/ui > highlight.js/lib/core',
                '@lingyzh/ui > highlight.js/lib/languages/xml',
                '@lingyzh/ui > highlight.js/lib/languages/javascript',
                '@lingyzh/ui > highlight.js/lib/languages/typescript',
                '@lingyzh/ui > highlight.js/lib/languages/css',
                '@lingyzh/ui > highlight.js/lib/languages/json',
                '@lingyzh/ui > markdown-it',
                '@lingyzh/ui > markdown-it-footnote',
                '@lingyzh/ui > markdown-it-task-lists',
                '@lingyzh/ui > markdown-it-deflist',
                '@lingyzh/ui > markdown-it-mark',
                '@lingyzh/ui > markdown-it-sub',
                '@lingyzh/ui > markdown-it-sup'
            ]
        },
        build: {
            rollupOptions: {
                input: resolve('src/renderer-vue/index.html')
            }
        },
        plugins: [
            vue({
                template: {
                    compilerOptions: {
                        isCustomElement: (tag) => tag === 'selectedcontent'
                    }
                }
            })
        ]
    }
})
