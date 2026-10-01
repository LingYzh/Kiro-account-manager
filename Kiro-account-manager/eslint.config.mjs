import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'
import vueEslintParser from 'vue-eslint-parser'

const vueRecommendedRules = eslintPluginVue.configs['flat/recommended'].reduce(
    (merged, config) => ({ ...merged, ...(config.rules ?? {}) }),
    {}
)

export default defineConfig(
    { ignores: ['**/node_modules', '**/dist', '**/out'] },
    tseslint.configs.recommended,
    {
        files: ['**/*.{js,mjs,cjs}'],
        rules: {
            '@typescript-eslint/explicit-function-return-type': 'off'
        }
    },
    {
        files: ['src/renderer-vue/**/*.{js,vue}'],
        plugins: { vue: eslintPluginVue },
        languageOptions: {
            sourceType: 'module',
            parser: vueEslintParser,
            parserOptions: { parser: tseslint.parser }
        },
        // The official processor consumes template comment directives.
        processor: 'vue/vue',
        rules: {
            ...vueRecommendedRules,
            'vue/html-indent': ['error', 4],
            '@typescript-eslint/explicit-function-return-type': 'off'
        }
    },
    eslintConfigPrettier
)
