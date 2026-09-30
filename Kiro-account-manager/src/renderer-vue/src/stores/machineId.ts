import { defineStore, getActivePinia } from 'pinia'
import { ref } from 'vue'
import { toIpcData } from '../lib/ipcData'
import { useAccountsStore } from './accounts'
import { usePersistenceStore } from './persistence'

/** Vue 数据层：保留 React 既有动作与持久化边界，运行态归当前 Pinia 实例。 */
export const useMachineIdStore = defineStore('kam-machineId', () => {
    const pinia = getActivePinia()!
    const machineIdConfig = ref<{
        autoSwitchOnAccountChange: boolean // 切号时自动更换机器码
        bindMachineIdToAccount: boolean // 账户机器码绑定
        useBindedMachineId: boolean // 使用绑定的机器码（否则随机生成）
    }>({
        autoSwitchOnAccountChange: false,
        bindMachineIdToAccount: false,
        useBindedMachineId: true
    })
    const currentMachineId = ref<string>('') // 当前机器码
    const originalMachineId = ref<
        string | null // 备份的原始机器码
    >(null)
    const originalBackupTime = ref<
        number | null // 原始机器码备份时间
    >(null)
    const accountMachineIds = ref<
        Record<string, string> // 账户绑定的机器码映射
    >({})
    const machineIdHistory = ref<
        Array<{
            id: string
            machineId: string
            timestamp: number
            action: 'initial' | 'manual' | 'auto_switch' | 'restore' | 'bind'
            accountId?: string
            accountEmail?: string
        }>
    >([])
    function setMachineIdConfig(
        config: Partial<{
            autoSwitchOnAccountChange: boolean
            bindMachineIdToAccount: boolean
            useBindedMachineId: boolean
        }>
    ): void {
        {
            const state = {
                machineIdConfig: useMachineIdStore(pinia).machineIdConfig
            }
            const changes: {
                machineIdConfig: {
                    autoSwitchOnAccountChange: boolean // 切号时自动更换机器码
                    bindMachineIdToAccount: boolean // 账户机器码绑定
                    useBindedMachineId: boolean // 使用绑定的机器码（否则随机生成）
                }
            } = {
                machineIdConfig: { ...state.machineIdConfig, ...config }
            }
            useMachineIdStore(pinia).$patch((state) => {
                state.machineIdConfig = changes.machineIdConfig
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    async function refreshCurrentMachineId(): Promise<void> {
        try {
            const result = await window.api.machineIdGetCurrent()
            if (result.success && result.machineId) {
                {
                    const changes: {
                        currentMachineId: string // 当前机器码
                    } = { currentMachineId: result.machineId }
                    useMachineIdStore(pinia).$patch((state) => {
                        state.currentMachineId = changes.currentMachineId
                    })
                }
                // 首次获取时自动备份原始机器码
                const { originalMachineId } = {
                    originalMachineId: useMachineIdStore(pinia).originalMachineId
                }
                if (!originalMachineId) {
                    useMachineIdStore(pinia).backupOriginalMachineId()
                }
            }
        } catch (error) {
            console.error('[MachineId] Failed to refresh current machine ID:', error)
        }
    }
    async function changeMachineId(newMachineId?: string): Promise<boolean> {
        const state = {
            originalMachineId: useMachineIdStore(pinia).originalMachineId,
            backupOriginalMachineId: useMachineIdStore(pinia).backupOriginalMachineId
        }
        // 首次更改时备份原始机器码
        if (!state.originalMachineId) {
            state.backupOriginalMachineId()
        }
        // 生成新机器码（如果未提供）
        const machineIdToSet = newMachineId || (await window.api.machineIdGenerateRandom())
        try {
            const result = await window.api.machineIdSet(toIpcData(machineIdToSet))
            if (result.success) {
                {
                    const s = {
                        machineIdHistory: useMachineIdStore(pinia).machineIdHistory
                    }
                    const changes: {
                        currentMachineId: string // 当前机器码
                        machineIdHistory: Array<{
                            id: string
                            machineId: string
                            timestamp: number
                            action: 'initial' | 'manual' | 'auto_switch' | 'restore' | 'bind'
                            accountId?: string
                            accountEmail?: string
                        }>
                    } = {
                        currentMachineId: machineIdToSet,
                        machineIdHistory: [
                            ...s.machineIdHistory,
                            {
                                id: crypto.randomUUID(),
                                machineId: machineIdToSet,
                                timestamp: Date.now(),
                                action: 'manual'
                            }
                        ]
                    }
                    useMachineIdStore(pinia).$patch((state) => {
                        state.currentMachineId = changes.currentMachineId
                        state.machineIdHistory = changes.machineIdHistory
                    })
                }
                usePersistenceStore(pinia).saveToStorage()
                return true
            } else if (result.requiresAdmin) {
                // 需要管理员权限，主进程会处理弹窗
                return false
            } else {
                console.error('[MachineId] Failed to change:', result.error)
                return false
            }
        } catch (error) {
            console.error('[MachineId] Error changing machine ID:', error)
            return false
        }
    }
    async function restoreOriginalMachineId(): Promise<boolean> {
        const { originalMachineId } = {
            originalMachineId: useMachineIdStore(pinia).originalMachineId
        }
        if (!originalMachineId) {
            console.warn('[MachineId] No original machine ID to restore')
            return false
        }
        try {
            const result = await window.api.machineIdSet(toIpcData(originalMachineId))
            if (result.success) {
                {
                    const s = {
                        machineIdHistory: useMachineIdStore(pinia).machineIdHistory
                    }
                    const changes: {
                        currentMachineId: string // 当前机器码
                        machineIdHistory: Array<{
                            id: string
                            machineId: string
                            timestamp: number
                            action: 'initial' | 'manual' | 'auto_switch' | 'restore' | 'bind'
                            accountId?: string
                            accountEmail?: string
                        }>
                    } = {
                        currentMachineId: originalMachineId,
                        machineIdHistory: [
                            ...s.machineIdHistory,
                            {
                                id: crypto.randomUUID(),
                                machineId: originalMachineId,
                                timestamp: Date.now(),
                                action: 'restore'
                            }
                        ]
                    }
                    useMachineIdStore(pinia).$patch((state) => {
                        state.currentMachineId = changes.currentMachineId
                        state.machineIdHistory = changes.machineIdHistory
                    })
                }
                usePersistenceStore(pinia).saveToStorage()
                return true
            }
            return false
        } catch (error) {
            console.error('[MachineId] Error restoring original machine ID:', error)
            return false
        }
    }
    function bindMachineIdToAccount(accountId: string, machineId?: string): void {
        const account = useAccountsStore(pinia).accounts.get(accountId)
        if (!account) return
        // 生成或使用提供的机器码
        const boundMachineId = machineId || crypto.randomUUID()
        {
            const state = {
                accountMachineIds: useMachineIdStore(pinia).accountMachineIds,
                machineIdHistory: useMachineIdStore(pinia).machineIdHistory
            }
            const changes: {
                accountMachineIds: Record<string, string> // 账户绑定的机器码映射
                machineIdHistory: Array<{
                    id: string
                    machineId: string
                    timestamp: number
                    action: 'initial' | 'manual' | 'auto_switch' | 'restore' | 'bind'
                    accountId?: string
                    accountEmail?: string
                }>
            } = {
                accountMachineIds: {
                    ...state.accountMachineIds,
                    [accountId]: boundMachineId
                },
                machineIdHistory: [
                    ...state.machineIdHistory,
                    {
                        id: crypto.randomUUID(),
                        machineId: boundMachineId,
                        timestamp: Date.now(),
                        action: 'bind',
                        accountId,
                        accountEmail: account.email
                    }
                ]
            }
            useMachineIdStore(pinia).$patch((state) => {
                state.accountMachineIds = changes.accountMachineIds
                state.machineIdHistory = changes.machineIdHistory
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function getMachineIdForAccount(accountId: string): string | null {
        return useMachineIdStore(pinia).accountMachineIds[accountId] || null
    }
    function backupOriginalMachineId(): void {
        const { currentMachineId, originalMachineId } = {
            currentMachineId: useMachineIdStore(pinia).currentMachineId,
            originalMachineId: useMachineIdStore(pinia).originalMachineId
        }
        // 只有在没有备份且有当前机器码时才备份
        if (!originalMachineId && currentMachineId) {
            {
                const changes: {
                    originalMachineId: string | null // 备份的原始机器码
                    originalBackupTime: number | null // 原始机器码备份时间
                } = {
                    originalMachineId: currentMachineId,
                    originalBackupTime: Date.now()
                }
                useMachineIdStore(pinia).$patch((state) => {
                    state.originalMachineId = changes.originalMachineId
                    state.originalBackupTime = changes.originalBackupTime
                })
            }
            {
                const s = {
                    machineIdHistory: useMachineIdStore(pinia).machineIdHistory
                }
                const changes: {
                    machineIdHistory: Array<{
                        id: string
                        machineId: string
                        timestamp: number
                        action: 'initial' | 'manual' | 'auto_switch' | 'restore' | 'bind'
                        accountId?: string
                        accountEmail?: string
                    }>
                } = {
                    machineIdHistory: [
                        ...s.machineIdHistory,
                        {
                            id: crypto.randomUUID(),
                            machineId: currentMachineId,
                            timestamp: Date.now(),
                            action: 'initial'
                        }
                    ]
                }
                useMachineIdStore(pinia).$patch((state) => {
                    state.machineIdHistory = changes.machineIdHistory
                })
            }
            usePersistenceStore(pinia).saveToStorage()
            console.log('[MachineId] Original machine ID backed up:', currentMachineId)
        }
    }
    function clearMachineIdHistory(): void {
        {
            const changes: {
                machineIdHistory: Array<{
                    id: string
                    machineId: string
                    timestamp: number
                    action: 'initial' | 'manual' | 'auto_switch' | 'restore' | 'bind'
                    accountId?: string
                    accountEmail?: string
                }>
            } = { machineIdHistory: [] }
            useMachineIdStore(pinia).$patch((state) => {
                state.machineIdHistory = changes.machineIdHistory
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }

    return {
        machineIdConfig,
        currentMachineId,
        originalMachineId,
        originalBackupTime,
        accountMachineIds,
        machineIdHistory,
        setMachineIdConfig,
        refreshCurrentMachineId,
        changeMachineId,
        restoreOriginalMachineId,
        bindMachineIdToAccount,
        getMachineIdForAccount,
        backupOriginalMachineId,
        clearMachineIdHistory
    }
})
