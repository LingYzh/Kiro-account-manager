import type { Account } from '@shared/types/account'
import type {
    ProxyEntry,
    ProxyPoolConfig,
    ProxyProtocol,
    ProxyValidationResult
} from '@shared/types/proxy'
import { DEFAULT_PROXY_POOL_CONFIG } from '@shared/types/proxy'
import { defineStore, getActivePinia } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { ref } from 'vue'
import { toIpcData } from '../lib/ipcData'
import { useAccountsStore } from './accounts'
import { usePersistenceStore } from './persistence'

/** Vue 数据层：保留 React 既有动作与持久化边界，运行态归当前 Pinia 实例。 */
export const useProxyPoolStore = defineStore('kam-proxyPool', () => {
    const pinia = getActivePinia()!
    const proxyPool = ref<Map<string, ProxyEntry>>(new Map<string, ProxyEntry>())
    const proxyPoolConfig = ref<ProxyPoolConfig>({ ...DEFAULT_PROXY_POOL_CONFIG })
    const proxyPoolCursor = ref<number>(0)
    const accountProxyBindings = ref<Record<string, string>>({})
    function addProxy(
        url: string,
        options?: {
            label?: string
            source?: string
            tags?: string[]
        }
    ): string | null {
        const parsed = parseProxyUrl(url)
        if (!parsed) return null
        // 去重：同 host:port:protocol:username 视为重复
        // 含 username 以支持 bestproxy 等「单入口、靠用户名区分地区/会话」的轮换代理添加多条
        const existingPool = useProxyPoolStore(pinia).proxyPool
        for (const entry of existingPool.values()) {
            if (
                entry.host === parsed.host &&
                entry.port === parsed.port &&
                entry.protocol === parsed.protocol &&
                (entry.username || '') === (parsed.username || '')
            ) {
                return null
            }
        }
        const id = uuidv4()
        const entry: ProxyEntry = {
            id,
            url: parsed.normalized,
            protocol: parsed.protocol,
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
            password: parsed.password,
            label: options?.label,
            source: options?.source ?? 'manual',
            tags: options?.tags,
            status: 'untested',
            usedCount: 0,
            failCount: 0,
            enabled: true,
            createdAt: Date.now()
        }
        {
            const state = {
                proxyPool: useProxyPoolStore(pinia).proxyPool
            }
            const next = new Map(state.proxyPool)
            next.set(id, entry)
            const changes: {
                proxyPool: Map<string, ProxyEntry>
            } = { proxyPool: next }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        return id
    }
    function importProxies(text: string): {
        added: number
        skipped: number
        failed: number
    } {
        const result = { added: 0, skipped: 0, failed: 0 }
        const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'))
        if (lines.length === 0) return result
        // 批量构造新条目，最后只 set 一次，避免 O(n²) re-render
        const existingPool = useProxyPoolStore(pinia).proxyPool
        const existingKeys = new Set<string>()
        for (const entry of existingPool.values()) {
            existingKeys.add(
                `${entry.protocol}://${entry.username || ''}@${entry.host}:${entry.port}`
            )
        }
        const newEntries: ProxyEntry[] = []
        for (const line of lines) {
            const parsed = parseProxyUrl(line)
            if (!parsed) {
                result.failed++
                continue
            }
            const key = `${parsed.protocol}://${parsed.username || ''}@${parsed.host}:${parsed.port}`
            if (existingKeys.has(key)) {
                result.skipped++
                continue
            }
            existingKeys.add(key)
            newEntries.push({
                id: uuidv4(),
                url: parsed.normalized,
                protocol: parsed.protocol,
                host: parsed.host,
                port: parsed.port,
                username: parsed.username,
                password: parsed.password,
                source: 'import',
                status: 'untested',
                usedCount: 0,
                failCount: 0,
                enabled: true,
                createdAt: Date.now()
            })
            result.added++
        }
        if (newEntries.length > 0) {
            {
                const state = {
                    proxyPool: useProxyPoolStore(pinia).proxyPool
                }
                const next = new Map(state.proxyPool)
                for (const e of newEntries) next.set(e.id, e)
                const changes: {
                    proxyPool: Map<string, ProxyEntry>
                } = { proxyPool: next }
                useProxyPoolStore(pinia).$patch((state) => {
                    state.proxyPool = changes.proxyPool
                })
            }
            usePersistenceStore(pinia).saveToStorage()
        }
        return result
    }
    function removeProxy(id: string): void {
        // 收集受影响的账号（绑定到该代理的账号）
        const affectedAccountIds = Object.entries(useProxyPoolStore(pinia).accountProxyBindings)
            .filter(([, pid]) => pid === id)
            .map(([aid]) => aid)
        {
            const state = {
                proxyPool: useProxyPoolStore(pinia).proxyPool,
                accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings
            }
            const next = new Map(state.proxyPool)
            next.delete(id)
            // 同步清理绑定
            const bindings = { ...state.accountProxyBindings }
            for (const aid of affectedAccountIds) delete bindings[aid]
            const changes: {
                proxyPool: Map<string, ProxyEntry>
                accountProxyBindings: Record<string, string>
            } = { proxyPool: next, accountProxyBindings: bindings }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 通知主进程：这些账号现在无代理绑定，回退全局
        for (const aid of affectedAccountIds) syncAccountProxyToMain(aid)
    }
    function removeProxies(ids: string[]): void {
        if (ids.length === 0) return
        const idSet = new Set(ids)
        const affectedAccountIds = Object.entries(useProxyPoolStore(pinia).accountProxyBindings)
            .filter(([, pid]) => idSet.has(pid))
            .map(([aid]) => aid)
        {
            const state = {
                proxyPool: useProxyPoolStore(pinia).proxyPool,
                accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings
            }
            const next = new Map(state.proxyPool)
            for (const id of ids) next.delete(id)
            const bindings = { ...state.accountProxyBindings }
            for (const aid of affectedAccountIds) delete bindings[aid]
            const changes: {
                proxyPool: Map<string, ProxyEntry>
                accountProxyBindings: Record<string, string>
            } = { proxyPool: next, accountProxyBindings: bindings }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        for (const aid of affectedAccountIds) syncAccountProxyToMain(aid)
    }
    function toggleProxyEnabled(id: string, enabled?: boolean): void {
        {
            const state = {
                proxyPool: useProxyPoolStore(pinia).proxyPool
            }
            const next = new Map(state.proxyPool)
            const entry = next.get(id)
            if (entry) {
                next.set(id, { ...entry, enabled: enabled ?? !entry.enabled })
            }
            const changes: {
                proxyPool: Map<string, ProxyEntry>
            } = { proxyPool: next }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 通知所有绑定该代理的账号更新主进程内存（启用变化会影响是否可用）
        syncAllAccountsBoundToProxy(id)
    }
    function updateProxy(id: string, updates: Partial<ProxyEntry>): void {
        {
            const state = {
                proxyPool: useProxyPoolStore(pinia).proxyPool
            }
            const next = new Map(state.proxyPool)
            const entry = next.get(id)
            if (entry) {
                next.set(id, { ...entry, ...updates })
            }
            const changes: {
                proxyPool: Map<string, ProxyEntry>
            } = { proxyPool: next }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // url / 启用状态 / 状态变化都需要同步绑定账号
        if ('url' in updates || 'enabled' in updates || 'status' in updates) {
            syncAllAccountsBoundToProxy(id)
        }
    }
    async function validateProxy(id: string): Promise<ProxyValidationResult> {
        const entry = useProxyPoolStore(pinia).proxyPool.get(id)
        if (!entry) {
            return { success: false, error: 'Proxy not found' }
        }
        const { proxyPoolConfig } = {
            proxyPoolConfig: useProxyPoolStore(pinia).proxyPoolConfig
        }
        {
            const state = {
                proxyPool: useProxyPoolStore(pinia).proxyPool
            }
            const next = new Map(state.proxyPool)
            const existing = next.get(id)
            if (existing) next.set(id, { ...existing, status: 'testing' })
            const changes: {
                proxyPool: Map<string, ProxyEntry>
            } = { proxyPool: next }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
            })
        }
        let result: ProxyValidationResult
        try {
            result = await window.api.proxyPoolValidate(
                toIpcData({
                    url: entry.url,
                    testUrl: proxyPoolConfig.testUrl,
                    timeoutMs: proxyPoolConfig.testTimeoutMs,
                    upstreamProxy: proxyPoolConfig.upstreamProxy
                })
            )
        } catch (err) {
            result = { success: false, error: err instanceof Error ? err.message : String(err) }
        }
        {
            const state = {
                proxyPool: useProxyPoolStore(pinia).proxyPool,
                proxyPoolConfig: useProxyPoolStore(pinia).proxyPoolConfig
            }
            const next = new Map(state.proxyPool)
            const existing = next.get(id)
            if (existing) {
                const latencyMs = result.latencyMs
                const status: ProxyEntry['status'] = result.success
                    ? latencyMs !== undefined && latencyMs > 3000
                        ? 'slow'
                        : 'alive'
                    : 'dead'
                next.set(id, {
                    ...existing,
                    status,
                    latencyMs: result.latencyMs,
                    lastTestedAt: Date.now(),
                    lastError: result.success ? undefined : result.error,
                    // 验活失败也累计到 failCount，但不计入 reportProxyResult 的注册失败
                    failCount: result.success ? existing.failCount : existing.failCount + 1,
                    // 自动停用：累计失败超过阈值；但池中可用代理 <= 1 时保护性保留（轮换代理避免变直连）
                    enabled: result.success
                        ? existing.enabled
                        : state.proxyPoolConfig.autoDisableDead &&
                            existing.failCount + 1 >= state.proxyPoolConfig.failureThreshold &&
                            Array.from(state.proxyPool.values()).filter(
                                (p) => p.enabled && p.status !== 'dead'
                            ).length > 1
                          ? false
                          : existing.enabled
                })
            }
            const changes: {
                proxyPool: Map<string, ProxyEntry>
            } = { proxyPool: next }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 同步绑定账号：状态变化（alive/slow/dead）影响代理是否可用
        syncAllAccountsBoundToProxy(id)
        return result
    }
    async function validateProxiesBatch(ids: string[], concurrency: number = 5): Promise<void> {
        if (ids.length === 0) return
        const validateProxy = useProxyPoolStore(pinia).validateProxy
        let cursor = 0
        const worker = async (): Promise<void> => {
            while (cursor < ids.length) {
                const idx = cursor++
                try {
                    await validateProxy(ids[idx])
                } catch {
                    /* per-item error logged */
                }
            }
        }
        const workers = Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, () =>
            worker()
        )
        await Promise.all(workers)
    }
    function clearProxyPool(): void {
        const affectedAccountIds = Object.keys(useProxyPoolStore(pinia).accountProxyBindings)
        {
            const changes: {
                proxyPool: Map<string, ProxyEntry>
                proxyPoolCursor: number
                accountProxyBindings: Record<string, string>
            } = { proxyPool: new Map(), proxyPoolCursor: 0, accountProxyBindings: {} }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
                state.proxyPoolCursor = changes.proxyPoolCursor
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 通知所有曾被绑定的账号回退全局
        for (const aid of affectedAccountIds) syncAccountProxyToMain(aid)
    }
    function setProxyPoolConfig(config: Partial<ProxyPoolConfig>): void {
        {
            const state = {
                proxyPoolConfig: useProxyPoolStore(pinia).proxyPoolConfig
            }
            const changes: {
                proxyPoolConfig: ProxyPoolConfig
            } = {
                proxyPoolConfig: { ...state.proxyPoolConfig, ...config }
            }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPoolConfig = changes.proxyPoolConfig
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function pickNextProxy(): ProxyEntry | null {
        const { proxyPool, proxyPoolConfig, proxyPoolCursor } = {
            proxyPool: useProxyPoolStore(pinia).proxyPool,
            proxyPoolConfig: useProxyPoolStore(pinia).proxyPoolConfig,
            proxyPoolCursor: useProxyPoolStore(pinia).proxyPoolCursor
        }
        if (!proxyPoolConfig.enabled) return null
        // 仅在启用且非 dead 的代理中挑选
        const candidates = Array.from(proxyPool.values()).filter(
            (p) => p.enabled && p.status !== 'dead'
        )
        if (candidates.length === 0) return null
        let picked: ProxyEntry
        switch (proxyPoolConfig.strategy) {
            case 'random':
                picked = candidates[Math.floor(Math.random() * candidates.length)]
                break
            case 'least_used':
                picked = candidates.reduce((min, cur) =>
                    cur.usedCount < min.usedCount ? cur : min
                )
                break
            case 'fastest':
                // 已测过的优先按延迟升序；未测过的排最后
                picked = candidates.slice().sort((a, b) => {
                    const la = a.latencyMs ?? Number.POSITIVE_INFINITY
                    const lb = b.latencyMs ?? Number.POSITIVE_INFINITY
                    return la - lb
                })[0]
                break
            case 'round_robin':
            default: {
                const idx = proxyPoolCursor % candidates.length
                picked = candidates[idx]
                {
                    const changes: {
                        proxyPoolCursor: number
                    } = { proxyPoolCursor: proxyPoolCursor + 1 }
                    useProxyPoolStore(pinia).$patch((state) => {
                        state.proxyPoolCursor = changes.proxyPoolCursor
                    })
                }
                break
            }
        }
        {
            const state = {
                proxyPool: useProxyPoolStore(pinia).proxyPool
            }
            const next = new Map(state.proxyPool)
            const existing = next.get(picked.id)
            if (existing) {
                next.set(picked.id, {
                    ...existing,
                    usedCount: existing.usedCount + 1,
                    lastUsedAt: Date.now()
                })
            }
            const changes: {
                proxyPool: Map<string, ProxyEntry>
            } = { proxyPool: next }
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        return picked
    }
    function reportProxyResult(
        id: string,
        success: boolean,
        boundEmail?: string,
        errorMsg?: string
    ): void {
        let autoDisabled = false
        {
            const changes: {
                proxyPool: Map<string, ProxyEntry>
            } = ((state: {
                proxyPool: Map<string, ProxyEntry>
                proxyPoolConfig: ProxyPoolConfig
            }): {
                proxyPool: Map<string, ProxyEntry>
            } => {
                const next = new Map(state.proxyPool)
                const existing = next.get(id)
                if (!existing) return state
                // 仅「代理连接层错误」才累加 failCount；AWS 业务/风控失败（如 Portal/EOF/邮箱已注册）不计，
                // 避免把好代理（尤其只配了一条的轮换代理）误判停用导致变直连暴露真实 IP。
                const isProxyFail = !success && isProxyConnectionError(errorMsg)
                const failCount = isProxyFail ? existing.failCount + 1 : existing.failCount
                // 轮换代理保护：池中可用代理 <= 1 时不自动停用
                const enabledCount = Array.from(state.proxyPool.values()).filter(
                    (p) => p.enabled && p.status !== 'dead'
                ).length
                const autoDisable =
                    isProxyFail &&
                    state.proxyPoolConfig.autoDisableDead &&
                    failCount >= state.proxyPoolConfig.failureThreshold &&
                    enabledCount > 1
                autoDisabled = autoDisable
                next.set(id, {
                    ...existing,
                    failCount,
                    lastBoundEmail: boundEmail || existing.lastBoundEmail,
                    lastError: success ? existing.lastError : errorMsg || existing.lastError,
                    enabled: autoDisable ? false : existing.enabled,
                    status: autoDisable ? 'dead' : existing.status
                })
                return { proxyPool: next }
            })({
                proxyPool: useProxyPoolStore(pinia).proxyPool,
                proxyPoolConfig: useProxyPoolStore(pinia).proxyPoolConfig
            })
            useProxyPoolStore(pinia).$patch((state) => {
                state.proxyPool = changes.proxyPool
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 仅在代理被自动停用时通知主进程（普通 used/failCount 计数变化无需同步）
        if (autoDisabled) {
            syncAllAccountsBoundToProxy(id)
        }
    }
    function bindAccountToProxy(accountId: string, proxyId: string): void {
        {
            const state = {
                accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings
            }
            const changes: {
                accountProxyBindings: Record<string, string>
            } = {
                accountProxyBindings: { ...state.accountProxyBindings, [accountId]: proxyId }
            }
            useProxyPoolStore(pinia).$patch((state) => {
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 同步到主进程的账号池
        syncAccountProxyToMain(accountId)
    }
    function bindAccountsToProxy(accountIds: string[], proxyId: string): void {
        if (accountIds.length === 0) return
        {
            const state = {
                accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings
            }
            const next = { ...state.accountProxyBindings }
            for (const id of accountIds) next[id] = proxyId
            const changes: {
                accountProxyBindings: Record<string, string>
            } = { accountProxyBindings: next }
            useProxyPoolStore(pinia).$patch((state) => {
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        for (const id of accountIds) syncAccountProxyToMain(id)
    }
    function unbindAccountFromProxy(accountId: string): void {
        {
            const state = {
                accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings
            }
            const next = { ...state.accountProxyBindings }
            delete next[accountId]
            const changes: {
                accountProxyBindings: Record<string, string>
            } = { accountProxyBindings: next }
            useProxyPoolStore(pinia).$patch((state) => {
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        syncAccountProxyToMain(accountId)
    }
    function clearAccountProxyBindings(): void {
        const old = Object.keys(useProxyPoolStore(pinia).accountProxyBindings)
        {
            const changes: {
                accountProxyBindings: Record<string, string>
            } = { accountProxyBindings: {} }
            useProxyPoolStore(pinia).$patch((state) => {
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        for (const id of old) syncAccountProxyToMain(id)
    }
    function autoDistributeAccountsToProxies({
        accountsPerProxy = 0,
        onlyUnbound = false,
        accountIds
    }: {
        accountsPerProxy?: number
        onlyUnbound?: boolean
        accountIds?: string[] // 限定分配范围，不填则全部
    }): {
        distributed: number
        perProxy: Record<string, number>
        skipped: number
    } {
        const state = {
            proxyPool: useProxyPoolStore(pinia).proxyPool,
            accounts: useAccountsStore(pinia).accounts,
            accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings
        }
        const aliveProxies = Array.from(state.proxyPool.values()).filter(
            (p) => p.enabled && p.status !== 'dead'
        )
        if (aliveProxies.length === 0) {
            return { distributed: 0, perProxy: {}, skipped: 0 }
        }
        // 候选账号
        const candidates = accountIds
            ? accountIds.map((id) => state.accounts.get(id)).filter((a): a is Account => !!a)
            : Array.from(state.accounts.values())
        const targets = onlyUnbound
            ? candidates.filter((a) => !state.accountProxyBindings[a.id])
            : candidates
        if (targets.length === 0) {
            return { distributed: 0, perProxy: {}, skipped: candidates.length }
        }
        const perProxy: Record<string, number> = {}
        aliveProxies.forEach((p) => {
            perProxy[p.id] = 0
        })
        const newBindings = { ...state.accountProxyBindings }
        // 取消已绑定到失效/不存在代理的账号（仅 onlyUnbound=false 时统一重新分配）
        if (!onlyUnbound) {
            for (const id of Object.keys(newBindings)) {
                const proxyExists = aliveProxies.some((p) => p.id === newBindings[id])
                if (!proxyExists) delete newBindings[id]
            }
        }
        let distributed = 0
        let cursor = 0
        for (const account of targets) {
            // accountsPerProxy=0：均分；非 0：每代理填满 N 个再换下一个
            let chosenProxyId: string
            if (accountsPerProxy > 0) {
                // 找第一个还未填满的代理
                let found: string | undefined
                for (let i = 0; i < aliveProxies.length; i++) {
                    const pid = aliveProxies[i].id
                    if (perProxy[pid] < accountsPerProxy) {
                        found = pid
                        break
                    }
                }
                if (!found) {
                    // 全部代理都满了：跳过剩余账号
                    break
                }
                chosenProxyId = found
            } else {
                chosenProxyId = aliveProxies[cursor % aliveProxies.length].id
                cursor++
            }
            newBindings[account.id] = chosenProxyId
            perProxy[chosenProxyId]++
            distributed++
        }
        {
            const changes: {
                accountProxyBindings: Record<string, string>
            } = { accountProxyBindings: newBindings }
            useProxyPoolStore(pinia).$patch((state) => {
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 同步到主进程
        for (const id of targets.slice(0, distributed)) {
            syncAccountProxyToMain(id.id)
        }
        return { distributed, perProxy, skipped: targets.length - distributed }
    }
    function getAccountProxyUrl(accountId: string): string | undefined {
        const state = {
            accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings,
            proxyPool: useProxyPoolStore(pinia).proxyPool
        }
        const proxyId = state.accountProxyBindings[accountId]
        if (!proxyId) return undefined
        const proxy = state.proxyPool.get(proxyId)
        if (!proxy || !proxy.enabled || proxy.status === 'dead') return undefined
        return proxy.url
    }
    /**
     * 把单个账号的代理绑定信息同步到主进程账号池
     * （主进程账号池里的 ProxyAccount.proxyUrl 由此 IPC 设置）
     */
    function syncAccountProxyToMain(accountId: string): void {
        try {
            const url = useProxyPoolStore(pinia).getAccountProxyUrl(accountId)
            void window.api.accountSetProxyBinding?.(toIpcData(accountId), toIpcData(url))
        } catch (err) {
            console.warn('[Store] Failed to sync account proxy binding to main:', err)
        }
    }
    /**
     * 当某个代理发生变化（URL/启用状态/有效性）时，
     * 同步所有绑定到该代理的账号到主进程，确保主进程内存里的 ProxyAccount.proxyUrl 与代理池实际情况一致
     */
    function syncAllAccountsBoundToProxy(proxyId: string): void {
        try {
            const state = useProxyPoolStore(pinia)
            const affectedAccountIds = Object.entries(state.accountProxyBindings)
                .filter(([, pid]) => pid === proxyId)
                .map(([aid]) => aid)
            for (const aid of affectedAccountIds) {
                syncAccountProxyToMain(aid)
            }
        } catch (err) {
            console.warn('[Store] Failed to sync accounts bound to proxy:', err)
        }
    }
    // ==================== 代理 URL 解析辅助 ====================
    interface ParsedProxy {
        protocol: ProxyProtocol
        host: string
        port: number
        username?: string
        password?: string
        normalized: string
    }
    /**
     * 解析多种代理 URL 格式：
     *   - http://host:port
     *   - http://user:pass@host:port
     *   - socks5://host:port
     *   - host:port              （默认 http）
     *   - host:port:user:pass    （Stormproxies 等代理商常用格式）
     *   - user:pass@host:port    （省略 scheme）
     */
    // 判断错误是否为「代理连接层」问题（而非 AWS 业务/风控失败）。
    // 仅这类错误才累加代理 failCount / 触发自动停用，避免风控失败把好代理（尤其单条轮换代理）误杀成直连。
    function isProxyConnectionError(msg: string | undefined): boolean {
        const m = (msg || '').toLowerCase()
        if (!m) return false
        return (
            m.includes('proxy') ||
            m.includes('econnrefused') ||
            m.includes('econnreset') ||
            m.includes('etimedout') ||
            m.includes('ehostunreach') ||
            m.includes('enetunreach') ||
            m.includes('tunnel') ||
            m.includes('dial tcp') ||
            m.includes('connection refused') ||
            m.includes('connection reset') ||
            m.includes('407') ||
            m.includes('socks')
        )
    }
    function parseProxyUrl(raw: string): ParsedProxy | null {
        const trimmed = (raw || '').trim()
        if (!trimmed) return null
        // 形式 1: scheme://...
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
            try {
                const u = new URL(trimmed)
                const protocol = normalizeProtocol(u.protocol.replace(':', ''))
                if (!protocol) return null
                const port = Number(u.port) || defaultPort(protocol)
                if (!u.hostname || !Number.isFinite(port)) return null
                return {
                    protocol,
                    host: u.hostname,
                    port,
                    username: u.username ? decodeURIComponent(u.username) : undefined,
                    password: u.password ? decodeURIComponent(u.password) : undefined,
                    normalized: buildProxyUrl(protocol, u.hostname, port, u.username, u.password)
                }
            } catch {
                return null
            }
        }
        // 形式 2: host:port:user:pass（4 段冒号分隔）
        const segs = trimmed.split(':')
        if (segs.length === 4 && /^\d+$/.test(segs[1])) {
            const [host, portStr, user, pass] = segs
            const port = Number(portStr)
            if (!host || !Number.isFinite(port)) return null
            return {
                protocol: 'http',
                host,
                port,
                username: user || undefined,
                password: pass || undefined,
                normalized: buildProxyUrl('http', host, port, user, pass)
            }
        }
        // 形式 3: user:pass@host:port（缺 scheme）
        if (trimmed.includes('@')) {
            const [authPart, hostPart] = trimmed.split('@')
            const [user, pass] = authPart.split(':')
            const [host, portStr] = (hostPart || '').split(':')
            const port = Number(portStr)
            if (!host || !Number.isFinite(port)) return null
            return {
                protocol: 'http',
                host,
                port,
                username: user || undefined,
                password: pass || undefined,
                normalized: buildProxyUrl('http', host, port, user, pass)
            }
        }
        // 形式 4: host:port（裸格式，默认 http）
        if (segs.length === 2 && /^\d+$/.test(segs[1])) {
            const port = Number(segs[1])
            if (!segs[0] || !Number.isFinite(port)) return null
            return {
                protocol: 'http',
                host: segs[0],
                port,
                normalized: buildProxyUrl('http', segs[0], port)
            }
        }
        return null
    }
    function normalizeProtocol(raw: string): ProxyProtocol | null {
        const p = raw.toLowerCase()
        if (p === 'http' || p === 'https' || p === 'socks5' || p === 'socks4') return p
        if (p === 'socks') return 'socks5'
        return null
    }
    function defaultPort(protocol: ProxyProtocol): number {
        switch (protocol) {
            case 'http':
                return 8080
            case 'https':
                return 443
            case 'socks5':
            case 'socks4':
                return 1080
        }
    }
    function buildProxyUrl(
        protocol: ProxyProtocol,
        host: string,
        port: number,
        username?: string,
        password?: string
    ): string {
        const auth = username
            ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
            : ''
        return `${protocol}://${auth}${host}:${port}`
    }

    return {
        proxyPool,
        proxyPoolConfig,
        proxyPoolCursor,
        accountProxyBindings,
        addProxy,
        importProxies,
        removeProxy,
        removeProxies,
        toggleProxyEnabled,
        updateProxy,
        validateProxy,
        validateProxiesBatch,
        clearProxyPool,
        setProxyPoolConfig,
        pickNextProxy,
        reportProxyResult,
        bindAccountToProxy,
        bindAccountsToProxy,
        unbindAccountFromProxy,
        clearAccountProxyBindings,
        autoDistributeAccountsToProxies,
        getAccountProxyUrl
    }
})
