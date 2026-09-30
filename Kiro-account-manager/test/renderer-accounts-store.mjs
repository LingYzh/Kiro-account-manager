import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// 特征测试（characterization test）：锁定 React 版 zustand accounts store
// （src/renderer/src/store/accounts.ts，3510 行）的现有行为，作为后续 Pinia 迁移的
// 验收基线。不修改 store 源码；断言值均取自现有实现的真实运行结果，疑似 bug 照实
// 锁定并在下方各段注释与 task-6-report.md 中说明。

// ============ 静默 console，测试结束后恢复 ============
// store 内部大量 console.log/warn/error（如 [Store]、[AutoSave]、[MachineId] 等前缀），
// 这里整体静默，避免测试输出被噪音淹没；仅在断言失败时用 assert 的报错定位问题。
const originalConsole = { log: console.log, warn: console.warn, error: console.error }
console.log = () => {}
console.warn = () => {}
console.error = () => {}

// ============ mock.timers：接管 setTimeout/setInterval/Date ============
// store 使用的四类定时器：saveDebounceTimer/saveMaxWaitTimer（saveToStorage 防抖）、
// autoSwitchTimer（自动换号）、autoSaveTimer（30s 定时保存）都是模块级 let 变量，
// 用 setTimeout/setInterval 实现——mock.timers 可以直接接管打包后模块内部调用的
// 全局定时器函数，无需修改源码。
mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })

const tempDir = await mkdtemp(join(tmpdir(), 'kiro-accounts-store-'))

// ============ window.api 与浏览器环境 mock：必须在动态 import 打包产物之前挂到 globalThis ============
// saveAccounts 记录每次调用的入参，供持久化往返/时序断言使用
const savedDocs = []
// localStorage 用 Map 实现最小桩（setActiveGroupTab / loadActiveGroupTab 用到）
const localStorageStore = new Map()

globalThis.localStorage = {
    getItem: (k) => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
    setItem: (k, v) => { localStorageStore.set(k, String(v)) },
    removeItem: (k) => { localStorageStore.delete(k) }
}

// document.documentElement.classList 记录 add/remove 的最小桩（applyTheme 用到）
const classListState = new Set()
globalThis.document = {
    documentElement: {
        classList: {
            add: (...names) => { for (const n of names) classListState.add(n) },
            remove: (...names) => { for (const n of names) classListState.delete(n) },
            contains: (n) => classListState.has(n)
        }
    }
}

// navigator.language（setLanguage 用到）。Node 22 自带全局 navigator（只有 getter），
// 不能直接赋值，需用 defineProperty 覆盖。
Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'zh-CN' },
    configurable: true
})

// window.api：store 在被测路径上会调用的方法全部 mock 成合理的 resolved 值
let loadAccountsReturnValue = null
const apiCalls = { setProxy: [], updateTrayLanguage: [], accountSetProxyBinding: [] }

globalThis.window = {
    api: {
        getAppVersion: async () => '1.2.3',
        loadAccounts: async () => loadAccountsReturnValue,
        saveAccounts: async (doc) => { savedDocs.push(doc) },
        machineIdSet: async () => ({ success: true }),
        machineIdGenerateRandom: async () => 'a'.repeat(64),
        machineIdGetCurrent: async () => ({ success: true, machineId: 'b'.repeat(64) }),
        backgroundBatchRefresh: async () => ({ successCount: 0, failedCount: 0 }),
        backgroundBatchCheck: async () => ({ successCount: 0, failedCount: 0 }),
        verifyAccountCredentials: async () => ({ success: false }),
        updateTrayLanguage: (lang) => { apiCalls.updateTrayLanguage.push(lang) },
        switchAccountCli: async () => ({ success: true }),
        switchAccount: async () => ({ success: true }),
        setProxy: async (enabled, url) => { apiCalls.setProxy.push({ enabled, url }); return { success: true, normalizedUrl: url } },
        setProactiveRenewalEnabled: async (enabled) => ({ success: true, enabled }),
        refreshAccountToken: async () => ({ success: false }),
        proxyPoolValidate: async () => ({ success: true, latencyMs: 100 }),
        loadKiroCredentials: async () => ({ success: false }),
        getProactiveRenewalEnabled: async () => ({ success: true, enabled: false, leadTimeMinutes: 15 }),
        getLocalActiveAccount: async () => ({ success: false }),
        checkAccountStatus: async () => ({ success: false }),
        accountSetProxyBinding: async (accountId, url) => { apiCalls.accountSetProxyBinding.push({ accountId, url }); return { success: true } }
    }
}

// crypto：Node 全局已有 webcrypto（randomUUID / getRandomValues），store 里直接用的是
// `crypto.getRandomValues` / `crypto.randomUUID`，全局 crypto 已满足，无需额外 mock。

