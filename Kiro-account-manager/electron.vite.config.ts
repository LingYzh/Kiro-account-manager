import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// electron-vite 默认渲染层入口固定为 src/renderer/index.html，
// 因此 --mode vue 时必须显式改写 root 与 rollupOptions.input，否则仍会打包 React 入口。
export default defineConfig(({ mode }) => ({
    main: {
        plugins: [externalizeDepsPlugin()]
    },
    preload: {
        plugins: [externalizeDepsPlugin()]
    },
    renderer:
        mode === 'vue'
            ? {
                  root: resolve('src/renderer-vue'),
                  resolve: {
                      alias: {
                          '@renderer': resolve('src/renderer-vue/src'),
                          '@': resolve('src/renderer-vue/src'),
                          '@shared': resolve('src/renderer-shared')
                      },
                      dedupe: ['vue']
                  },
                  build: {
                      rollupOptions: {
                          input: resolve('src/renderer-vue/index.html')
                      }
                  },
                  plugins: [vue()]
              }
            : {
                  resolve: {
                      alias: {
                          '@renderer': resolve('src/renderer/src'),
                          '@': resolve('src/renderer/src'),
                          '@shared': resolve('src/renderer-shared')
                      }
                  },
                  plugins: [react(), tailwindcss()]
              }
}))
