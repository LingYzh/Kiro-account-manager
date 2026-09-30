import type { Account } from '@shared/types/account'
import { defineStore, getActivePinia } from 'pinia'
import { ref } from 'vue'
import { isBannedAccountError } from '../lib/accountRuntime'
import { toIpcData } from '../lib/ipcData'
import { useAccountsStore } from './accounts'
import { usePersistenceStore } from './persistence'
import { useSettingsStore } from './settings'

/** Vue 数据层：保留 React 既有动作与持久化边界，运行态归当前 Pinia 实例。 */
export const useAutoSwitchStore = defineStore('kam-autoSwitch', () => {
    const pinia = getActivePinia()!
    let autoSwitchTimer: ReturnType<typeof setInterval> | null = null
    const autoSwitchEnabled = ref<boolean>(false)
    const autoSwitchThreshold = ref<number>(0) // 余额阈值，低于此值时自动切换
    const autoSwitchInterval = ref<number>(5) // 检查间隔（分钟）
    function setAutoSwitch(enabled: boolean, threshold?: number, interval?: number): void {
        {
            const changes: {
                autoSwitchEnabled: boolean
                autoSwitchThreshold: number // 余额阈值，低于此值时自动切换
                autoSwitchInterval: number // 检查间隔（分钟）
            } = {
                autoSwitchEnabled: enabled,
                autoSwitchThreshold: threshold ?? useAutoSwitchStore(pinia).autoSwitchThreshold,
                autoSwitchInterval: interval ?? useAutoSwitchStore(pinia).autoSwitchInterval
            }
            useAutoSwitchStore(pinia).$patch((state) => {
                state.autoSwitchEnabled = changes.autoSwitchEnabled
                state.autoSwitchThreshold = changes.autoSwitchThreshold
                state.autoSwitchInterval = changes.autoSwitchInterval
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 重新启动定时器
        if (enabled) {
            useAutoSwitchStore(pinia).startAutoSwitch()
        } else {
            useAutoSwitchStore(pinia).stopAutoSwitch()
        }
    }
    function startAutoSwitch(): void {
        const { autoSwitchEnabled, autoSwitchInterval, checkAndAutoSwitch } = {
            autoSwitchEnabled: useAutoSwitchStore(pinia).autoSwitchEnabled,
            autoSwitchInterval: useAutoSwitchStore(pinia).autoSwitchInterval,
            checkAndAutoSwitch: useAutoSwitchStore(pinia).checkAndAutoSwitch
        }
        if (!autoSwitchEnabled) return
        // 清除现有定时器
        if (autoSwitchTimer) {
            clearInterval(autoSwitchTimer)
        }
        // 立即检查一次
        checkAndAutoSwitch()
        // 设置定时检查
        autoSwitchTimer = setInterval(
            () => {
                checkAndAutoSwitch()
            },
            autoSwitchInterval * 60 * 1000
        )
        console.log(`[AutoSwitch] Started with interval: ${autoSwitchInterval} minutes`)
    }
    function stopAutoSwitch(): void {
        if (autoSwitchTimer) {
            clearInterval(autoSwitchTimer)
            autoSwitchTimer = null
            console.log('[AutoSwitch] Stopped')
        }
    }
    async function checkAndAutoSwitch(): Promise<void> {
        const { accounts, autoSwitchThreshold, checkAccountStatus, setActiveAccount } = {
            accounts: useAccountsStore(pinia).accounts,
            autoSwitchThreshold: useAutoSwitchStore(pinia).autoSwitchThreshold,
            checkAccountStatus: useAccountsStore(pinia).checkAccountStatus,
            setActiveAccount: useAccountsStore(pinia).setActiveAccount
        }
        const activeAccount = useAccountsStore(pinia).getActiveAccount()
        if (!activeAccount) {
            console.log('[AutoSwitch] No active account')
            return
        }
        console.log(`[AutoSwitch] Checking active account: ${activeAccount.email}`)
        // 刷新当前账号状态获取最新余额
        await checkAccountStatus(activeAccount.id)
        // 重新获取更新后的账号信息
        const updatedAccount = useAccountsStore(pinia).accounts.get(activeAccount.id)
        if (!updatedAccount) return
        const remaining = updatedAccount.usage.limit - updatedAccount.usage.current
        console.log(`[AutoSwitch] Remaining: ${remaining}, Threshold: ${autoSwitchThreshold}`)
        // 检查是否需要切换
        if (remaining <= autoSwitchThreshold) {
            console.log(
                `[AutoSwitch] Account ${updatedAccount.email} reached threshold, switching...`
            )
            // 查找可用的账号
            const availableAccount = Array.from(accounts.values()).find((acc) => {
                // 排除当前账号
                if (acc.id === activeAccount.id) return false
                // 排除被封禁的账号
                if (isBannedAccountError(acc.lastError)) return false
                // 排除余额不足的账号
                const accRemaining = acc.usage.limit - acc.usage.current
                if (accRemaining <= autoSwitchThreshold) return false
                return true
            })
            if (availableAccount) {
                console.log(`[AutoSwitch] Switching to: ${availableAccount.email}`)
                setActiveAccount(availableAccount.id)
                // 根据 switchTarget 设置决定切换目标
                const { switchTarget: target } = {
                    switchTarget: useSettingsStore(pinia).switchTarget
                }
                const creds = availableAccount.credentials
                if (target === 'ide' || target === 'both') {
                    const switchResult = await window.api.switchAccount(
                        toIpcData({
                            accessToken: creds.accessToken || '',
                            refreshToken: creds.refreshToken || '',
                            clientId: creds.clientId || '',
                            clientSecret: creds.clientSecret || '',
                            region: creds.region || 'us-east-1',
                            startUrl: creds.startUrl,
                            authMethod: creds.authMethod,
                            provider: creds.provider,
                            profileArn: (
                                availableAccount as {
                                    profileArn?: string
                                }
                            ).profileArn,
                            accountId: availableAccount.id
                        })
                    )
                    // 把 main 进程 refresh 后的最新 credentials 同步回 store，
                    // 否则 store 里的 refreshToken 仍是 v1（已被服务端 rotate 作废），下次任何 refresh 都会失败
                    if (switchResult?.success && switchResult.refreshedCredentials) {
                        const rc = switchResult.refreshedCredentials
                        {
                            const state = {
                                accounts: useAccountsStore(pinia).accounts
                            }
                            const accounts = new Map(state.accounts)
                            const acc = accounts.get(availableAccount.id)
                            if (acc) {
                                accounts.set(availableAccount.id, {
                                    ...acc,
                                    credentials: {
                                        ...acc.credentials,
                                        accessToken: rc.accessToken,
                                        refreshToken: rc.refreshToken,
                                        expiresAt: Date.now() + rc.expiresIn * 1000
                                    }
                                })
                            }
                            const changes: {
                                accounts: Map<string, Account>
                            } = { accounts }
                            useAccountsStore(pinia).$patch((state) => {
                                state.accounts = changes.accounts
                            })
                        }
                        usePersistenceStore(pinia).saveToStorage()
                    }
                }
                if (target === 'cli' || target === 'both') {
                    window.api
                        .switchAccountCli?.({
                            accessToken: creds.accessToken || '',
                            refreshToken: creds.refreshToken || '',
                            clientId: creds.clientId,
                            clientSecret: creds.clientSecret,
                            region: creds.region || 'us-east-1',
                            profileArn: (
                                availableAccount as {
                                    profileArn?: string
                                }
                            ).profileArn,
                            provider: creds.provider
                        })
                        .catch((err) => console.warn('[AutoSwitch CLI] Failed:', err))
                }
            } else {
                console.log('[AutoSwitch] No available account to switch to')
            }
        }
    }

    return {
        autoSwitchEnabled,
        autoSwitchThreshold,
        autoSwitchInterval,
        setAutoSwitch,
        startAutoSwitch,
        stopAutoSwitch,
        checkAndAutoSwitch
    }
})
