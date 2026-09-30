import { setLocale } from '@lingyzh/ui'
import { defineStore, getActivePinia } from 'pinia'
import { effectScope, ref, watch, type EffectScope } from 'vue'
import { useTheme } from '../composables/useTheme'
import { resolveLanguage } from '../composables/useTranslation'
import { isBannedAccountError } from '../lib/accountRuntime'
import { toIpcData } from '../lib/ipcData'
import { isPageType, type PageType } from '../lib/navigation'
import { useAccountsStore } from './accounts'
import { useAutoSwitchStore } from './autoSwitch'
import { usePersistenceStore } from './persistence'
import { useSettingsStore } from './settings'
import { useWebhookStore } from './webhooks'

type BackgroundResult = { id: string; success: boolean; data?: unknown; error?: string }

export const useAppStore = defineStore('kam-app', () => {
    const pinia = getActivePinia()!
    const currentPage = ref<PageType>('home')
    const visitedPages = ref<PageType[]>(['home'])
    const sidebarCollapsed = ref(true)
    const initialized = ref(false)
    const theme = useTheme()
    let generation = 0
    let loading: Promise<void> | null = null
    let scope: EffectScope | null = null
    let unsubscribers: Array<() => void> = []
    let trayTimer: ReturnType<typeof setTimeout> | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let checkTimer: ReturnType<typeof setTimeout> | null = null
    const refreshBuffer: BackgroundResult[] = []
    const checkBuffer: BackgroundResult[] = []
    let notifyStart = 0

    function navigate(page: PageType): void {
        if (!isPageType(page)) return
        currentPage.value = page
        if (!visitedPages.value.includes(page)) visitedPages.value.push(page)
    }

    function toggleSidebar(): void {
        sidebarCollapsed.value = !sidebarCollapsed.value
    }
    function setThemeMode(value: Parameters<typeof theme.setMode>[0]): void {
        theme.setMode(value)
    }

    function updateTrayInfo(): void {
        if (trayTimer) clearTimeout(trayTimer)
        trayTimer = setTimeout(() => {
            trayTimer = null
            const store = useAccountsStore(pinia)
            window.api.updateTrayAccountList(
                toIpcData(
                    Array.from(store.accounts.values()).map((account) => ({
                        id: account.id,
                        email: account.email || 'Unknown',
                        idp: account.idp || 'Unknown',
                        status: account.status
                    }))
                )
            )
            const account = store.activeAccountId ? store.accounts.get(store.activeAccountId) : null
            window.api.updateTrayAccount(
                toIpcData(
                    account
                        ? {
                              id: account.id,
                              email: account.email || 'Unknown',
                              idp: account.idp || 'Unknown',
                              status: account.status,
                              subscription: account.subscription?.title || undefined,
                              usage: account.usage
                                  ? {
                                        usedCredits: account.usage.current || 0,
                                        totalCredits: account.usage.limit || 0,
                                        totalRequests: 0,
                                        successRequests: 0,
                                        failedRequests: 0
                                    }
                                  : undefined
                          }
                        : null
                )
            )
        }, 400)
    }

    function notifyNewBanned(): void {
        if (typeof Notification === 'undefined') return
        const key = 'kiro-notified-banned-ids'
        let notified: Set<string>
        try {
            notified = new Set(JSON.parse(localStorage.getItem(key) || '[]'))
        } catch {
            notified = new Set()
        }
        const banned = Array.from(useAccountsStore(pinia).accounts.values()).filter((account) =>
            isBannedAccountError(account.lastError)
        )
        const fresh = banned.filter((account) => !notified.has(account.id))
        if (
            Date.now() - notifyStart >= 8000 &&
            fresh.length > 0 &&
            Notification.permission !== 'denied'
        ) {
            const currentGeneration = generation
            function fire(): void {
                if (!initialized.value || generation !== currentGeneration) return
                const isEn = resolveLanguage(useSettingsStore(pinia).language) === 'en'
                const title =
                    fresh.length === 1
                        ? isEn
                            ? 'Account banned'
                            : '账号被封禁'
                        : isEn
                          ? `${fresh.length} accounts banned`
                          : `${fresh.length} 个账号被封禁`
                const names = fresh.slice(0, 3).map((account) => account.nickname || account.email)
                const body =
                    names.join('\n') +
                    (fresh.length > 3
                        ? isEn
                            ? `\n+${fresh.length - 3} more`
                            : `\n等 ${fresh.length} 个`
                        : '')
                try {
                    new Notification(title, { body })
                } catch {
                    /* 通知不影响主流程。 */
                }
            }
            if (Notification.permission === 'granted') fire()
            else
                void Notification.requestPermission().then((permission) => {
                    if (permission === 'granted') fire()
                })
        }
        try {
            localStorage.setItem(key, JSON.stringify(banned.map((account) => account.id)))
        } catch {
            /* 与旧版一致。 */
        }
    }

    function flushRefresh(): void {
        refreshTimer = null
        if (refreshBuffer.length)
            useAccountsStore(pinia).applyBackgroundRefreshResults(refreshBuffer.splice(0))
    }

    function flushChecks(): void {
        checkTimer = null
        if (checkBuffer.length)
            useAccountsStore(pinia).applyBackgroundCheckResults(checkBuffer.splice(0))
    }

    function onNavigate(event: Event): void {
        const page = (event as CustomEvent<unknown>).detail
        if (isPageType(page)) navigate(page)
    }
    function beforeUnload(): void {
        void usePersistenceStore(pinia).flushSaveImmediately()
    }

    async function initialize(): Promise<void> {
        if (initialized.value) return loading ?? Promise.resolve()
        initialized.value = true
        const ownGeneration = ++generation
        function isCurrent(): boolean {
            return initialized.value && generation === ownGeneration
        }
        const accounts = useAccountsStore(pinia)
        const persistence = usePersistenceStore(pinia)
        notifyStart = Date.now()
        useWebhookStore(pinia).loadFromStorage()
        void useSettingsStore(pinia).loadProactiveRenewalEnabled()
        unsubscribers = [
            window.api.onKiroIdeTokenChanged?.(() => {
                void persistence.loadFromStorage(isCurrent).then(() => {
                    if (!isCurrent()) return
                    theme.syncAfterLoad()
                    window.api.updateTrayLanguage(
                        toIpcData(resolveLanguage(useSettingsStore(pinia).language))
                    )
                })
            }),
            window.api.onProxyWebhookTrigger?.((event, payload) => {
                const target =
                    event === 'proxy-account-suspended' ? 'account-banned' : 'risk-warning'
                const raw = payload as Record<string, unknown>
                const level =
                    raw.level === 'error' || raw.level === 'info' || raw.level === 'success'
                        ? raw.level
                        : 'warn'
                void useWebhookStore(pinia).triggerEvent(target, {
                    title: String(raw.title ?? '反代告警'),
                    message: String(raw.message ?? ''),
                    level,
                    fields: raw.fields as Record<string, string | number> | undefined
                })
            }),
            window.api.onTrayRefreshAccount(() => {
                void accounts.checkAndRefreshExpiringTokens()
                updateTrayInfo()
            }),
            window.api.onTraySwitchAccount(() => {
                const active = Array.from(accounts.accounts.values()).filter(
                    (account) => account.status === 'active'
                )
                if (active.length <= 1) return
                const index = active.findIndex((account) => account.id === accounts.activeAccountId)
                void accounts.setActiveAccount(active[(index + 1) % active.length].id)
            }),
            window.api.onBackgroundRefreshResult((data) => {
                refreshBuffer.push(data)
                if (!refreshTimer) refreshTimer = setTimeout(flushRefresh, 120)
            }),
            window.api.onBackgroundCheckResult((data) => {
                checkBuffer.push(data)
                if (!checkTimer) checkTimer = setTimeout(flushChecks, 120)
            }),
            window.api.onProxyAccountSuspended((info) => {
                accounts.updateAccountStatus(info.id, 'error', `[${info.reason}] ${info.message}`)
            }),
            window.api.onProxyAccountUpdate((info) => {
                if (!info.profileArn) return
                const account = accounts.accounts.get(info.id)
                if (!account || account.credentials.profileArn === info.profileArn) return
                accounts.updateAccount(info.id, {
                    profileArn: info.profileArn,
                    credentials: { ...account.credentials, profileArn: info.profileArn }
                })
            })
        ].filter((unsubscribe): unsubscribe is () => void => typeof unsubscribe === 'function')
        window.addEventListener('navigate-page', onNavigate)
        window.addEventListener('beforeunload', beforeUnload)
        scope = effectScope(true)
        scope.run(() => {
            watch(() => [accounts.accounts, accounts.activeAccountId], updateTrayInfo, {
                immediate: true
            })
            watch(() => accounts.accounts, notifyNewBanned, { immediate: true })
            watch(
                () => resolveLanguage(useSettingsStore(pinia).language),
                (language) => {
                    setLocale(language)
                },
                { immediate: true, flush: 'sync' }
            )
        })
        loading = persistence.loadFromStorage(isCurrent).then(() => {
            if (!isCurrent()) return
            theme.initialize()
            window.api.updateTrayLanguage(
                toIpcData(resolveLanguage(useSettingsStore(pinia).language))
            )
            accounts.startAutoTokenRefresh()
        })
        return loading
    }

    async function dispose(): Promise<void> {
        if (!initialized.value) return
        initialized.value = false
        generation++
        for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
        window.removeEventListener('navigate-page', onNavigate)
        window.removeEventListener('beforeunload', beforeUnload)
        scope?.stop()
        scope = null
        theme.dispose()
        if (refreshTimer) clearTimeout(refreshTimer)
        if (checkTimer) clearTimeout(checkTimer)
        flushRefresh()
        flushChecks()
        if (trayTimer) clearTimeout(trayTimer)
        trayTimer = null
        useAccountsStore(pinia).stopAutoTokenRefresh()
        useAutoSwitchStore(pinia).stopAutoSwitch()
        usePersistenceStore(pinia).stopAutoSave()
        usePersistenceStore(pinia).isLoading = false
        loading = null
        await usePersistenceStore(pinia).flushPendingSave()
    }

    return {
        currentPage,
        visitedPages,
        sidebarCollapsed,
        initialized,
        themeMode: theme.mode,
        navigate,
        toggleSidebar,
        setThemeMode,
        initialize,
        dispose
    }
})
