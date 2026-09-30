import { createPinia, setActivePinia } from 'pinia'
import { useAccountsStore as useVueAccountsStore } from '../../src/renderer-vue/src/stores/accounts'
import { useSettingsStore } from '../../src/renderer-vue/src/stores/settings'
import { useAutoSwitchStore } from '../../src/renderer-vue/src/stores/autoSwitch'
import { useProxyPoolStore } from '../../src/renderer-vue/src/stores/proxyPool'
import { useMachineIdStore } from '../../src/renderer-vue/src/stores/machineId'
import { usePersistenceStore } from '../../src/renderer-vue/src/stores/persistence'

setActivePinia(createPinia())

// 仅供共用场景 runner 读取拆分后的真实 store；生产代码不使用此适配器。
export const useAccountsStore = {
    getState() {
        return Object.assign(
            {},
            useVueAccountsStore(),
            useSettingsStore(),
            useAutoSwitchStore(),
            useProxyPoolStore(),
            useMachineIdStore(),
            usePersistenceStore()
        )
    }
}
