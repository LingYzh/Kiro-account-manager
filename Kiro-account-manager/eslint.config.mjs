import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import eslintPluginVue from 'eslint-plugin-vue'
import vueEslintParser from 'vue-eslint-parser'

// 按字段名（不按数组下标）合并官方 flat/recommended 里每一档的 rules，避免插件升级后
// 数组项数/顺序变化时静默丢规则；parser、processor 等按项区分的设置不从这里提取，
// 而是在下方配置块里显式声明。
const vueRecommendedRules = eslintPluginVue.configs['flat/recommended'].reduce(
  (merged, config) => ({ ...merged, ...(config.rules ?? {}) }),
  {}
)

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  {
    // React 规则块不作用于 Vue 渲染层：flat.recommended/jsx-runtime 本身没有 files 限定，
    // 用 ignores 排除 renderer-vue 即可，不改变 React 侧原有匹配范围。
    ...eslintPluginReact.configs.flat.recommended,
    ignores: ['src/renderer-vue/**']
  },
  {
    ...eslintPluginReact.configs.flat['jsx-runtime'],
    ignores: ['src/renderer-vue/**']
  },
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/renderer-vue/**'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // Vue 渲染层：.vue 用 vue-eslint-parser，脚本内容仍交给 typescript-eslint parser
    // 解析（script setup 目前是 JS，但复用同一 parser 便于 Task 4+ 引入 TS 语法）。
    files: ['src/renderer-vue/**/*.{js,vue}'],
    plugins: {
      vue: eslintPluginVue
    },
    languageOptions: {
      sourceType: 'module',
      parser: vueEslintParser,
      parserOptions: {
        parser: tseslint.parser
      }
    },
    // 缺少 processor 会导致 vue/comment-directive 内部用于消化 template 注释指令的
    // "clear" 占位报告直接冒出成真实 error，必须显式挂上官方 processor 才能被吞掉。
    processor: 'vue/vue',
    rules: {
      // 合并 eslint-plugin-vue@10.11.1 官方 flat/recommended 数组里的全部规则档位
      // （base 无 rules 字段 / essential / strongly-recommended / recommended），
      // 按 rules 字段名合并而不是按数组下标取，插件升级后数组项数或顺序变化也不会
      // 静默丢规则或漏合并。parser/processor 由本配置块显式声明，不从该数组提取。
      ...vueRecommendedRules,
      'vue/html-indent': ['error', 4],
      // 业务 SFC 使用 JavaScript，TS 基础模块仍保留原返回类型规则。
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
