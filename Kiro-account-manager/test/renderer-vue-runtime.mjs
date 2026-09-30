import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// 离线合成运行环境：禁止读取账号目录，所有 IPC、通知、媒体查询和 fetch 都由桩提供。
const tempDir = await mkdtemp(join(tmpdir(), 'kam-vue-runtime-'))
const local = new Map()
const handlers = new Map()
const registrations = new Map()
const media = new Map()
const saved = []
const tray = []
const trayLanguages = []
const notifications = []
const closeResponses = []
const requests = []
const originalConsole = { log: console.log, warn: console.warn, error: console.error }
console.log = console.warn = console.error = () => {}
mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })

function subscribe(name, callback) {
    handlers.set(name, callback)
    registrations.set(name, (registrations.get(name) || 0) + 1)
    return () => {
        if (handlers.get(name) === callback) handlers.delete(name)
    }
}

function query(name) {
    if (!media.has(name)) {
        const target = new EventTarget()
        let listeners = 0
        media.set(name, {
            matches: false,
            addEventListener(type, callback) {
                listeners++
                target.addEventListener(type, callback)
            },
            removeEventListener(type, callback) {
                listeners--
                target.removeEventListener(type, callback)
            },
            change(value) {
                this.matches = value
                target.dispatchEvent(new Event('change'))
            },
            get listeners() {
                return listeners
            }
        })
    }
    return media.get(name)
}

function account(id, error) {
    return {
        id,
        email: `${id}@example.invalid`,
        idp: 'BuilderId',
        machineId: 'a'.repeat(64),
        credentials: {
            accessToken: 'synthetic',
            refreshToken: `synthetic-${id}`,
            region: 'us-east-1',
            expiresAt: 10 ** 12
        },
        subscription: { type: 'Free', title: 'Free' },
        usage: { current: 1, limit: 100, percentUsed: 0.01, lastUpdated: 0 },
        tags: [],
        status: 'active',
        createdAt: 0,
        lastUsedAt: 0,
        isActive: false,
        lastError: error
    }
}

let doc = {
    accounts: {},
    groups: {},
    tags: {},
    activeAccountId: null,
    autoRefreshEnabled: false,
    autoRefreshInterval: 5,
    statusCheckInterval: 60,
    theme: 'purple',
    darkMode: false,
    language: 'auto'
}
let load = async () => doc
let fetchResult = () => ({ ok: true, status: 200 })
globalThis.localStorage = {
    getItem: (key) => local.get(key) ?? null,
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: (key) => local.delete(key)
}
globalThis.document = { documentElement: { dataset: {} }, createElement: () => ({}) }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
globalThis.Notification = class {
    static permission = 'granted'
    static requestPermission = async () => 'granted'
    constructor(title, options) {
        notifications.push({ title, ...options })
    }
}
globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options })
    return fetchResult()
}
globalThis.window = Object.assign(new EventTarget(), {
    matchMedia: query,
    api: {
        getAppVersion: async () => '1.7.9',
        loadAccounts: () => load(),
        saveAccounts: async (data) => saved.push(structuredClone(data)),
        getProactiveRenewalEnabled: async () => ({ success: true, enabled: false }),
        getLocalActiveAccount: async () => ({ success: false }),
        loadKiroCredentials: async () => ({ success: false }),
        updateTrayAccountList: (list) => tray.push(list),
        updateTrayAccount: () => {},
        updateTrayLanguage: (language) => trayLanguages.push(language),
        backgroundBatchRefresh: async () => ({}),
        backgroundBatchCheck: async () => ({}),
        refreshAccountToken: async () => ({ success: false }),
        setProxy: async () => ({ success: true }),
        onKiroIdeTokenChanged: (callback) => subscribe('ide', callback),
        onProxyWebhookTrigger: (callback) => subscribe('webhook', callback),
        onTrayRefreshAccount: (callback) => subscribe('tray-refresh', callback),
        onTraySwitchAccount: (callback) => subscribe('tray-switch', callback),
        onBackgroundRefreshResult: (callback) => subscribe('refresh', callback),
        onBackgroundCheckResult: (callback) => subscribe('check', callback),
        onProxyAccountSuspended: (callback) => subscribe('suspended', callback),
        onProxyAccountUpdate: (callback) => subscribe('update', callback),
        onShowCloseConfirmDialog: (callback) => subscribe('close', callback),
        sendCloseConfirmResponse: (action, remember) => closeResponses.push({ action, remember }),
        window: {
            getPlatform: async () => 'win32',
            isMaximized: async () => false,
            onMaximizeChange: (callback) => subscribe('maximize', callback)
        }
    }
})

