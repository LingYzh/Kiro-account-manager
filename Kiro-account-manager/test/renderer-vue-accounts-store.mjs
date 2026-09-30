import { runAccountsStoreScenarios } from './renderer-accounts-scenarios.mjs'

await runAccountsStoreScenarios(
    'test/fixtures/vue-accounts-adapter.ts',
    'src/renderer-vue/src',
    'renderer-vue-accounts-store'
)
