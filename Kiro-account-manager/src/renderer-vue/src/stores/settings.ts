import { defineStore, getActivePinia } from 'pinia'
import { ref } from 'vue'
import { toIpcData } from '../lib/ipcData'
import { useAccountsStore } from './accounts'
import { usePersistenceStore } from './persistence'

/** Vue 数据层：保留 React 既有动作与持久化边界，运行态归当前 Pinia 实例。 */
export const useSettingsStore = defineStore('kam-settings', () => {
    const pinia = getActivePinia()!
    const appVersion = ref<string>('1.0.0')
    const autoRefreshEnabled = ref<boolean>(true)
    const autoRefreshInterval = ref<number>(5) // 分钟
    const autoRefreshConcurrency = ref<number>(100) // 自动刷新并发数
    const autoRefreshSyncInfo = ref<boolean>(true) // 刷新时是否同步检测账户信息（用量、订阅、封禁状态）
    const statusCheckInterval = ref<number>(60) // 分钟
    const proactiveRenewalEnabled = ref<boolean>(false)
    const proactiveRenewalLeadMinutes = ref<number>(15)
    const privacyMode = ref<boolean>(false)
    const usagePrecision = ref<boolean>(false) // true: 显示精确小数, false: 显示整数
    const proxyEnabled = ref<boolean>(false)
    const proxyUrl = ref<string>('') // 格式: http://host:port 或 socks5://host:port
    const batchImportConcurrency = ref<number>(100) // 批量导入并发数
    const loginPrivateMode = ref<boolean>(false) // 登录时使用浏览器隐私/无痕模式
    const switchTarget = ref<
        'ide' | 'cli' | 'both' // ide=仅 Kiro IDE, cli=仅 Kiro CLI, both=两者都切
    >('ide' as const)
    const theme = ref<string>('default') // 主题名称: default, purple, emerald, orange, rose, cyan, amber
    const darkMode = ref<boolean>(false) // 深色模式
    const language = ref<
        'auto' | 'en' | 'zh' // auto: 跟随系统
    >('auto')
    function setAutoRefresh(enabled: boolean, interval?: number): void {
        {
            const changes: {
                autoRefreshEnabled: boolean
                autoRefreshInterval: number // 分钟
            } = {
                autoRefreshEnabled: enabled,
                autoRefreshInterval: interval ?? useSettingsStore(pinia).autoRefreshInterval
            }
            useSettingsStore(pinia).$patch((state) => {
                state.autoRefreshEnabled = changes.autoRefreshEnabled
                state.autoRefreshInterval = changes.autoRefreshInterval
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 重新启动定时器
        if (enabled) {
            useAccountsStore(pinia).startAutoTokenRefresh()
        } else {
            useAccountsStore(pinia).stopAutoTokenRefresh()
        }
    }
    function setAutoRefreshConcurrency(concurrency: number): void {
        {
            const changes: {
                autoRefreshConcurrency: number // 自动刷新并发数
            } = { autoRefreshConcurrency: Math.max(1, Math.min(500, concurrency)) }
            useSettingsStore(pinia).$patch((state) => {
                state.autoRefreshConcurrency = changes.autoRefreshConcurrency
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function setAutoRefreshSyncInfo(enabled: boolean): void {
        {
            const changes: {
                autoRefreshSyncInfo: boolean // 刷新时是否同步检测账户信息（用量、订阅、封禁状态）
            } = { autoRefreshSyncInfo: enabled }
            useSettingsStore(pinia).$patch((state) => {
                state.autoRefreshSyncInfo = changes.autoRefreshSyncInfo
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    async function setProactiveRenewalEnabled(enabled: boolean): Promise<{
        success: boolean
        error?: string
    }> {
        if (typeof window.api?.setProactiveRenewalEnabled !== 'function') {
            return { success: false, error: 'API not available' }
        }
        const result = await window.api.setProactiveRenewalEnabled(toIpcData(enabled))
        if (result.success) {
            {
                const changes: {
                    proactiveRenewalEnabled: boolean
                } = { proactiveRenewalEnabled: !!result.enabled }
                useSettingsStore(pinia).$patch((state) => {
                    state.proactiveRenewalEnabled = changes.proactiveRenewalEnabled
                })
            }
        }
        return { success: result.success, error: result.error }
    }
    async function loadProactiveRenewalEnabled(): Promise<void> {
        if (typeof window.api?.getProactiveRenewalEnabled !== 'function') return
        try {
            const result = await window.api.getProactiveRenewalEnabled()
            if (result.success) {
                {
                    const changes: {
                        proactiveRenewalEnabled: boolean
                        proactiveRenewalLeadMinutes: number
                    } = {
                        proactiveRenewalEnabled: !!result.enabled,
                        proactiveRenewalLeadMinutes: result.leadTimeMinutes ?? 15
                    }
                    useSettingsStore(pinia).$patch((state) => {
                        state.proactiveRenewalEnabled = changes.proactiveRenewalEnabled
                        state.proactiveRenewalLeadMinutes = changes.proactiveRenewalLeadMinutes
                    })
                }
            }
        } catch (e) {
            console.warn('[Store] loadProactiveRenewalEnabled failed:', e)
        }
    }
    function setStatusCheckInterval(interval: number): void {
        {
            const changes: {
                statusCheckInterval: number // 分钟
            } = { statusCheckInterval: interval }
            useSettingsStore(pinia).$patch((state) => {
                state.statusCheckInterval = changes.statusCheckInterval
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function setPrivacyMode(enabled: boolean): void {
        {
            const changes: {
                privacyMode: boolean
            } = { privacyMode: enabled }
            useSettingsStore(pinia).$patch((state) => {
                state.privacyMode = changes.privacyMode
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function maskEmail(email: string): string {
        if (!useSettingsStore(pinia).privacyMode || !email) return email
        // 生成固定长度的随机字符串作为伪装邮箱
        const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
        const maskedName = `user${(hash % 100000).toString().padStart(5, '0')}`
        return `${maskedName}@***.com`
    }
    function maskNickname(nickname: string | undefined): string {
        if (!useSettingsStore(pinia).privacyMode || !nickname) return nickname || ''
        // 基于原始昵称生成固定的伪装昵称
        const hash = nickname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
        return `用户${(hash % 100000).toString().padStart(5, '0')}`
    }
    function setUsagePrecision(enabled: boolean): void {
        {
            const changes: {
                usagePrecision: boolean // true: 显示精确小数, false: 显示整数
            } = { usagePrecision: enabled }
            useSettingsStore(pinia).$patch((state) => {
                state.usagePrecision = changes.usagePrecision
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    async function setProxy(enabled: boolean, url?: string): Promise<void> {
        const targetUrl = url ?? useSettingsStore(pinia).proxyUrl
        {
            const changes: {
                proxyEnabled: boolean
                proxyUrl: string // 格式: http://host:port 或 socks5://host:port
            } = {
                proxyEnabled: enabled,
                proxyUrl: targetUrl
            }
            useSettingsStore(pinia).$patch((state) => {
                state.proxyEnabled = changes.proxyEnabled
                state.proxyUrl = changes.proxyUrl
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 通知主进程更新代理设置，并用规范化后的 URL 回写 store
        try {
            const result = await window.api.setProxy?.(toIpcData(enabled), toIpcData(targetUrl))
            if (result?.normalizedUrl && result.normalizedUrl !== targetUrl) {
                {
                    const changes: {
                        proxyUrl: string // 格式: http://host:port 或 socks5://host:port
                    } = { proxyUrl: result.normalizedUrl }
                    useSettingsStore(pinia).$patch((state) => {
                        state.proxyUrl = changes.proxyUrl
                    })
                }
                usePersistenceStore(pinia).saveToStorage()
            }
        } catch (err) {
            console.error('[Store] setProxy IPC failed:', err)
        }
    }
    function setTheme(theme: string): void {
        {
            const changes: {
                theme: string // 主题名称: default, purple, emerald, orange, rose, cyan, amber
            } = { theme }
            useSettingsStore(pinia).$patch((state) => {
                state.theme = changes.theme
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        useSettingsStore(pinia).applyTheme()
    }
    function setDarkMode(enabled: boolean): void {
        {
            const changes: {
                darkMode: boolean // 深色模式
            } = { darkMode: enabled }
            useSettingsStore(pinia).$patch((state) => {
                state.darkMode = changes.darkMode
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        useSettingsStore(pinia).applyTheme()
    }
    function setLanguage(language: 'auto' | 'en' | 'zh'): void {
        {
            const changes: {
                language: 'auto' | 'en' | 'zh' // auto: 跟随系统
            } = { language }
            useSettingsStore(pinia).$patch((state) => {
                state.language = changes.language
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 更新托盘菜单语言
        const actualLang =
            language === 'auto' ? (navigator.language.startsWith('zh') ? 'zh' : 'en') : language
        window.api.updateTrayLanguage(toIpcData(actualLang))
    }
    function applyTheme(): void {
        document.documentElement.dataset.theme = darkMode.value ? 'dark' : 'light'
    }
    function setBatchImportConcurrency(concurrency: number): void {
        {
            const changes: {
                batchImportConcurrency: number // 批量导入并发数
            } = { batchImportConcurrency: Math.max(1, Math.min(500, concurrency)) }
            useSettingsStore(pinia).$patch((state) => {
                state.batchImportConcurrency = changes.batchImportConcurrency
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function setLoginPrivateMode(enabled: boolean): void {
        {
            const changes: {
                loginPrivateMode: boolean // 登录时使用浏览器隐私/无痕模式
            } = { loginPrivateMode: enabled }
            useSettingsStore(pinia).$patch((state) => {
                state.loginPrivateMode = changes.loginPrivateMode
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function setSwitchTarget(target: 'ide' | 'cli' | 'both'): void {
        {
            const changes: {
                switchTarget: 'ide' | 'cli' | 'both' // ide=仅 Kiro IDE, cli=仅 Kiro CLI, both=两者都切
            } = { switchTarget: target }
            useSettingsStore(pinia).$patch((state) => {
                state.switchTarget = changes.switchTarget
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }

    return {
        appVersion,
        autoRefreshEnabled,
        autoRefreshInterval,
        autoRefreshConcurrency,
        autoRefreshSyncInfo,
        statusCheckInterval,
        proactiveRenewalEnabled,
        proactiveRenewalLeadMinutes,
        privacyMode,
        usagePrecision,
        proxyEnabled,
        proxyUrl,
        batchImportConcurrency,
        loginPrivateMode,
        switchTarget,
        theme,
        darkMode,
        language,
        setAutoRefresh,
        setAutoRefreshConcurrency,
        setAutoRefreshSyncInfo,
        setProactiveRenewalEnabled,
        loadProactiveRenewalEnabled,
        setStatusCheckInterval,
        setPrivacyMode,
        maskEmail,
        maskNickname,
        setUsagePrecision,
        setProxy,
        setTheme,
        setDarkMode,
        setLanguage,
        applyTheme,
        setBatchImportConcurrency,
        setLoginPrivateMode,
        setSwitchTarget
    }
})