try {
    const outfile = join(tempDir, 'runtime.mjs')
    await build({
        entryPoints: [resolve('test/fixtures/vue-runtime.ts')],
        outfile,
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        logLevel: 'silent',
        alias: {
            '@shared': resolve('src/renderer-shared'),
            '@lingyzh/ui': resolve('node_modules/@lingyzh/ui/src/ui/locale.ts')
        },
        define: { 'process.env.NODE_ENV': '"production"' }
    })
    const runtime = await import(pathToFileURL(outfile).href)
    function createStores() {
        const pinia = runtime.createPinia()
        runtime.setActivePinia(pinia)
        return {
            pinia,
            accounts: runtime.useAccountsStore(pinia),
            settings: runtime.useSettingsStore(pinia),
            persistence: runtime.usePersistenceStore(pinia),
            app: runtime.useAppStore(pinia)
        }
    }
    async function settle() {
        for (let i = 0; i < 5; i++) await Promise.resolve()
        await runtime.nextTick()
    }

    // 任务历史只存完成项和最近 200 条；回调不入 JSON，取消仍调用注册者。
    {
        runtime.setActivePinia(runtime.createPinia())
        local.set(
            'kiro-task-history',
            JSON.stringify([{ id: 'interrupted', status: 'running', updatedAt: 0 }])
        )
        const tasks = runtime.useTaskStore()
        assert.equal(tasks.tasks.get('interrupted').status, 'cancelled')
        tasks.clearAll()
        let cancelled = 0
        const id = tasks.createTask({
            kind: 'other',
            title: 'synthetic',
            total: 10,
            onCancel: () => cancelled++
        })
        tasks.cancelTask(id)
        assert.equal(cancelled, 1)
        assert.equal(tasks.tasks.get(id).status, 'cancelled')
        assert.ok(!('onCancel' in JSON.parse(local.get('kiro-task-history'))[0]))
        for (let i = 0; i < 205; i++) {
            const id = tasks.createTask({ kind: 'other', title: String(i), total: 1 })
            tasks.completeTask(id)
        }
        tasks.createTask({ kind: 'other', title: 'still running', total: 10 })
        tasks.createTask({ kind: 'other', title: 'paused', total: 10, status: 'paused' })
        tasks.removeTask('missing')
        assert.equal(JSON.parse(local.get('kiro-task-history')).length, 200)
        assert.ok(
            JSON.parse(local.get('kiro-task-history')).every(
                (task) => !['running', 'paused'].includes(task.status)
            )
        )
        assert.equal(runtime.summarizeTasks(tasks.tasks).activeCount, 2)
        assert.equal(runtime.formatDuration(62000), '1m 2s')
    }

    // Webhook 读写、事件过滤、20/min 限速、1500ms 起指数重试；不会调用真实外部服务。
    {
        runtime.setActivePinia(runtime.createPinia())
        const webhooks = runtime.useWebhookStore()
        const id = webhooks.addWebhook({
            kind: 'custom',
            url: 'https://synthetic.invalid/hook',
            enabled: true,
            events: ['risk-warning'],
            label: 'offline'
        })
        webhooks.loadFromStorage()
        assert.equal(webhooks.webhooks.get(id).label, 'offline')
        const message = { title: 'test', message: 'synthetic', level: 'warn' }
        const before = requests.length
        await webhooks.triggerEvent('account-banned', message)
        assert.equal(requests.length, before)
        for (let i = 0; i < 25; i++) await webhooks.triggerEvent('risk-warning', message)
        assert.equal(requests.length - before, 20)
        webhooks.toggleWebhook(id)
        await webhooks.triggerEvent('risk-warning', message)
        assert.equal(requests.length - before, 20)
        webhooks.removeWebhook(id)
        webhooks.addWebhook({
            kind: 'custom',
            url: 'https://synthetic.invalid/retry',
            enabled: true,
            events: ['risk-warning']
        })
        let attempts = 0
        fetchResult = () => ({ ok: ++attempts > 1, status: attempts > 1 ? 200 : 503 })
        const pending = webhooks.triggerEvent('risk-warning', message)
        await settle()
        assert.equal(attempts, 1)
        mock.timers.tick(1499)
        await settle()
        assert.equal(attempts, 1)
        mock.timers.tick(1)
        await pending
        assert.equal(attempts, 2)
        fetchResult = () => ({ ok: true, status: 200 })
        local.delete('kiro-webhooks')
    }

    // 初始化幂等、合批/防抖、通知基线、真实 profileArn 事件契约、导航及完整释放。
    {
        local.delete('kiro-notified-banned-ids')
        doc = { ...doc, accounts: { old: account('old', 'account suspended') } }
        const stores = createStores()
        await Promise.all([stores.app.initialize(), stores.app.initialize()])
        assert.equal(handlers.size, 8)
        assert.ok([...registrations.values()].every((count) => count === 1))
        await settle()
        assert.equal(notifications.length, 0, '启动宽限期仅建立封禁基线')
        const refreshBatches = []
        const checkBatches = []
        const originalRefresh = stores.accounts.applyBackgroundRefreshResults
        const originalCheck = stores.accounts.applyBackgroundCheckResults
        stores.accounts.applyBackgroundRefreshResults = (items) => {
            refreshBatches.push(items)
            originalRefresh(items)
        }
        stores.accounts.applyBackgroundCheckResults = (items) => {
            checkBatches.push(items)
            originalCheck(items)
        }
        handlers.get('refresh')({ id: 'missing', success: false })
        handlers.get('refresh')({ id: 'missing-2', success: false })
        handlers.get('check')({ id: 'missing', success: false })
        mock.timers.tick(119)
        assert.equal(refreshBatches.length, 0)
        mock.timers.tick(1)
        assert.equal(refreshBatches[0].length, 2)
        assert.equal(checkBatches[0].length, 1)
        await settle()
        const trayBefore = tray.length
        stores.accounts.updateAccount('old', { nickname: 'latest' })
        await settle()
        mock.timers.tick(399)
        assert.equal(tray.length, trayBefore)
        mock.timers.tick(1)
        assert.equal(tray.length, trayBefore + 1)
        handlers.get('update')({ id: 'old', profileArn: 'synthetic-profile' })
        assert.equal(
            stores.accounts.accounts.get('old').credentials.profileArn,
            'synthetic-profile'
        )
        window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'proxyPool' }))
        assert.equal(stores.app.currentPage, 'proxyPool')
        stores.app.navigate('home')
        assert.deepEqual([...stores.app.visitedPages], ['home', 'proxyPool'])
        mock.timers.tick(8000)
        stores.accounts.accounts = new Map([
            ...stores.accounts.accounts,
            ['new', account('new', 'account suspended')]
        ])
        await settle()
        assert.equal(notifications.length, 1)
        stores.accounts.updateAccount('new', { nickname: 'same banned account' })
        await settle()
        assert.equal(notifications.length, 1, '同一封禁状态不重复通知')
        handlers.get('refresh')({ id: 'pending', success: false })
        await stores.app.dispose()
        assert.equal(refreshBatches.at(-1)[0].id, 'pending', '释放前处理剩余批次')
        assert.equal(handlers.size, 0)
        assert.equal(query('(prefers-color-scheme: dark)').listeners, 0)
        assert.equal(query('(prefers-reduced-motion: reduce)').listeners, 0)
        const beforeSaved = saved.length
        const beforeTray = tray.length
        window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'accounts' }))
        window.dispatchEvent(new Event('beforeunload'))
        mock.timers.tick(60000)
        await settle()
        assert.equal(stores.app.currentPage, 'home')
        assert.equal(saved.length, beforeSaved)
        assert.equal(tray.length, beforeTray)
    }

    // 初始化 Promise 晚于 dispose 返回：不恢复订阅、媒体监听、后台刷新或自动保存。
    {
        let release
        load = () =>
            new Promise((resolve) => {
                release = resolve
            })
        const stores = createStores()
        const pending = stores.app.initialize()
        await settle()
        await stores.app.dispose()
        const beforeSaved = saved.length
        release(doc)
        await pending
        mock.timers.tick(60000)
        await settle()
        assert.equal(handlers.size, 0)
        assert.equal(saved.length, beforeSaved)
        assert.equal(stores.accounts.accounts.size, 0)
        load = async () => doc
    }

    // 模式键只属于 Vue；旧主题保留，系统颜色与 reduced motion 响应并成对退订。
    {
        local.delete(runtime.THEME_MODE_KEY)
        const stores = createStores()
        stores.settings.darkMode = true
        const theme = runtime.useTheme()
        theme.initialize()
        assert.equal(theme.mode.value, 'dark')
        assert.equal(document.documentElement.dataset.theme, 'dark')
        theme.setMode('system')
        assert.equal(local.get(runtime.THEME_MODE_KEY), 'system')
        assert.equal(stores.settings.darkMode, false)
        query('(prefers-color-scheme: dark)').change(true)
        query('(prefers-reduced-motion: reduce)').change(true)
        assert.equal(stores.settings.darkMode, true)
        assert.equal(document.documentElement.dataset.reducedMotion, 'true')
        await stores.persistence.flushSaveImmediately()
        assert.ok(!('themeMode' in saved.at(-1)))
        assert.equal(saved.at(-1).darkMode, true)
        theme.dispose()
        assert.equal(query('(prefers-color-scheme: dark)').listeners, 0)
        local.delete(runtime.THEME_MODE_KEY)
    }

    // 中英与 auto、缺失 key 和参数替换；setLanguage 的托盘 IPC 不被 locale watcher 重复。
    {
        doc = { ...doc, accounts: {}, language: 'auto', theme: 'purple', darkMode: false }
        const stores = createStores()
        await stores.app.initialize()
        const translation = runtime.useTranslation()
        assert.equal(translation.actualLanguage.value, 'zh')
        assert.equal(translation.t('shell.taskCounts', { success: 2, failed: 1 }), '成功 2，失败 1')
        assert.equal(translation.t('missing.key'), 'missing.key')
        const before = trayLanguages.length
        stores.settings.setLanguage('en')
        assert.equal(translation.t('common.cancel'), 'Cancel')
        assert.equal(runtime.getLocale(), 'en')
        assert.equal(trayLanguages.length, before + 1)
        assert.equal(stores.settings.theme, 'purple')
        await stores.app.dispose()
    }

    // 窗口与关闭确认：晚返回不复活监听，遮罩/Esc/按钮重复关闭只回传一次。
    {
        const controls = runtime.useWindowControls()
        const pending = controls.initialize()
        controls.dispose()
        await pending
        assert.ok(!handlers.has('maximize'))
        const confirmation = runtime.useCloseConfirmation()
        confirmation.initialize()
        confirmation.initialize()
        handlers.get('close')()
        confirmation.rememberChoice.value = true
        confirmation.respond('minimize')
        confirmation.handleOpen(false)
        assert.deepEqual(closeResponses.at(-1), { action: 'minimize', remember: true })
        assert.equal(closeResponses.length, 1)
        handlers.get('close')()
        assert.equal(confirmation.rememberChoice.value, false)
        confirmation.handleOpen(false)
        assert.deepEqual(closeResponses.at(-1), { action: 'cancel', remember: false })
        confirmation.dispose()
        assert.equal(handlers.size, 0)
    }

    // 异步动作锁定自己的 Pinia：切换 activePinia 后，旧实例保存不能写入新实例状态。
    {
        const first = createStores()
        first.accounts.accounts = new Map([['first', account('first')]])
        const second = createStores()
        second.accounts.accounts = new Map([['second', account('second')]])
        await first.persistence.flushSaveImmediately()
        assert.deepEqual(Object.keys(saved.at(-1).accounts), ['first'])
        await second.persistence.flushSaveImmediately()
        assert.deepEqual(Object.keys(saved.at(-1).accounts), ['second'])
    }
    originalConsole.log('renderer-vue-runtime: 8 offline scenario groups passed')
} finally {
    Object.assign(console, originalConsole)
    mock.timers.reset()
    await rm(tempDir, { recursive: true, force: true })
}
