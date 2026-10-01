import { onBeforeUnmount, reactive, ref, type Ref } from 'vue'
import { confirmDialog, snackbar } from '@lingyzh/ui'
import type { Account } from '@shared/types/account'
import { getDisplayName } from '@shared/lib/accountHelpers'
import { useAccountsStore } from '../stores/accounts'
import { useSettingsStore } from '../stores/settings'
import { usePersistenceStore } from '../stores/persistence'
import { useProxyPoolStore } from '../stores/proxyPool'
import { toIpcData } from '../lib/ipcData'

/** Actions shared by the two account views. Refresh ordering remains view-specific. */
export function useAccountActions(
    getAccount: () => Account,
    isEnglish: () => boolean
): {
    busy: Record<string, boolean>
    error: Ref<string>
    copiedEmail: Ref<boolean>
    copiedCredentials: Ref<boolean>
    switchAccount: () => Promise<void>
    refreshInfo: (includeToken: boolean) => Promise<void>
    refreshToken: () => Promise<void>
    clearSuspended: () => Promise<void>
    logout: () => Promise<void>
    remove: () => Promise<void>
    unbind: () => Promise<void>
    copy: (kind: 'email' | 'credentials') => Promise<void>
    support: () => Promise<void>
} {
    const accounts = useAccountsStore()
    const settings = useSettingsStore()
    const persistence = usePersistenceStore()
    const proxyPool = useProxyPoolStore()
    const busy = reactive<Record<string, boolean>>({})
    const error = ref('')
    const copiedEmail = ref(false)
    const copiedCredentials = ref(false)
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let active = true

    function text(zh: string, en: string): string {
        return isEnglish() ? en : zh
    }

    async function execute(name: string, action: () => Promise<void>): Promise<void> {
        if (!active || busy[name]) return
        busy[name] = true
        error.value = ''
        try {
            await action()
        } catch (cause) {
            if (active) error.value = cause instanceof Error ? cause.message : String(cause)
        } finally {
            if (active) busy[name] = false
        }
    }

    function switchAccount(): Promise<void> {
        return execute('switch', async () => {
            const account = getAccount()
            const credentials = account.credentials
            if (
                !credentials.refreshToken ||
                (credentials.authMethod !== 'social' &&
                    (!credentials.clientId || !credentials.clientSecret))
            ) {
                throw new Error(
                    text('账号凭证不完整，无法切换', 'Incomplete credentials, cannot switch')
                )
            }
            const target = settings.switchTarget || 'ide'
            const cliPayload = toIpcData({
                accessToken: credentials.accessToken,
                refreshToken: credentials.refreshToken,
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
                region: credentials.region || 'us-east-1',
                profileArn: account.profileArn,
                provider: credentials.provider
            })
            const idePayload = toIpcData({
                accessToken: credentials.accessToken,
                refreshToken: credentials.refreshToken,
                clientId: credentials.clientId || '',
                clientSecret: credentials.clientSecret || '',
                region: credentials.region || 'us-east-1',
                startUrl: credentials.startUrl,
                authMethod: credentials.authMethod,
                provider: credentials.provider,
                profileArn: account.profileArn,
                accountId: account.id
            })
            let success = true
            let message = ''
            if (target === 'ide' || target === 'both') {
                const result = await window.api.switchAccount(idePayload)
                if (!active) return
                if (!result.success) {
                    success = false
                    message = result.error || ''
                } else if (result.refreshedCredentials) {
                    const latest = accounts.accounts.get(account.id)
                    if (latest) {
                        const refreshed = result.refreshedCredentials
                        accounts.$patch((state) => {
                            const updated = new Map(state.accounts)
                            updated.set(account.id, {
                                ...latest,
                                credentials: {
                                    ...latest.credentials,
                                    accessToken: refreshed.accessToken,
                                    refreshToken: refreshed.refreshToken,
                                    expiresAt: Date.now() + refreshed.expiresIn * 1000
                                }
                            })
                            state.accounts = updated
                        })
                        persistence.saveToStorage()
                    }
                }
            }
            if (!active) return
            if (target === 'cli' || target === 'both') {
                const result = await window.api.switchAccountCli(cliPayload)
                if (!active) return
                if (!result.success && target === 'cli') {
                    success = false
                    message = result.error || ''
                }
            }
            if (success) {
                if (accounts.accounts.has(account.id)) accounts.setActiveAccount(account.id)
            } else throw new Error(text(`切换失败：${message}`, `Switch failed: ${message}`))
        })
    }

    function refreshInfo(includeToken: boolean): Promise<void> {
        return execute('refresh', async () => {
            const id = getAccount().id
            if (includeToken) await accounts.refreshAccountToken(id)
            if (active && accounts.accounts.has(id)) await accounts.checkAccountStatus(id)
        })
    }

    function refreshToken(): Promise<void> {
        return execute('token', async () => {
            await accounts.refreshAccountToken(getAccount().id)
        })
    }

    function clearSuspended(): Promise<void> {
        return execute('suspended', async () => {
            const id = getAccount().id
            const result = await window.api.proxyClearAccountSuspended(id)
            if (!active) return
            if (!result.success)
                throw new Error(result.error || text('重置封禁失败', 'Reset suspended failed'))
            if (accounts.accounts.has(id)) accounts.updateAccountStatus(id, 'active', undefined)
        })
    }

    function logout(): Promise<void> {
        return execute('logout', async () => {
            const confirmed = await confirmDialog({
                title: text('退出 Kiro 登录？', 'Logout from Kiro?'),
                message: text('这将清除本地 SSO 缓存。', 'This will clear the local SSO cache.'),
                tone: 'danger'
            })
            if (!active || !confirmed) return
            const result = await window.api.logoutAccount()
            if (!active) return
            if (!result.success) throw new Error(result.error || text('退出失败', 'Logout failed'))
            accounts.setActiveAccount(null)
            snackbar.show(
                text(
                    `退出成功，已清除 ${result.deletedCount} 个缓存文件`,
                    `Logged out, cleared ${result.deletedCount} cache files`
                ),
                { tone: 'success' }
            )
        })
    }

    function remove(): Promise<void> {
        return execute('delete', async () => {
            const account = getAccount()
            const confirmed = await confirmDialog({
                title: text('删除账号？', 'Delete account?'),
                message: getDisplayName(account),
                tone: 'danger'
            })
            if (active && confirmed) accounts.removeAccount(account.id)
        })
    }

    function unbind(): Promise<void> {
        return execute('unbind', async () => {
            const account = getAccount()
            const confirmed = await confirmDialog({
                title: text('解除代理绑定？', 'Unbind proxy?'),
                message: account.email,
                tone: 'danger'
            })
            if (active && confirmed) {
                proxyPool.unbindAccountFromProxy(account.id)
            }
        })
    }

    function copy(kind: 'email' | 'credentials'): Promise<void> {
        return execute(`copy-${kind}`, async () => {
            const account = getAccount()
            const content =
                kind === 'email'
                    ? account.email || account.userId || ''
                    : JSON.stringify(
                          {
                              accessToken: account.credentials.accessToken,
                              refreshToken: account.credentials.refreshToken,
                              clientId: account.credentials.clientId,
                              clientSecret: account.credentials.clientSecret
                          },
                          null,
                          2
                      )
            if (!content) return
            await navigator.clipboard.writeText(content)
            if (!active) return
            const state = kind === 'email' ? copiedEmail : copiedCredentials
            state.value = true
            const timer = setTimeout(
                () => {
                    timers.delete(timer)
                    state.value = false
                },
                kind === 'email' ? 1500 : 2000
            )
            timers.add(timer)
        })
    }

    function support(): Promise<void> {
        return execute('support', async () => {
            await window.api.openExternal('https://support.aws.amazon.com/#/contacts/kiro')
        })
    }

    onBeforeUnmount(() => {
        active = false
        for (const timer of timers) clearTimeout(timer)
        timers.clear()
    })
    return {
        busy,
        error,
        copiedEmail,
        copiedCredentials,
        switchAccount,
        refreshInfo,
        refreshToken,
        clearSuspended,
        logout,
        remove,
        unbind,
        copy,
        support
    }
}