try {
    const alias = {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/renderer-shared')
    }
    const outfile = join(tempDir, 'accounts.mjs')
    await build({
        entryPoints: [resolve('src/renderer/src/store/accounts.ts')],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        outfile,
        alias,
        // zustand/uuid 走 npm 包，直接打包进产物；不 external，避免测试环境再解析路径
        logLevel: 'silent'
    })

    const { useAccountsStore } = await import(pathToFileURL(outfile).href)

    /** 每个覆盖段开始前重置 store 到初始状态与全部 mock 记录，避免互相污染 */
    function resetAll() {
        savedDocs.length = 0
        apiCalls.setProxy.length = 0
        apiCalls.updateTrayLanguage.length = 0
        apiCalls.accountSetProxyBinding.length = 0
        loadAccountsReturnValue = null
        useAccountsStore.getState().stopAutoSwitch()
        useAccountsStore.getState().stopAutoSave()
        // filter/sort/activeGroupTab 不受 loadFromStorage 影响，段与段之间需手动复位，
        // 否则前一段设置的筛选条件会污染下一段的断言
        useAccountsStore.getState().clearFilter()
        useAccountsStore.getState().setSort({ field: 'lastUsedAt', order: 'desc' })
        useAccountsStore.getState().setActiveGroupTab('all')
    }

    console.log = originalConsole.log // 临时恢复，输出覆盖进度
    originalConsole.log('[accounts-store] 打包与 mock 就绪，开始覆盖项 1')
    console.log = () => {}

    // ============ 覆盖项 1：持久化往返 ============
    {
        // ---- 1a：全字段文档 round-trip ----
        // 构造覆盖 AccountData（src/preload/index.d.ts）全部字段的文档，包含 2 个账号、
        // 1 个分组、1 个标签、2 条代理池条目；theme='purple'、darkMode=true（brief 要求）。
        const acc1 = {
            id: 'acc-1',
            email: 'user1@example.com',
            password: 'pw1',
            nickname: 'User One',
            idp: 'Google',
            userId: 'uid-1',
            visitorId: 'vid-1',
            machineId: '1'.repeat(64),
            credentials: {
                accessToken: 'at-1',
                csrfToken: 'ct-1',
                refreshToken: 'rt-1',
                clientId: 'cid-1',
                clientSecret: 'cs-1',
                region: 'us-east-1',
                expiresAt: 1234567890,
                authMethod: 'social',
                provider: 'Google'
            },
            subscription: { type: 'Pro', title: 'KIRO PRO', rawType: 'Q_DEVELOPER_STANDALONE_PRO', expiresAt: 999999, daysRemaining: 10 },
            usage: { current: 5, limit: 25, percentUsed: 0.2, lastUpdated: 1000 },
            groupId: 'grp-1',
            tags: ['tag-1'],
            status: 'active',
            isActive: true, // 与 activeAccountId='acc-1' 一致，验证 loader 不会误改
            createdAt: 1,
            lastUsedAt: 2,
            lastCheckedAt: 3
        }
        const acc2 = {
            id: 'acc-2',
            email: 'user2@example.com',
            idp: 'Github',
            machineId: '2'.repeat(64),
            credentials: { accessToken: 'at-2', csrfToken: 'ct-2', refreshToken: 'rt-2', region: 'us-east-1', expiresAt: 222 },
            subscription: { type: 'Free' },
            usage: { current: 0, limit: 25, percentUsed: 0, lastUpdated: 500 },
            tags: [],
            status: 'expired',
            isActive: false,
            createdAt: 4,
            lastUsedAt: 5
        }

        const fullDoc = {
            accounts: { 'acc-1': acc1, 'acc-2': acc2 },
            groups: { 'grp-1': { id: 'grp-1', name: 'Group 1', description: 'd', color: '#fff', order: 0, createdAt: 5 } },
            tags: { 'tag-1': { id: 'tag-1', name: 'Tag1', color: '#000' } },
            activeAccountId: 'acc-1',
            autoRefreshEnabled: false,
            autoRefreshInterval: 7,
            autoRefreshConcurrency: 42,
            autoRefreshSyncInfo: false,
            statusCheckInterval: 30,
            privacyMode: true,
            usagePrecision: true,
            proxyEnabled: true,
            proxyUrl: 'http://127.0.0.1:1080',
            autoSwitchEnabled: false, // 关闭以避免拉起 checkAndAutoSwitch 的网络链路，专注持久化字段
            autoSwitchThreshold: 5,
            autoSwitchInterval: 3,
            switchTarget: 'cli',
            theme: 'purple',
            darkMode: true,
            language: 'zh',
            machineIdConfig: { autoSwitchOnAccountChange: true, bindMachineIdToAccount: true, useBindedMachineId: false },
            currentMachineId: 'c'.repeat(64),
            originalMachineId: 'd'.repeat(64),
            originalBackupTime: 123456,
            accountMachineIds: { 'acc-1': '1'.repeat(64) },
            machineIdHistory: [{ id: 'h1', machineId: '1'.repeat(64), timestamp: 100, action: 'initial' }],
            proxyPool: {
                'px-1': { id: 'px-1', url: 'http://1.2.3.4:8080', protocol: 'http', host: '1.2.3.4', port: 8080, status: 'alive', usedCount: 5, failCount: 0, enabled: true, createdAt: 10, label: 'P1', source: 'manual' },
                'px-2': { id: 'px-2', url: 'socks5://user:pass@5.6.7.8:1080', protocol: 'socks5', host: '5.6.7.8', port: 1080, username: 'user', password: 'pass', status: 'untested', usedCount: 0, failCount: 2, enabled: true, createdAt: 20, source: 'import' }
            },
            proxyPoolConfig: { enabled: true, strategy: 'round_robin', validateOnStartup: false, autoDisableDead: true, failureThreshold: 3, testUrl: 'https://api.ipify.org?format=json', testTimeoutMs: 8000, autoValidateIntervalMin: 0, autoValidateConcurrency: 5, upstreamProxy: '' },
            proxyPoolCursor: 4,
            accountProxyBindings: { 'acc-1': 'px-1' }
        }

        loadAccountsReturnValue = fullDoc
        await useAccountsStore.getState().loadFromStorage()
        await useAccountsStore.getState().flushSaveImmediately()

        // flushSaveImmediately 只会在本次显式调用时真正落盘一次（loadFromStorage 内部触发的
        // setProxy 等 saveToStorage 调用全部还停留在防抖定时器上，被这次显式 flush 一并收编）
        assert.equal(savedDocs.length, 1, '一次 flushSaveImmediately 应只产生一次 saveAccounts 调用')
        const saved = savedDocs[0]

        // 26 个字段悉数写入（brief 描述的字段数），且与输入深度相等
        assert.deepEqual(saved.accounts, fullDoc.accounts)
        assert.deepEqual(saved.groups, fullDoc.groups)
        assert.deepEqual(saved.tags, fullDoc.tags)
        assert.equal(saved.activeAccountId, fullDoc.activeAccountId)
        assert.equal(saved.autoRefreshEnabled, fullDoc.autoRefreshEnabled)
        assert.equal(saved.autoRefreshInterval, fullDoc.autoRefreshInterval)
        assert.equal(saved.autoRefreshConcurrency, fullDoc.autoRefreshConcurrency)
        assert.equal(saved.statusCheckInterval, fullDoc.statusCheckInterval)
        assert.equal(saved.privacyMode, fullDoc.privacyMode)
        assert.equal(saved.usagePrecision, fullDoc.usagePrecision)
        assert.equal(saved.proxyEnabled, fullDoc.proxyEnabled)
        assert.equal(saved.proxyUrl, fullDoc.proxyUrl)
        assert.equal(saved.autoSwitchEnabled, fullDoc.autoSwitchEnabled)
        assert.equal(saved.autoSwitchThreshold, fullDoc.autoSwitchThreshold)
        assert.equal(saved.autoSwitchInterval, fullDoc.autoSwitchInterval)
        assert.equal(saved.switchTarget, fullDoc.switchTarget)
        assert.equal(saved.theme, fullDoc.theme) // 'purple' 原样透传，无白名单校验
        assert.equal(saved.darkMode, fullDoc.darkMode)
        assert.equal(saved.language, fullDoc.language)
        assert.deepEqual(saved.machineIdConfig, fullDoc.machineIdConfig)
        assert.deepEqual(saved.accountMachineIds, fullDoc.accountMachineIds)
        assert.deepEqual(saved.machineIdHistory, fullDoc.machineIdHistory)
        assert.deepEqual(saved.proxyPool, fullDoc.proxyPool)
        assert.deepEqual(saved.proxyPoolConfig, fullDoc.proxyPoolConfig)
        assert.equal(saved.proxyPoolCursor, fullDoc.proxyPoolCursor)
        assert.deepEqual(saved.accountProxyBindings, fullDoc.accountProxyBindings)

        // 基线：AccountData 接口里声明的 4 个字段（autoRefreshSyncInfo/currentMachineId/
        // originalMachineId/originalBackupTime）输入里都给了值，但 flushSaveImmediately 的
        // 落盘对象里完全没有这些 key —— 疑似 bug：autoRefreshSyncInfo 有专门的 setter
        // （setAutoRefreshSyncInfo）会调用 saveToStorage，但改动永远不会真正写入磁盘；
        // currentMachineId/originalMachineId/originalBackupTime 连 loadFromStorage 都不读取
        // data 里的值（照实锁定，不代表其正确性，留给 Pinia 迁移决定是否修）。
        assert.equal('autoRefreshSyncInfo' in saved, false, '疑似 bug：autoRefreshSyncInfo 从不写回磁盘')
        assert.equal('currentMachineId' in saved, false)
        assert.equal('originalMachineId' in saved, false)
        assert.equal('originalBackupTime' in saved, false)
        // 而 loadFromStorage 确实把 autoRefreshSyncInfo 读入了内存状态（只是不会存回）
        assert.equal(useAccountsStore.getState().autoRefreshSyncInfo, false)
        // currentMachineId/originalMachineId/originalBackupTime 在内存里也维持初始默认值，
        // 完全未被输入文档覆盖（loadFromStorage 里没有任何 data.currentMachineId 之类的读取）
        assert.equal(useAccountsStore.getState().currentMachineId, '')
        assert.equal(useAccountsStore.getState().originalMachineId, null)
        assert.equal(useAccountsStore.getState().originalBackupTime, null)

        // isActive 按 activeAccountId 重设：本例输入已一致，验证 loader 不会误改
        assert.equal(saved.accounts['acc-1'].isActive, true)
        assert.equal(saved.accounts['acc-2'].isActive, false)

        resetAll()

        // ---- 1b：最小文档 -> loader 默认值基线 ----
        // 只提供 AccountData 里的必填字段，其余全部省略，记录 loadFromStorage 补的每个默认值
        // （这些默认值最终也会被 flushSaveImmediately 原样写回磁盘）。
        const minimalDoc = {
            accounts: {},
            groups: {},
            tags: {},
            activeAccountId: null,
            autoRefreshEnabled: true, // 非 optional 字段，仍需提供
            autoRefreshInterval: 5,
            statusCheckInterval: 60
        }
        loadAccountsReturnValue = minimalDoc
        await useAccountsStore.getState().loadFromStorage()
        await useAccountsStore.getState().flushSaveImmediately()
        const savedMinimal = savedDocs[savedDocs.length - 1]

        // 基线：省略的可选字段由 loadFromStorage 补的默认值（源码 1709-1737 行）
        assert.equal(savedMinimal.autoRefreshConcurrency, 100)
        assert.equal(savedMinimal.privacyMode, false)
        assert.equal(savedMinimal.usagePrecision, false)
        assert.equal(savedMinimal.proxyEnabled, false)
        assert.equal(savedMinimal.proxyUrl, '')
        assert.equal(savedMinimal.autoSwitchEnabled, false)
        assert.equal(savedMinimal.autoSwitchThreshold, 0)
        assert.equal(savedMinimal.autoSwitchInterval, 5)
        assert.equal(savedMinimal.switchTarget, 'ide')
        assert.equal(savedMinimal.theme, 'default')
        assert.equal(savedMinimal.darkMode, false)
        assert.equal(savedMinimal.language, 'auto')
        assert.deepEqual(savedMinimal.machineIdConfig, {
            autoSwitchOnAccountChange: false,
            bindMachineIdToAccount: false,
            useBindedMachineId: true
        })
        assert.deepEqual(savedMinimal.accountMachineIds, {})
        assert.deepEqual(savedMinimal.machineIdHistory, [])
        assert.deepEqual(savedMinimal.proxyPool, {})
        assert.deepEqual(savedMinimal.proxyPoolConfig, {
            enabled: false,
            strategy: 'round_robin',
            validateOnStartup: false,
            autoDisableDead: true,
            failureThreshold: 3,
            testUrl: 'https://api.ipify.org?format=json',
            testTimeoutMs: 8000,
            autoValidateIntervalMin: 0,
            autoValidateConcurrency: 5,
            upstreamProxy: ''
        })
        assert.equal(savedMinimal.proxyPoolCursor, 0)
        assert.deepEqual(savedMinimal.accountProxyBindings, {})

        originalConsole.log('[accounts-store] 覆盖项 1（持久化往返）通过')
        resetAll()
    }

    // ============ 覆盖项 2：保存时序 ============
    {
        // ---- 2a：500ms 防抖窗口内连续调用只落盘一次 ----
        // SAVE_DEBOUNCE_MS=500，每次 saveToStorage() 都会 clearTimeout 重置防抖计时器；
        // 在窗口内连续调用 5 次，只有最后一次的 500ms 定时器会真正触发。
        const pending = []
        for (let i = 0; i < 5; i++) {
            pending.push(useAccountsStore.getState().saveToStorage())
            mock.timers.tick(100) // 每次间隔 100ms < 500ms 防抖窗口，持续 reset 计时器
        }
        assert.equal(savedDocs.length, 0, '防抖窗口内不应立即落盘')
        // 再往前推 500ms，让最后一次调用的防抖定时器触发
        mock.timers.tick(500)
        await Promise.all(pending)
        assert.equal(savedDocs.length, 1, '5 次连续调用应只触发 1 次 saveAccounts')

        resetAll()

        // ---- 2b：持续调用时 5s 上限内至少落盘一次 ----
        // SAVE_MAX_WAIT_MS=5000：即使每次都在防抖窗口内被新调用 reset，maxWaitTimer 只在
        // "当前没有 maxWaitTimer" 时才会新建（saveToStorage 源码：`if (!saveMaxWaitTimer)`），
        // 所以它不会被连续调用无限推迟，5s 后必定强制落盘一次。
        // 模拟持续调用：每 200ms 调一次 saveToStorage，共 26 次（5200ms），验证 5s 内已落盘。
        const pending2 = []
        for (let i = 0; i < 26; i++) {
            pending2.push(useAccountsStore.getState().saveToStorage())
            mock.timers.tick(200)
        }
        // 5200ms 内，maxWaitTimer 在首次调用后 5000ms（即第 25 个 200ms tick 前后）已到期强制落盘一次。
        assert.ok(savedDocs.length >= 1, '5s 上限内应至少落盘一次')
        // 停止继续产生新调用；再推进 500ms 让最后一次调用自己的防抖定时器也触发收尾落盘，
        // 否则 pending2 里最后几个调用的 Promise 会一直不 resolve（unsettled top-level await）。
        mock.timers.tick(500)
        await Promise.all(pending2)
        // 停止后不应再有新增的定时器悬挂：flushSaveImmediately 已清理 debounce/maxWait 两个计时器
        const countAfterBurst = savedDocs.length
        mock.timers.tick(10000)
        assert.equal(savedDocs.length, countAfterBurst, '停止调用后不应再有定时器触发新的落盘')

        originalConsole.log('[accounts-store] 覆盖项 2（保存时序）通过')
        resetAll()
    }

    // ============ 覆盖项 3：筛选、排序、统计 ============
    {
        // 构造 6 个账号，覆盖不同分组（g1/g2/无分组）、标签（t1/t2）、订阅类型、状态、用量、
        // 邮箱域名（x.com/y.com/z.com），通过 loadFromStorage 一次性灌入（比逐个 addAccount
        // 更省事，且不受 addAccount 自动生成 id/createdAt 的干扰）。
        const cred = { accessToken: '', csrfToken: '', region: 'us-east-1', expiresAt: 0 }
        const mkAccount = (over) => ({
            id: over.id,
            email: over.email,
            nickname: over.nickname,
            idp: over.idp,
            credentials: cred,
            subscription: { type: over.subType, daysRemaining: over.daysRemaining },
            usage: { current: 0, limit: 100, percentUsed: over.percentUsed, lastUpdated: 0 },
            groupId: over.groupId,
            tags: over.tags,
            status: over.status,
            lastError: over.lastError,
            isActive: over.id === 'acc-a',
            createdAt: over.createdAt,
            lastUsedAt: over.lastUsedAt
        })
        const accA = mkAccount({ id: 'acc-a', email: 'alice@x.com', nickname: 'Alice', idp: 'Google', subType: 'Free', percentUsed: 0.1, groupId: 'g1', tags: ['t1'], status: 'active', createdAt: 10, lastUsedAt: 100 })
        const accB = mkAccount({ id: 'acc-b', email: 'bob@y.com', nickname: 'Bob', idp: 'Github', subType: 'Pro', percentUsed: 0.5, groupId: 'g1', tags: ['t2'], status: 'error', lastError: 'AccountSuspendedException: banned', createdAt: 20, lastUsedAt: 200 })
        const accC = mkAccount({ id: 'acc-c', email: 'carol@x.com', nickname: 'Carol', idp: 'BuilderId', subType: 'Pro_Plus', percentUsed: 0.9, groupId: undefined, tags: ['t1', 't2'], status: 'expired', daysRemaining: 5, createdAt: 5, lastUsedAt: 50 })
        const accD = mkAccount({ id: 'acc-d', email: 'dave@z.com', nickname: 'Dave', idp: 'Google', subType: 'Enterprise', percentUsed: 0.3, groupId: 'g2', tags: [], status: 'refreshing', createdAt: 30, lastUsedAt: 300 })
        const accE = mkAccount({ id: 'acc-e', email: 'eve@y.com', nickname: undefined, idp: 'Github', subType: 'Free', percentUsed: 0.0, groupId: 'g2', tags: ['t2'], status: 'unknown', createdAt: 40, lastUsedAt: 400 })
        const accF = mkAccount({ id: 'acc-f', email: 'frank@z.com', nickname: 'Frank', idp: 'Google', subType: 'Teams', percentUsed: 0.7, groupId: undefined, tags: [], status: 'active', createdAt: 15, lastUsedAt: 150 })

        loadAccountsReturnValue = {
            accounts: { 'acc-a': accA, 'acc-b': accB, 'acc-c': accC, 'acc-d': accD, 'acc-e': accE, 'acc-f': accF },
            groups: {}, tags: {}, activeAccountId: 'acc-a',
            autoRefreshEnabled: true, autoRefreshInterval: 5, statusCheckInterval: 60
        }
        await useAccountsStore.getState().loadFromStorage()

        const st = () => useAccountsStore.getState()

        // ---- setFilter：分组 / 标签 / 搜索词 / 状态 各一例 ----
        st().setFilter({ groupIds: ['g1'] })
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id).sort(), ['acc-a', 'acc-b'])

        st().setFilter({ tagIds: ['t2'] })
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id).sort(), ['acc-b', 'acc-c', 'acc-e'])

        st().setFilter({ search: 'dave' }) // 搜索词命中 nickname（大小写不敏感）
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id), ['acc-d'])

        st().setFilter({ statuses: ['error'] })
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id), ['acc-b'])

        st().setFilter({ emailDomains: ['z.com'] })
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id).sort(), ['acc-d', 'acc-f'])

        st().setFilter({ bannedOnly: true })
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id), ['acc-b'])

        st().clearFilter()

        // ---- activeGroupTab：分组 Tab 与 filter 互斥叠加 ----
        st().setActiveGroupTab('ungrouped')
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id).sort(), ['acc-c', 'acc-f'])
        st().setActiveGroupTab('g2')
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id).sort(), ['acc-d', 'acc-e'])
        st().setActiveGroupTab('all')

        // ---- setSort：两个字段 × 升降序 ----
        st().setSort({ field: 'usage', order: 'asc' })
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id), ['acc-e', 'acc-a', 'acc-d', 'acc-b', 'acc-f', 'acc-c'])
        st().setSort({ field: 'usage', order: 'desc' })
        assert.deepEqual(st().getFilteredAccounts().map(a => a.id), ['acc-c', 'acc-f', 'acc-b', 'acc-d', 'acc-a', 'acc-e'])

        st().setSort({ field: 'email', order: 'asc' })
        assert.deepEqual(
            st().getFilteredAccounts().map(a => a.id),
            ['acc-a', 'acc-b', 'acc-c', 'acc-d', 'acc-e', 'acc-f'] // alice/bob/carol/dave/eve/frank 字母序
        )
        st().setSort({ field: 'email', order: 'desc' })
        assert.deepEqual(
            st().getFilteredAccounts().map(a => a.id),
            ['acc-f', 'acc-e', 'acc-d', 'acc-c', 'acc-b', 'acc-a']
        )

        // ---- getStats：各计数 ----
        const stats = st().getStats()
        assert.equal(stats.total, 6)
        assert.deepEqual(stats.byStatus, { active: 2, expired: 1, error: 1, refreshing: 1, unknown: 1 })
        assert.deepEqual(stats.bySubscription, { Free: 2, Pro: 1, Pro_Plus: 1, Enterprise: 1, Teams: 1 })
        assert.deepEqual(stats.byIdp, { Google: 3, Github: 2, BuilderId: 1, Enterprise: 0, AWSIdC: 0, Internal: 0, IAM_SSO: 0 })
        assert.equal(stats.activeCount, 1) // 仅 acc-a.isActive=true
        assert.equal(stats.expiringSoonCount, 1) // 仅 acc-c.daysRemaining=5 <= 7
        assert.equal(stats.bannedCount, 1) // 仅 acc-b 命中封禁特征

        originalConsole.log('[accounts-store] 覆盖项 3（筛选/排序/统计）通过')
        resetAll()
    }

    // ============ 覆盖项 4：导入导出 ============
    {
        const st = () => useAccountsStore.getState()
        const cred = (provider) => ({ accessToken: 'at', csrfToken: 'ct', region: 'us-east-1', expiresAt: 0, provider })

        // ---- 4a：exportAccounts() -> importFromExportData() 到清空后的 store ----
        const accX = {
            id: 'acc-x', email: 'x@d.com', userId: 'ux1', idp: 'Google', credentials: cred('Google'),
            subscription: { type: 'Pro' }, usage: { current: 1, limit: 10, percentUsed: 0.1, lastUpdated: 0 },
            tags: ['t1'], status: 'active', isActive: true, createdAt: 1, lastUsedAt: 1
        }
        const accY = {
            id: 'acc-y', email: 'y@d.com', idp: 'Github', credentials: cred('Github'),
            subscription: { type: 'Free' }, usage: { current: 0, limit: 10, percentUsed: 0, lastUpdated: 0 },
            tags: [], status: 'unknown', isActive: false, createdAt: 2, lastUsedAt: 2
        }
        loadAccountsReturnValue = {
            accounts: { 'acc-x': accX, 'acc-y': accY },
            groups: { 'g1': { id: 'g1', name: 'G1', order: 0, createdAt: 0 } },
            tags: { 't1': { id: 't1', name: 'T1', color: '#111' } },
            activeAccountId: 'acc-x',
            autoRefreshEnabled: true, autoRefreshInterval: 5, statusCheckInterval: 60
        }
        await st().loadFromStorage()

        const exported = st().exportAccounts()
        assert.equal(exported.accounts.length, 2)
        assert.equal(exported.groups.length, 1)
        assert.equal(exported.tags.length, 1)
        // exportAccounts 会剥离 isActive 字段（`({ isActive, ...rest }) => rest`）
        assert.equal('isActive' in exported.accounts.find(a => a.id === 'acc-x'), false)
        assert.equal(exported.version, st().appVersion)

        // 部分导出（按 id 筛选）
        const exportedPartial = st().exportAccounts(['acc-y'])
        assert.equal(exportedPartial.accounts.length, 1)
        assert.equal(exportedPartial.accounts[0].id, 'acc-y')

        // 清空 store（模拟"导入到清空后的 store"）
        loadAccountsReturnValue = { accounts: {}, groups: {}, tags: {}, activeAccountId: null, autoRefreshEnabled: true, autoRefreshInterval: 5, statusCheckInterval: 60 }
        await st().loadFromStorage()
        assert.equal(st().accounts.size, 0)

        const importResult = st().importFromExportData(exported)
        assert.equal(importResult.success, 2)
        assert.equal(importResult.failed, 0)
        assert.equal(st().accounts.size, 2)
        // 关键字段一致（email/idp/credentials/subscription/usage/tags/status）
        const restoredX = st().accounts.get('acc-x')
        assert.equal(restoredX.email, accX.email)
        assert.equal(restoredX.userId, accX.userId)
        assert.deepEqual(restoredX.credentials, accX.credentials)
        assert.deepEqual(restoredX.subscription, accX.subscription)
        assert.deepEqual(restoredX.usage, accX.usage)
        assert.deepEqual(restoredX.tags, accX.tags)
        assert.equal(restoredX.status, accX.status)
        // 导入后统一设为 isActive:false（importFromExportData 源码：`{ ...accountData, isActive: false }`）
        assert.equal(restoredX.isActive, false)

        // ---- 4b：importFromExportData 对重复账号的跳过计数 ----
        // 再次用同一份 exported 数据导入到已含这两个账号的 store：
        // acc-x 靠 userId 命中重复，acc-y 靠 email+provider 命中重复，两条都应被跳过
        const importAgain = st().importFromExportData(exported)
        assert.equal(importAgain.success, 0)
        assert.equal(importAgain.failed, 0)
        assert.equal(st().accounts.size, 2, '重复导入不应产生新账号')
        const skipEntry = importAgain.errors.find(e => e.id === 'skipped')
        assert.ok(skipEntry, '应记录一条 skipped 汇总错误')
        assert.equal(skipEntry.error, '跳过 2 个已存在的账号')

        resetAll()

        // ---- 4c：importAccounts（简化格式导入）对重复账号的实际行为 ----
        // 注意：源码走查显示 importAccounts（1137-1213 行）完全没有去重逻辑——每次调用都会
        // 用 uuidv4() 生成全新 id，对所有输入项一律 result.success++，即使 email 完全重复。
        // 去重只存在于 importFromExportData（isAccountExists，见 4b）。这与 brief 里
        // "importAccounts 对重复账号的跳过计数" 的描述不符：按实际代码锁定行为，不代表
        // brief 预期正确，留给 Pinia 迁移时确认是否需要补上去重。
        loadAccountsReturnValue = { accounts: {}, groups: {}, tags: {}, activeAccountId: null, autoRefreshEnabled: true, autoRefreshInterval: 5, statusCheckInterval: 60 }
        await st().loadFromStorage()

        const importItems = [
            { email: 'dup@d.com', refreshToken: 'rt-1' },
            { email: 'dup@d.com', refreshToken: 'rt-2' } // 同邮箱，模拟"重复"
        ]
        const r1 = st().importAccounts(importItems)
        assert.equal(r1.success, 2, '疑似与 brief 预期不符：importAccounts 对同邮箱重复项不跳过')
        assert.equal(r1.failed, 0)
        assert.equal(st().accounts.size, 2)

        const r2 = st().importAccounts(importItems) // 再导入一次同一批
        assert.equal(r2.success, 2, '再次导入同样全部成功，不会跳过已存在的邮箱')
        assert.equal(st().accounts.size, 4, '账号数翻倍，说明确实没有去重')

        originalConsole.log('[accounts-store] 覆盖项 4（导入导出）通过')
        resetAll()
    }

    // ============ 覆盖项 5：代理池 ============
    {
        const st = () => useAccountsStore.getState()

        // ---- 5a：importProxies 的 added/skipped/failed 计数 ----
        // 空行与 # 注释行在计数前就被过滤，不计入任何计数器
        const proxyText = [
            'http://a:1@1.1.1.1:8080',
            '2.2.2.2:9090',
            'http://a:1@1.1.1.1:8080', // 与第一行 protocol+user+host+port 相同 -> 视为重复
            'not-a-proxy-noport', // 无法解析
            '# a comment line',
            ''
        ].join('\n')
        const importResult = st().importProxies(proxyText)
        assert.deepEqual(importResult, { added: 2, skipped: 1, failed: 1 })
        assert.equal(st().proxyPool.size, 2)

        resetAll()

        // ---- 5b：各轮换策略下连续调用 pickNextProxy 的选取序列 ----
        // 每种策略都从一份全新的 3 条代理（usedCount 均为 0、延迟不同）重新加载，避免上一策略
        // 的副作用（usedCount 累加）污染下一策略的可预测性。
        const freshPool = () => ({
            p1: { id: 'p1', url: 'http://h1:1', protocol: 'http', host: 'h1', port: 1, status: 'alive', usedCount: 0, failCount: 0, enabled: true, createdAt: 1, latencyMs: 200 },
            p2: { id: 'p2', url: 'http://h2:1', protocol: 'http', host: 'h2', port: 1, status: 'alive', usedCount: 0, failCount: 0, enabled: true, createdAt: 1, latencyMs: 100 },
            p3: { id: 'p3', url: 'http://h3:1', protocol: 'http', host: 'h3', port: 1, status: 'alive', usedCount: 0, failCount: 0, enabled: true, createdAt: 1, latencyMs: 300 }
        })
        const loadWithStrategy = async (strategy) => {
            loadAccountsReturnValue = {
                accounts: {}, groups: {}, tags: {}, activeAccountId: null,
                autoRefreshEnabled: true, autoRefreshInterval: 5, statusCheckInterval: 60,
                proxyPool: freshPool(),
                proxyPoolConfig: { enabled: true, strategy, validateOnStartup: false, autoDisableDead: true, failureThreshold: 3, testUrl: 't', testTimeoutMs: 1000, autoValidateIntervalMin: 0, autoValidateConcurrency: 1 },
                proxyPoolCursor: 0
            }
            await st().loadFromStorage()
        }
        const pickSeq = (n) => Array.from({ length: n }, () => st().pickNextProxy()?.id)

        // round_robin：按插入顺序（p1,p2,p3）轮询，游标在 3 条代理间循环
        await loadWithStrategy('round_robin')
        assert.deepEqual(pickSeq(4), ['p1', 'p2', 'p3', 'p1'])

        // least_used：初始 usedCount 全为 0 时 reduce 保留首个（p1），每次挑中后计数 +1，
        // 下次自然轮到当前最小的那个——从零开始时序列恰好也是 p1,p2,p3,p1（reduce 平局不换）
        await loadWithStrategy('least_used')
        assert.deepEqual(pickSeq(4), ['p1', 'p2', 'p3', 'p1'])

        // fastest：按 latencyMs 升序，p2=100 最小且延迟不受挑选影响，始终选中同一个
        await loadWithStrategy('fastest')
        assert.deepEqual(pickSeq(3), ['p2', 'p2', 'p2'])

        // random：挑选依赖 Math.random()，临时替换为可控序列以得到确定性断言
        await loadWithStrategy('random')
        const originalRandom = Math.random
        const randomQueue = [0, 0.99, 0.4] // floor(x*3) => 0(p1), 2(p3), 1(p2)
        Math.random = () => randomQueue.shift()
        try {
            assert.deepEqual(pickSeq(3), ['p1', 'p3', 'p2'])
        } finally {
            Math.random = originalRandom
        }

        resetAll()

        // ---- 5c：reportProxyResult 失败后对选取的影响 ----
        // p1/p2 两条代理，failureThreshold=2；仅"代理连接层错误"（如 ECONNREFUSED）才计入
        // failCount 并可能触发自动停用；池中可用代理数 <=1 时保护性不停用（避免变直连）。
        loadAccountsReturnValue = {
            accounts: {}, groups: {}, tags: {}, activeAccountId: null,
            autoRefreshEnabled: true, autoRefreshInterval: 5, statusCheckInterval: 60,
            proxyPool: {
                p1: { id: 'p1', url: 'http://h1:1', protocol: 'http', host: 'h1', port: 1, status: 'alive', usedCount: 0, failCount: 0, enabled: true, createdAt: 1 },
                p2: { id: 'p2', url: 'http://h2:1', protocol: 'http', host: 'h2', port: 1, status: 'alive', usedCount: 0, failCount: 0, enabled: true, createdAt: 1 }
            },
            proxyPoolConfig: { enabled: true, strategy: 'round_robin', validateOnStartup: false, autoDisableDead: true, failureThreshold: 2, testUrl: 't', testTimeoutMs: 1000, autoValidateIntervalMin: 0, autoValidateConcurrency: 1 },
            proxyPoolCursor: 0
        }
        await st().loadFromStorage()

        st().reportProxyResult('p2', false, undefined, 'ECONNREFUSED')
        assert.equal(st().proxyPool.get('p2').failCount, 1)
        assert.equal(st().proxyPool.get('p2').enabled, true, '未达阈值前不停用')

        st().reportProxyResult('p2', false, undefined, 'ECONNREFUSED')
        assert.equal(st().proxyPool.get('p2').failCount, 2)
        assert.equal(st().proxyPool.get('p2').enabled, false, '达到阈值且池中还有其它可用代理时自动停用')
        assert.equal(st().proxyPool.get('p2').status, 'dead')

        // p2 已停用，round_robin 应只剩 p1 可选，无论游标如何都稳定选中它
        assert.deepEqual(pickSeq(3), ['p1', 'p1', 'p1'])

        // 保护性行为：p1 是池中唯一还可用的代理，即使它也连续失败达到阈值，也不应被自动停用
        // （否则代理池会被清空导致请求变直连、暴露真实 IP）
        st().reportProxyResult('p1', false, undefined, 'ECONNREFUSED')
        st().reportProxyResult('p1', false, undefined, 'ECONNREFUSED')
        assert.equal(st().proxyPool.get('p1').failCount, 2)
        assert.equal(st().proxyPool.get('p1').enabled, true, '仅剩 1 条可用代理时不自动停用（轮换代理保护）')

        // 非连接层错误（业务/风控失败）不计入 failCount，即使反复上报也不会触发停用
        st().reportProxyResult('p1', false, undefined, 'Portal error: email already registered')
        assert.equal(st().proxyPool.get('p1').failCount, 2, '业务失败不累加 failCount')

        originalConsole.log('[accounts-store] 覆盖项 5（代理池）通过')
        resetAll()
    }

    console.log = originalConsole.log
    originalConsole.log('renderer-accounts-store: all passed')
} finally {
    console.log = originalConsole.log
    console.warn = originalConsole.warn
    console.error = originalConsole.error
    mock.timers.reset()
    await rm(tempDir, { recursive: true, force: true })
}
