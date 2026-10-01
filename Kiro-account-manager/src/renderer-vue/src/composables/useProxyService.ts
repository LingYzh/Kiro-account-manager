import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAccountsStore } from '../stores/accounts'
import { toIpcData } from '../lib/ipcData'

export interface ProxyConfig extends Record<string, unknown> {
    port: number
    host: string
    apiKey?: string
    enableMultiAccount: boolean
    logRequests: boolean
    clientDrivenToolExecution?: boolean
    disableTools?: boolean
    selectedAccountId?: string
    selectedAccountIds?: string[]
    multiAccountSelectionMode?: 'all' | 'groups'
    multiAccountGroupIds?: string[]
    claudeModelIdMappingEnabled?: boolean
    modelMappings?: Record<string, unknown>[]
}

export interface ProxyLog extends Record<string, unknown> {
    time: string
    path: string
    status: number
    tokens?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    reasoningTokens?: number
    credits?: number
}

export interface ProxyStats extends Record<string, number> {
    totalRequests: number
    successRequests: number
    failedRequests: number
    totalTokens: number
    totalCredits: number
    inputTokens: number
    outputTokens: number
    startTime: number
}

/** One lifetime for the retained API proxy page, including its event log. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useProxyService() {
    const accounts = useAccountsStore()
    const running = ref(false)
    const initialized = ref(false)
    const loading = ref(false)
    const config = ref<ProxyConfig>({
        port: 5580,
        host: '127.0.0.1',
        enableMultiAccount: true,
        logRequests: true,
        claudeModelIdMappingEnabled: true,
        clientDrivenToolExecution: true
    })
    const stats = ref<ProxyStats | null>(null)
    const sessionStats = ref<{
        totalRequests: number
        successRequests: number
        failedRequests: number
        startTime: number
    } | null>(null)
    const accountCount = ref(0)
    const availableCount = ref(0)
    const models = ref<{ id: string; name: string }[]>([])
    const logs = ref<ProxyLog[]>([])
    const error = ref('')
    const operating = ref(false)
    const syncing = ref(false)
    const refreshingModels = ref(false)
    const uptime = ref(0)
    const pendingConfig = ref(0)
    let active = true
    let configRevision = 0
    let statusRevision = 0
    let statusPromise: Promise<void> | undefined
    let syncPromise: Promise<void> | undefined
    let writeQueue: Promise<void> = Promise.resolve()
    let logWriteQueue: Promise<void> = Promise.resolve()
    let logRevision = 0
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let syncTimer: ReturnType<typeof setTimeout> | undefined
    let uptimeTimer: ReturnType<typeof setInterval> | undefined
    let syncMounted = false
    const unsubscribe: (() => void)[] = []

    function failure(cause: unknown): void {
        if (active) error.value = cause instanceof Error ? cause.message : String(cause)
    }

    function fetchStatus(): Promise<void> {
        if (!active) return Promise.resolve()
        if (statusPromise) return statusPromise
        const revision = configRevision
        const lifecycle = statusRevision
        statusPromise = (async () => {
            const result = await window.api.proxyGetStatus()
            if (!active || lifecycle !== statusRevision) return
            running.value = result.running
            if (result.config && revision === configRevision && !pendingConfig.value) {
                const loaded = toIpcData(result.config) as ProxyConfig
                config.value = {
                    ...loaded,
                    selectedAccountId: loaded.selectedAccountIds?.length
                        ? loaded.selectedAccountIds[0]
                        : loaded.selectedAccountId,
                    clientDrivenToolExecution: loaded.clientDrivenToolExecution !== false
                }
            }
            if (result.stats) stats.value = result.stats as ProxyStats
            if (result.sessionStats) sessionStats.value = result.sessionStats
            const pool = await window.api.proxyGetAccounts()
            if (!active || lifecycle !== statusRevision) return
            accountCount.value = pool.accounts.length
            availableCount.value = pool.availableCount
            initialized.value = true
        })()
            .finally(() => {
                statusPromise = undefined
            })
            .then(() => {
                if (active && lifecycle !== statusRevision) return fetchStatus()
                return undefined
            })
        return statusPromise
    }

    function updateConfig(patch: Record<string, unknown>): Promise<void> {
        if (!active) return Promise.resolve()
        configRevision += 1
        config.value = { ...config.value, ...patch }
        pendingConfig.value += 1
        const plain = toIpcData(patch)
        const operation = writeQueue
            .catch(() => undefined)
            .then(async () => {
                if (!active) return
                const result = await window.api.proxyUpdateConfig(plain)
                if (!active) return
                if (!result.success)
                    throw new Error(result.error || 'Unable to save proxy configuration')
            })
            .catch((cause) => {
                failure(cause)
                throw cause
            })
            .finally(() => {
                if (active) pendingConfig.value -= 1
            })
        writeQueue = operation
        // Event handlers may intentionally ignore the returned Promise.
        void operation.catch(() => undefined)
        return operation
    }

    function loadModels(): Promise<void> {
        return Promise.resolve().then(async () => {
            if (!active) return
            const result = await window.api.proxyGetModels()
            if (!active) return
            if (!result.success) throw new Error(result.error || 'Unable to load models')
            models.value = result.models.map((model) => ({
                id: model.id,
                name: model.name || model.id
            }))
        })
    }

    function syncAccounts(override?: {
        mode?: 'all' | 'groups'
        groupIds?: string[]
    }): Promise<void> {
        if (!active) return Promise.resolve()
        if (syncPromise) {
            return syncPromise.catch(() => undefined).then(() => syncAccounts(override))
        }
        const mode = override?.mode ?? config.value.multiAccountSelectionMode ?? 'all'
        const groupIds = new Set(override?.groupIds ?? config.value.multiAccountGroupIds ?? [])
        const payload = Array.from(accounts.accounts.values())
            .filter((account) => account.status === 'active' && account.credentials?.accessToken)
            .filter(
                (account) =>
                    !config.value.enableMultiAccount ||
                    mode !== 'groups' ||
                    groupIds.has(account.groupId || '__ungrouped__')
            )
            .map((account) => ({
                id: account.id,
                email: account.email,
                accessToken: account.credentials.accessToken,
                refreshToken: account.credentials.refreshToken,
                profileArn: account.profileArn || account.credentials.profileArn,
                expiresAt: account.credentials.expiresAt,
                machineId: account.machineId,
                clientId: account.credentials.clientId,
                clientSecret: account.credentials.clientSecret,
                region: account.credentials.region || 'us-east-1',
                authMethod: account.credentials.authMethod,
                provider: account.credentials.provider || account.idp,
                groupId: account.groupId
            }))
        syncing.value = true
        syncPromise = (async () => {
            const result = await window.api.proxySyncAccounts(toIpcData(payload))
            if (!active) return
            if (!result.success) throw new Error('Unable to sync accounts')
            accountCount.value = result.accountCount || 0
            await fetchStatus()
        })()
            .catch((cause) => {
                failure(cause)
                throw cause
            })
            .finally(() => {
                syncPromise = undefined
                if (active) syncing.value = false
            })
        void syncPromise.catch(() => undefined)
        return syncPromise
    }

    async function operate(
        action: 'start' | 'stop' | 'public',
        publicEnabled?: boolean
    ): Promise<void> {
        if (!active || operating.value || !initialized.value) return
        operating.value = true
        error.value = ''
        try {
            await statusPromise?.catch(() => undefined)
            statusRevision += 1
            await writeQueue
            if (!active) return
            if (action === 'start') {
                await syncAccounts()
                if (!active) return
                const value = config.value
                const result = await window.api.proxyStart(
                    toIpcData({
                        port: value.port,
                        host: value.host,
                        apiKey: value.apiKey,
                        enableMultiAccount: value.enableMultiAccount,
                        logRequests: value.logRequests,
                        clientDrivenToolExecution: value.clientDrivenToolExecution !== false,
                        disableTools: value.disableTools
                    })
                )
                if (!active) return
                if (!result.success) throw new Error(result.error || 'Unable to start proxy')
                statusRevision += 1
                running.value = true
                await fetchStatus()
            } else if (action === 'stop') {
                const result = await window.api.proxyStop()
                if (!active) return
                if (!result.success) throw new Error(result.error || 'Unable to stop proxy')
                statusRevision += 1
                running.value = false
                stats.value = null
            } else {
                const wasRunning = running.value
                await updateConfig({ host: publicEnabled ? '0.0.0.0' : '127.0.0.1' })
                if (!active || !wasRunning) return
                const stopped = await window.api.proxyStop()
                if (!stopped.success) throw new Error(stopped.error || 'Unable to stop proxy')
                if (!active) return
                statusRevision += 1
                running.value = false
                await new Promise((resolve) => setTimeout(resolve, 200))
                if (!active) return
                const started = await window.api.proxyStart()
                if (!started.success) throw new Error(started.error || 'Unable to restart proxy')
                statusRevision += 1
                if (active) await fetchStatus()
            }
        } catch (cause) {
            failure(cause)
        } finally {
            if (active) operating.value = false
        }
    }

    function refreshModels(): Promise<void> {
        if (!active || refreshingModels.value) return Promise.resolve()
        refreshingModels.value = true
        error.value = ''
        return Promise.resolve()
            .then(async () => {
                if (!active) return
                const result = await window.api.proxyRefreshModels()
                if (!active) return
                if (!result.success) throw new Error(result.error || 'Unable to refresh models')
                await loadModels()
            })
            .catch(failure)
            .finally(() => {
                if (active) refreshingModels.value = false
            })
    }

    async function clearLogs(): Promise<void> {
        if (!active) return
        logs.value = []
        logRevision += 1
        if (saveTimer) clearTimeout(saveTimer)
        await saveLogs([])
    }

    function saveLogs(value: ProxyLog[]): Promise<void> {
        const plain = toIpcData(value)
        logWriteQueue = logWriteQueue
            .catch(() => undefined)
            .then(async () => {
                if (!active) return
                await window.api.proxySaveLogs(plain)
            })
        return logWriteQueue
    }

    async function reset(kind: 'credits' | 'tokens' | 'requests'): Promise<void> {
        const result =
            kind === 'credits'
                ? await window.api.proxyResetCredits()
                : kind === 'tokens'
                  ? await window.api.proxyResetTokens()
                  : await window.api.proxyResetRequestStats()
        if (!result.success) throw new Error('Unable to reset statistics')
        if (active) await fetchStatus()
    }

    async function initialize(): Promise<void> {
        if (!active || loading.value) return
        loading.value = true
        error.value = ''
        const revision = logRevision
        const results = await Promise.allSettled([
            fetchStatus(),
            loadModels(),
            window.api.proxyLoadLogs().then((result) => {
                if (!active || !result.success || !result.logs.length) return
                const history = result.logs as ProxyLog[]
                logs.value =
                    revision === logRevision ? history : [...logs.value, ...history].slice(0, 100)
            })
        ])
        if (!active) return
        for (const result of results) if (result.status === 'rejected') failure(result.reason)
        loading.value = false
    }

    const signature = computed(() =>
        Array.from(accounts.accounts.values())
            .filter((account) => account.status === 'active' && account.credentials?.accessToken)
            .map((account) => `${account.id}:${account.groupId || ''}`)
            .sort()
            .join('|')
    )
    watch([signature, running], () => {
        if (syncTimer) clearTimeout(syncTimer)
        if (!running.value) return
        if (!syncMounted) {
            syncMounted = true
            return
        }
        syncTimer = setTimeout(() => {
            if (active) void syncAccounts().catch(failure)
        }, 600)
    })
    watch(logs, () => {
        if (saveTimer) clearTimeout(saveTimer)
        if (!logs.value.length) return
        saveTimer = setTimeout(() => {
            if (active) void saveLogs(logs.value).catch(failure)
        }, 2000)
    })
    watch([running, stats], () => {
        if (uptimeTimer) clearInterval(uptimeTimer)
        uptimeTimer = undefined
        if (!running.value || !stats.value) {
            uptime.value = 0
            return
        }
        const tick = (): void => {
            uptime.value = Math.floor((Date.now() - (stats.value?.startTime || Date.now())) / 1000)
        }
        tick()
        uptimeTimer = setInterval(tick, 1000)
    })
    onMounted(() => {
        unsubscribe.push(
            window.api.onProxyRequest(() => undefined),
            window.api.onProxyResponse((info) => {
                if (!active) return
                const now = new Date()
                const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
                const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
                logs.value = [{ time, ...info }, ...logs.value.slice(0, 99)]
                logRevision += 1
                void fetchStatus().catch(failure)
            }),
            window.api.onProxyError(failure),
            window.api.onProxyStatusChange((status) => {
                if (!active) return
                statusRevision += 1
                running.value = status.running
                if (status.running) config.value = { ...config.value, port: status.port }
            })
        )
        void initialize()
    })
    onBeforeUnmount(() => {
        active = false
        for (const release of unsubscribe) release()
        if (saveTimer) clearTimeout(saveTimer)
        if (syncTimer) clearTimeout(syncTimer)
        if (uptimeTimer) clearInterval(uptimeTimer)
    })
    return {
        running,
        initialized,
        loading,
        config,
        stats,
        sessionStats,
        accountCount,
        availableCount,
        models,
        logs,
        error,
        operating,
        syncing,
        refreshingModels,
        uptime,
        pendingConfig,
        initialize,
        fetchStatus,
        loadModels,
        updateConfig,
        syncAccounts,
        operate,
        refreshModels,
        clearLogs,
        reset
    }
}
