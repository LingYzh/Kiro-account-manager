import type { Account, AccountGroup, AccountTag } from '@shared/types/account'
import type { ProxyEntry, ProxyPoolConfig } from '@shared/types/proxy'
import { DEFAULT_PROXY_POOL_CONFIG } from '@shared/types/proxy'
import { defineStore, getActivePinia } from 'pinia'
import { ref } from 'vue'
import { generateRandomMachineId } from '../lib/accountRuntime'
import { toIpcData } from '../lib/ipcData'
import { useAccountsStore } from './accounts'
import { useAutoSwitchStore } from './autoSwitch'
import { useMachineIdStore } from './machineId'
import { useProxyPoolStore } from './proxyPool'
import { useSettingsStore } from './settings'

/** Vue 数据层：保留 React 既有动作与持久化边界，运行态归当前 Pinia 实例。 */
export const usePersistenceStore = defineStore('kam-persistence', () => {
    const pinia = getActivePinia()!
    // 持久化防抖：合并连续 mutation 为单次写盘，避免后台刷新风暴时 IPC + IO 风暴
    const SAVE_DEBOUNCE_MS = 500
    /** 防抖最大延迟：连续 mutation 时也最迟在此时间内落盘一次，防止风暴下数据长时间不入磁盘 */
    const SAVE_MAX_WAIT_MS = 5000
    let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
    let saveMaxWaitTimer: ReturnType<typeof setTimeout> | null = null
    let saveInFlight: Promise<void> | null = null
    /** 等待本轮防抖窗口落盘的所有调用方 resolver；批量唤醒，避免风暴时 Promise 永久挂起 */
    let savePendingResolvers: Array<() => void> = []
    // 定时自动保存定时器（防止数据丢失）
    let autoSaveTimer: ReturnType<typeof setInterval> | null = null
    const AUTO_SAVE_INTERVAL = 30 * 1000 // 每 30 秒自动保存一次

    let lastSaveHash = '' // 用于检测数据是否变化

    const isLoading = ref<boolean>(false)
    const isSyncing = ref<boolean>(false)
    async function loadFromStorage(isCurrent: () => boolean = () => true): Promise<void> {
        {
            const changes: {
                isLoading: boolean
            } = { isLoading: true }
            usePersistenceStore(pinia).$patch((state) => {
                state.isLoading = changes.isLoading
            })
        }
        try {
            // 获取应用版本号
            const appVersion = await window.api.getAppVersion()
            if (!isCurrent()) return
            {
                const changes: {
                    appVersion: string
                } = { appVersion }
                useSettingsStore(pinia).$patch((state) => {
                    state.appVersion = changes.appVersion
                })
            }
            const data = await window.api.loadAccounts()
            if (!isCurrent()) return
            if (data) {
                const accounts = new Map(Object.entries(data.accounts ?? {}) as [string, Account][])
                const activeAccountId = data.activeAccountId ?? null
                // 为没有 machineId 的现有账户生成一个
                let needsSave = false
                for (const [id, account] of accounts) {
                    if (!account.machineId) {
                        account.machineId = generateRandomMachineId()
                        accounts.set(id, account)
                        needsSave = true
                        console.log(
                            `[Store] Generated machineId for account ${account.email}: ${account.machineId.substring(0, 16)}...`
                        )
                    }
                }
                // 根据 activeAccountId 重新同步所有账号的 isActive 状态，确保只有一个账号为激活状态
                for (const [id, account] of accounts) {
                    const shouldBeActive = id === activeAccountId
                    if (account.isActive !== shouldBeActive) {
                        accounts.set(id, { ...account, isActive: shouldBeActive })
                    }
                }
                {
                    const changes: {
                        accounts: Map<string, Account>
                        groups: Map<string, AccountGroup>
                        tags: Map<string, AccountTag>
                        activeAccountId: string | null
                        autoRefreshEnabled: boolean
                        autoRefreshInterval: number // 分钟
                        autoRefreshConcurrency: number // 自动刷新并发数
                        autoRefreshSyncInfo: boolean // 刷新时是否同步检测账户信息（用量、订阅、封禁状态）
                        statusCheckInterval: number // 分钟
                        privacyMode: boolean
                        usagePrecision: boolean // true: 显示精确小数, false: 显示整数
                        proxyEnabled: boolean
                        proxyUrl: string // 格式: http://host:port 或 socks5://host:port
                        autoSwitchEnabled: boolean
                        autoSwitchThreshold: number // 余额阈值，低于此值时自动切换
                        autoSwitchInterval: number // 检查间隔（分钟）
                        switchTarget: 'ide' | 'cli' | 'both' // ide=仅 Kiro IDE, cli=仅 Kiro CLI, both=两者都切
                        theme: string // 主题名称: default, purple, emerald, orange, rose, cyan, amber
                        darkMode: boolean // 深色模式
                        language: 'auto' | 'en' | 'zh' // auto: 跟随系统
                        machineIdConfig: {
                            autoSwitchOnAccountChange: boolean // 切号时自动更换机器码
                            bindMachineIdToAccount: boolean // 账户机器码绑定
                            useBindedMachineId: boolean // 使用绑定的机器码（否则随机生成）
                        }
                        accountMachineIds: Record<string, string> // 账户绑定的机器码映射
                        machineIdHistory: Array<{
                            id: string
                            machineId: string
                            timestamp: number
                            action: 'initial' | 'manual' | 'auto_switch' | 'restore' | 'bind'
                            accountId?: string
                            accountEmail?: string
                        }>
                        proxyPool: Map<string, ProxyEntry>
                        proxyPoolConfig: ProxyPoolConfig
                        proxyPoolCursor: number
                        accountProxyBindings: Record<string, string>
                    } = {
                        accounts,
                        groups: new Map(
                            Object.entries(data.groups ?? {}) as [string, AccountGroup][]
                        ),
                        tags: new Map(Object.entries(data.tags ?? {}) as [string, AccountTag][]),
                        activeAccountId,
                        autoRefreshEnabled: data.autoRefreshEnabled ?? true,
                        autoRefreshInterval: data.autoRefreshInterval ?? 5,
                        autoRefreshConcurrency: data.autoRefreshConcurrency ?? 100,
                        autoRefreshSyncInfo: data.autoRefreshSyncInfo ?? true,
                        statusCheckInterval: data.statusCheckInterval ?? 60,
                        privacyMode: data.privacyMode ?? false,
                        usagePrecision: data.usagePrecision ?? false,
                        proxyEnabled: data.proxyEnabled ?? false,
                        proxyUrl: data.proxyUrl ?? '',
                        autoSwitchEnabled: data.autoSwitchEnabled ?? false,
                        autoSwitchThreshold: data.autoSwitchThreshold ?? 0,
                        autoSwitchInterval: data.autoSwitchInterval ?? 5,
                        switchTarget: data.switchTarget ?? 'ide',
                        theme: data.theme ?? 'default',
                        darkMode: data.darkMode ?? false,
                        language: data.language ?? 'auto',
                        machineIdConfig: data.machineIdConfig ?? {
                            autoSwitchOnAccountChange: false,
                            bindMachineIdToAccount: false,
                            useBindedMachineId: true
                        },
                        accountMachineIds: data.accountMachineIds ?? {},
                        machineIdHistory: data.machineIdHistory ?? [],
                        proxyPool: data.proxyPool
                            ? new Map(Object.entries(data.proxyPool as Record<string, ProxyEntry>))
                            : new Map<string, ProxyEntry>(),
                        proxyPoolConfig: {
                            ...DEFAULT_PROXY_POOL_CONFIG,
                            ...(data.proxyPoolConfig as Partial<ProxyPoolConfig> | undefined)
                        },
                        proxyPoolCursor:
                            typeof data.proxyPoolCursor === 'number' ? data.proxyPoolCursor : 0,
                        accountProxyBindings:
                            (data.accountProxyBindings as Record<string, string> | undefined) || {}
                    }
                    useAccountsStore(pinia).$patch((state) => {
                        state.accounts = changes.accounts
                        state.groups = changes.groups
                        state.tags = changes.tags
                        state.activeAccountId = changes.activeAccountId
                    })
                    useSettingsStore(pinia).$patch((state) => {
                        state.autoRefreshEnabled = changes.autoRefreshEnabled
                        state.autoRefreshInterval = changes.autoRefreshInterval
                        state.autoRefreshConcurrency = changes.autoRefreshConcurrency
                        state.autoRefreshSyncInfo = changes.autoRefreshSyncInfo
                        state.statusCheckInterval = changes.statusCheckInterval
                        state.privacyMode = changes.privacyMode
                        state.usagePrecision = changes.usagePrecision
                        state.proxyEnabled = changes.proxyEnabled
                        state.proxyUrl = changes.proxyUrl
                        state.switchTarget = changes.switchTarget
                        state.theme = changes.theme
                        state.darkMode = changes.darkMode
                        state.language = changes.language
                    })
                    useAutoSwitchStore(pinia).$patch((state) => {
                        state.autoSwitchEnabled = changes.autoSwitchEnabled
                        state.autoSwitchThreshold = changes.autoSwitchThreshold
                        state.autoSwitchInterval = changes.autoSwitchInterval
                    })
                    useMachineIdStore(pinia).$patch((state) => {
                        state.machineIdConfig = changes.machineIdConfig
                        state.accountMachineIds = changes.accountMachineIds
                        state.machineIdHistory = changes.machineIdHistory
                    })
                    useProxyPoolStore(pinia).$patch((state) => {
                        state.proxyPool = changes.proxyPool
                        state.proxyPoolConfig = changes.proxyPoolConfig
                        state.proxyPoolCursor = changes.proxyPoolCursor
                        state.accountProxyBindings = changes.accountProxyBindings
                    })
                }
                // 应用主题
                useSettingsStore(pinia).applyTheme()
                // 如果代理已启用，通过 store 的 setProxy（会自动 normalize URL 并回写 UI）
                if (data.proxyEnabled && data.proxyUrl) {
                    void useSettingsStore(pinia).setProxy(true, data.proxyUrl)
                }
                // 如果自动换号已启用，启动定时器
                if (data.autoSwitchEnabled) {
                    useAutoSwitchStore(pinia).startAutoSwitch()
                }
                // 启动定时自动保存（防止数据丢失）
                usePersistenceStore(pinia).startAutoSave()
                // 如果生成了新的 machineId，保存到存储
                if (needsSave) {
                    console.log('[Store] Saving accounts with newly generated machineIds')
                    usePersistenceStore(pinia).saveToStorage()
                }
                // SSO 同步（含潜在网络请求）异步执行，不阻塞首屏加载
                // 完成后通过 set 应用结果，UI 会自然更新
                queueMicrotask(() => {
                    if (isCurrent())
                        void useAccountsStore(pinia).syncLocalSsoAccountAsync(isCurrent)
                })
            }
        } catch (error) {
            console.error('Failed to load accounts:', error)
        } finally {
            if (isCurrent()) {
                const changes: {
                    isLoading: boolean
                } = { isLoading: false }
                usePersistenceStore(pinia).$patch((state) => {
                    state.isLoading = changes.isLoading
                })
            }
        }
    }
    async function saveToStorage(): Promise<void> {
        return new Promise<void>((resolve) => {
            savePendingResolvers.push(resolve)
            const flushNow = async (): Promise<void> => {
                if (saveDebounceTimer) {
                    clearTimeout(saveDebounceTimer)
                    saveDebounceTimer = null
                }
                if (saveMaxWaitTimer) {
                    clearTimeout(saveMaxWaitTimer)
                    saveMaxWaitTimer = null
                }
                const resolvers = savePendingResolvers
                savePendingResolvers = []
                await usePersistenceStore(pinia).flushSaveImmediately()
                for (const r of resolvers) r()
            }
            if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
            saveDebounceTimer = setTimeout(flushNow, SAVE_DEBOUNCE_MS)
            if (!saveMaxWaitTimer) {
                saveMaxWaitTimer = setTimeout(flushNow, SAVE_MAX_WAIT_MS)
            }
        })
    }
    /** 释放生命周期时只保存确有待写入的数据，避免初始化中断时覆盖磁盘文档。 */
    async function flushPendingSave(): Promise<void> {
        if (savePendingResolvers.length > 0 || saveInFlight) await flushSaveImmediately()
    }
    async function flushSaveImmediately(): Promise<void> {
        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer)
            saveDebounceTimer = null
        }
        if (saveMaxWaitTimer) {
            clearTimeout(saveMaxWaitTimer)
            saveMaxWaitTimer = null
        }
        const pending = savePendingResolvers
        savePendingResolvers = []
        if (saveInFlight) {
            const inflight = saveInFlight
            void inflight.then(() => {
                for (const r of pending) r()
            })
            return inflight
        }
        const {
            accounts,
            groups,
            tags,
            activeAccountId,
            autoRefreshEnabled,
            autoRefreshInterval,
            autoRefreshConcurrency,
            statusCheckInterval,
            privacyMode,
            usagePrecision,
            proxyEnabled,
            proxyUrl,
            autoSwitchEnabled,
            autoSwitchThreshold,
            autoSwitchInterval,
            switchTarget,
            theme,
            darkMode,
            language,
            machineIdConfig,
            accountMachineIds,
            machineIdHistory,
            proxyPool,
            proxyPoolConfig,
            proxyPoolCursor,
            accountProxyBindings
        } = {
            accounts: useAccountsStore(pinia).accounts,
            groups: useAccountsStore(pinia).groups,
            tags: useAccountsStore(pinia).tags,
            activeAccountId: useAccountsStore(pinia).activeAccountId,
            autoRefreshEnabled: useSettingsStore(pinia).autoRefreshEnabled,
            autoRefreshInterval: useSettingsStore(pinia).autoRefreshInterval,
            autoRefreshConcurrency: useSettingsStore(pinia).autoRefreshConcurrency,
            statusCheckInterval: useSettingsStore(pinia).statusCheckInterval,
            privacyMode: useSettingsStore(pinia).privacyMode,
            usagePrecision: useSettingsStore(pinia).usagePrecision,
            proxyEnabled: useSettingsStore(pinia).proxyEnabled,
            proxyUrl: useSettingsStore(pinia).proxyUrl,
            autoSwitchEnabled: useAutoSwitchStore(pinia).autoSwitchEnabled,
            autoSwitchThreshold: useAutoSwitchStore(pinia).autoSwitchThreshold,
            autoSwitchInterval: useAutoSwitchStore(pinia).autoSwitchInterval,
            switchTarget: useSettingsStore(pinia).switchTarget,
            theme: useSettingsStore(pinia).theme,
            darkMode: useSettingsStore(pinia).darkMode,
            language: useSettingsStore(pinia).language,
            machineIdConfig: useMachineIdStore(pinia).machineIdConfig,
            accountMachineIds: useMachineIdStore(pinia).accountMachineIds,
            machineIdHistory: useMachineIdStore(pinia).machineIdHistory,
            proxyPool: useProxyPoolStore(pinia).proxyPool,
            proxyPoolConfig: useProxyPoolStore(pinia).proxyPoolConfig,
            proxyPoolCursor: useProxyPoolStore(pinia).proxyPoolCursor,
            accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings
        }
        {
            const changes: {
                isSyncing: boolean
            } = { isSyncing: true }
            usePersistenceStore(pinia).$patch((state) => {
                state.isSyncing = changes.isSyncing
            })
        }
        saveInFlight = (async () => {
            try {
                await window.api.saveAccounts(
                    toIpcData({
                        accounts: Object.fromEntries(accounts),
                        groups: Object.fromEntries(groups),
                        tags: Object.fromEntries(tags),
                        activeAccountId,
                        autoRefreshEnabled,
                        autoRefreshInterval,
                        autoRefreshConcurrency,
                        statusCheckInterval,
                        privacyMode,
                        usagePrecision,
                        proxyEnabled,
                        proxyUrl,
                        autoSwitchEnabled,
                        autoSwitchThreshold,
                        autoSwitchInterval,
                        switchTarget,
                        theme,
                        darkMode,
                        language,
                        machineIdConfig,
                        accountMachineIds,
                        machineIdHistory,
                        proxyPool: Object.fromEntries(proxyPool),
                        proxyPoolConfig,
                        proxyPoolCursor,
                        accountProxyBindings
                    })
                )
            } catch (error) {
                console.error('Failed to save accounts:', error)
            } finally {
                {
                    const changes: {
                        isSyncing: boolean
                    } = { isSyncing: false }
                    usePersistenceStore(pinia).$patch((state) => {
                        state.isSyncing = changes.isSyncing
                    })
                }
                saveInFlight = null
                for (const r of pending) r()
            }
        })()
        return saveInFlight
    }
    function startAutoSave(): void {
        // 如果已有定时器，先停止
        if (autoSaveTimer) {
            clearInterval(autoSaveTimer)
        }
        // 计算当前数据的哈希值
        function computeHash(): string {
            const { accounts, groups, tags, activeAccountId } = {
                accounts: useAccountsStore(pinia).accounts,
                groups: useAccountsStore(pinia).groups,
                tags: useAccountsStore(pinia).tags,
                activeAccountId: useAccountsStore(pinia).activeAccountId
            }
            return JSON.stringify({
                accounts: Object.fromEntries(accounts),
                groups: Object.fromEntries(groups),
                tags: Object.fromEntries(tags),
                activeAccountId
            })
        }
        // 初始化哈希值
        lastSaveHash = computeHash()
        // 设置定时保存
        autoSaveTimer = setInterval(async () => {
            const currentHash = computeHash()
            // 只有数据变化时才保存
            if (currentHash !== lastSaveHash) {
                console.log('[AutoSave] Data changed, saving...')
                await usePersistenceStore(pinia).saveToStorage()
                lastSaveHash = currentHash
                console.log('[AutoSave] Data saved successfully')
            }
        }, AUTO_SAVE_INTERVAL)
        console.log(`[AutoSave] Auto-save started with interval: ${AUTO_SAVE_INTERVAL / 1000}s`)
    }
    function stopAutoSave(): void {
        if (autoSaveTimer) {
            clearInterval(autoSaveTimer)
            autoSaveTimer = null
            console.log('[AutoSave] Auto-save stopped')
        }
    }

    return {
        isLoading,
        isSyncing,
        loadFromStorage,
        saveToStorage,
        flushSaveImmediately,
        flushPendingSave,
        startAutoSave,
        stopAutoSave
    }
})
