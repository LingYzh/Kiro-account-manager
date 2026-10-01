/* Offline Settings checks use synthetic data and the mounted Vue controls. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

const whitelist = [
    'kiro-register-config',
    'kiro-register-history',
    'kiro-register-templates',
    'kiro-register-ratelimit-enabled',
    'kiro-register-ratelimit-max',
    'kiro-register-autobackoff',
    'kiro-register-dailyquota-limit',
    'kiro-register-schedule-enabled',
    'kiro-register-schedule-time',
    'kiro-register-mixed-sources',
    'kiro-webhooks',
    'accounts_viewMode',
    'accounts_activeGroupTab',
    'systemLogs_displayLimit',
    'kiro-diagnose-moemail',
    'proxyLogs_timeRange',
    'proxyLogs_displayLimit'
]
let shortcut = 'Ctrl+K'
let usageApi = 'rest'
let kproxy = false
let renewal = false
let tray = {
    enabled: true,
    closeAction: 'ask',
    showNotifications: true,
    minimizeOnStart: false
}

const accountImport = {
    version: '1.7.9',
    exportedAt: 1700000000000,
    accounts: [
        {
            id: 'settings-imported-offline',
            email: 'settings-imported@example.invalid',
            nickname: 'Settings Imported',
            idp: 'Google',
            credentials: {
                accessToken: 'synthetic-import-access',
                refreshToken: 'synthetic-import-refresh',
                csrfToken: '',
                provider: 'Google',
                expiresAt: 1900000000000,
                region: 'us-east-1'
            },
            subscription: { type: 'Free', title: 'KIRO FREE' },
            usage: { current: 0, limit: 100, percentUsed: 0, lastUpdated: 1700000000000 },
            status: 'active',
            tags: [],
            createdAt: 1700000000000,
            lastUsedAt: 1700000000000
        }
    ],
    groups: [],
    tags: []
}
const legacyImport = {
    version: 1,
    type: 'kiro-account-manager-config',
    exportedAt: 1700000000000,
    proxyPool: {
        'preserved-legacy-id': {
            id: 'preserved-legacy-id',
            url: 'http://legacy-import.example.invalid:8080',
            protocol: 'http',
            host: 'legacy-import.example.invalid',
            port: 8080,
            status: 'untested',
            enabled: true,
            usedCount: 0,
            failCount: 0,
            createdAt: 1700000000000
        }
    },
    proxyPoolConfig: { enabled: true, strategy: 'random' },
    localStorage: {
        'kiro-register-ratelimit-max': '37',
        'kiro-register-templates': '[{"name":"Offline legacy template"}]',
        'unlisted-synthetic-key': 'must-not-write'
    }
}

async function mockSettings(name, args, scenario) {
    if (name === 'getShowWindowShortcut') {
        if (scenario === 'settings-load-fail') throw new Error('Synthetic shortcut load failure')
        return shortcut
    }
    if (name === 'setShowWindowShortcut') {
        if (scenario === 'settings-shortcut-fail')
            return { success: false, error: 'Synthetic shortcut registration failure' }
        shortcut = args[0]
        return { success: true }
    }
    if (name === 'getTraySettings') return { ...tray }
    if (name === 'saveTraySettings') {
        if (scenario === 'settings-tray-fail')
            return { success: false, error: 'Synthetic tray save failure' }
        tray = { ...tray, ...args[0] }
        return { success: true }
    }
    if (name === 'getUsageApiType') return usageApi
    if (name === 'setUsageApiType') {
        if (scenario === 'settings-usage-fail')
            return { success: false, type: usageApi, error: 'Synthetic usage API failure' }
        usageApi = args[0]
        return { success: true, type: usageApi }
    }
    if (name === 'getUseKProxyForApi') return kproxy
    if (name === 'setUseKProxyForApi') {
        if (scenario === 'settings-kproxy-fail')
            return { success: false, enabled: kproxy, error: 'Synthetic K-Proxy failure' }
        kproxy = args[0]
        return { success: true, enabled: kproxy }
    }
    if (name === 'setProactiveRenewalEnabled') {
        if (scenario === 'settings-renewal-fail')
            return { success: false, error: 'Synthetic renewal failure' }
        renewal = args[0]
        return { success: true, enabled: renewal }
    }
    if (name === 'setProxy') return { success: true, normalizedUrl: args[1] }
    if (name === 'importFromFile') {
        if (scenario === 'settings-import-account')
            return { format: 'json', content: JSON.stringify(accountImport) }
        if (scenario === 'settings-import-legacy')
            return { format: 'json', content: JSON.stringify(legacyImport) }
        if (scenario === 'settings-import-invalid-legacy')
            return { format: 'json', content: JSON.stringify({ type: 'other-config' }) }
        return null
    }
    if (name === 'exportToFile') return true
    return undefined
}

async function verifySettings(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario } = harness
    const suiteCallStart = report.calls.length
    const calls = (name) => report.calls.slice(suiteCallStart).filter((call) => call.name === name)
    const selector = '[data-testid="page-settings"]'
    const mockBefore = { shortcut, usageApi, kproxy, renewal, tray: { ...tray } }

    async function input(testid, value, event = 'input') {
        await run(`function () {
            const root = document.querySelector('[data-testid="${testid}"]')
            const control = root?.matches('input,select') ? root : root?.querySelector('input,select')
            if (!control) throw new Error('Missing Settings control: ${testid}')
            control.value = ${JSON.stringify(value)}
            control.dispatchEvent(new Event('${event}', { bubbles: true }))
        }`)
    }

    async function confirm(accept, expectNext = false) {
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog.ui-confirm[open]')) }`,
            'Settings confirmation'
        )
        await click(
            `dialog.ui-confirm[open] .ui-confirm-actions button:nth-child(${accept ? 2 : 1})`,
            accept ? 'accept Settings confirmation' : 'cancel Settings confirmation'
        )
        await waitFor(
            expectNext
                ? `function () { return document.querySelector('dialog.ui-confirm[open]')?.textContent.includes('再次确认') }`
                : `function () { return !document.querySelector('dialog.ui-confirm[open]') }`,
            expectNext ? 'second Settings confirmation' : 'Settings confirmation closed'
        )
    }

    async function settled(testid) {
        await waitFor(
            `function () { return !document.querySelector('[data-testid="${testid}"]')?.disabled }`,
            `${testid} settled`
        )
    }

    await run(`function () {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        const names = ['kam-settings', 'kam-autoSwitch', 'kam-accounts', 'kam-proxyPool', 'kam-app']
        if (names.some((name) => !pinia._s.has(name))) throw new Error('Missing Settings stores')
        const settings = pinia._s.get('kam-settings')
        const auto = pinia._s.get('kam-autoSwitch')
        const accounts = pinia._s.get('kam-accounts')
        const proxy = pinia._s.get('kam-proxyPool')
        const app = pinia._s.get('kam-app')
        window.__settingsFixture = {
            stores: { settings, auto, accounts, proxy, app },
            original: {
                settings: JSON.parse(JSON.stringify(settings.$state)),
                auto: JSON.parse(JSON.stringify(auto.$state)),
                accounts: new Map(accounts.accounts),
                groups: new Map(accounts.groups),
                tags: new Map(accounts.tags),
                activeAccountId: accounts.activeAccountId,
                proxyPool: new Map(proxy.proxyPool),
                proxyPoolConfig: JSON.parse(JSON.stringify(proxy.proxyPoolConfig)),
                accountProxyBindings: { ...proxy.accountProxyBindings },
                themeMode: app.themeMode,
                localStorage: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
                createObjectURL: URL.createObjectURL,
                revokeObjectURL: URL.revokeObjectURL,
                anchorClick: HTMLAnchorElement.prototype.click,
                refresh: accounts.checkAndRefreshExpiringTokens
            },
            exports: [],
            refreshCalls: 0
        }
    }`)

    try {
        await chooseMenu(0, 0)
        await chooseMenu(1, 1)
        setScenario('settings-load-fail')
        await click('#kam-navigation-tab-settings', 'Settings page')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-error"]')?.textContent.includes('Synthetic shortcut load failure') && !!document.querySelector('[data-testid="settings-retry-load"]') }`,
            'initial Settings load failure visible'
        )
        check(
            'Settings initial IPC load attempted',
            [
                'getTraySettings',
                'getShowWindowShortcut',
                'getUsageApiType',
                'getUseKProxyForApi'
            ].every((name) => calls(name).length >= 1)
        )
        setScenario('settings-normal')
        await click('[data-testid="settings-retry-load"]', 'retry Settings load')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-shortcut"]')?.value === 'Ctrl+K' && !document.querySelector('[data-testid="settings-retry-load"]') }`,
            'Settings retry loaded'
        )
        check('retry reloaded shortcut', calls('getShowWindowShortcut').length >= 2)
        await screenshot('phase3-settings-light-zh')

        await input('settings-language', 'en', 'change')
        await waitFor(
            `function () { return document.querySelector('${selector} h1')?.textContent === 'Settings' }`,
            'Settings English'
        )
        check('language updates tray', calls('tray-language').at(-1)?.args[0] === 'en')
        await input('settings-language', 'zh', 'change')
        await waitFor(
            `function () { return document.querySelector('${selector} h1')?.textContent === '设置' }`,
            'Settings Chinese'
        )

        await run(`function () {
            window.__settingsFixture.stores.settings.$patch({ theme: 'purple' })
        }`)
        await input('settings-theme', 'dark', 'change')
        await waitFor(
            `function () { return document.documentElement.dataset.theme === 'dark' }`,
            'Settings dark theme'
        )
        check(
            'Vue theme changes without replacing legacy theme',
            await run(`function () {
            const state = window.__settingsFixture.stores.settings
            return state.theme === 'purple' && state.darkMode === true && localStorage.getItem('kiro-vue-theme-mode') === 'dark'
        }`)
        )
        await screenshot('phase3-settings-dark-zh')
        await input('settings-theme', 'light', 'change')
        await click('[data-testid="settings-privacy"]', 'privacy mode')
        await click('[data-testid="settings-precision"]', 'usage precision')
        await input('settings-switch-target', 'both', 'change')
        await click('[data-testid="settings-private-login"]', 'private login')
        await click('[data-testid="settings-auto-refresh"]', 'automatic refresh')
        await waitFor(
            `function () { return Boolean(document.querySelector('[data-testid="settings-refresh-interval"]')) }`,
            'refresh options'
        )
        await input('settings-refresh-interval', '20', 'change')
        await input('settings-refresh-concurrency', '17')
        await click('[data-testid="settings-sync-info"]', 'sync account info')
        await input('settings-import-concurrency', '23')
        await click('[data-testid="settings-auto-switch"]', 'automatic account switching')
        await waitFor(
            `function () { return Boolean(document.querySelector('[data-testid="settings-switch-threshold"]')) }`,
            'auto switch options'
        )
        await input('settings-switch-threshold', '12')
        await input('settings-switch-interval', '15', 'change')
        await waitFor(
            `function () {
            const stores = window.__settingsFixture.stores
            return stores.settings.privacyMode && stores.settings.usagePrecision &&
                stores.settings.switchTarget === 'both' && stores.settings.loginPrivateMode &&
                stores.settings.autoRefreshEnabled && stores.settings.autoRefreshInterval === 20 &&
                stores.settings.autoRefreshConcurrency === 17 && stores.settings.autoRefreshSyncInfo === false &&
                stores.settings.batchImportConcurrency === 23 &&
                stores.auto.autoSwitchEnabled && stores.auto.autoSwitchThreshold === 12 &&
                stores.auto.autoSwitchInterval === 15
        }`,
            'Settings store options applied'
        )
        check('all store-backed Settings options applied', true)
        await new Promise((resolve) => setTimeout(resolve, 650))
        check(
            'Settings persisted original AccountData fields',
            calls('save-accounts').some((call) => {
                const data = call.args[0]
                return (
                    data?.theme === 'purple' &&
                    data?.darkMode === false &&
                    data?.privacyMode === true &&
                    data?.usagePrecision === true &&
                    data?.switchTarget === 'both' &&
                    data?.autoRefreshEnabled === true &&
                    data?.autoRefreshInterval === 20 &&
                    data?.autoRefreshConcurrency === 17 &&
                    data?.autoSwitchEnabled === true &&
                    data?.autoSwitchThreshold === 12 &&
                    data?.autoSwitchInterval === 15 &&
                    Object.keys(data?.accounts || {}).length === 6
                )
            })
        )

        setScenario('settings-renewal-fail')
        await click('[data-testid="settings-proactive-renewal"]', 'proactive renewal failure')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-error"]')?.textContent.includes('Synthetic renewal failure') }`,
            'renewal failure'
        )
        check(
            'failed proactive renewal remains disabled',
            await run(
                `function () { return !window.__settingsFixture.stores.settings.proactiveRenewalEnabled }`
            )
        )
        setScenario('settings-normal')
        await run(
            `function () { document.querySelector('[data-testid="settings-proactive-renewal"]').checked = false }`
        )
        await click('[data-testid="settings-proactive-renewal"]', 'enable proactive renewal')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-proactive-renewal"]')?.checked === true }`,
            'renewal enabled'
        )
        check('renewal sends boolean', calls('setProactiveRenewalEnabled').at(-1)?.args[0] === true)

        setScenario('settings-usage-fail')
        await input('settings-usage-api', 'cbor', 'change')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-error"]')?.textContent.includes('Synthetic usage API failure') }`,
            'usage API failure'
        )
        check(
            'usage API failure retains REST',
            await run(`async function () { return await window.api.getUsageApiType() === 'rest' }`)
        )
        setScenario('settings-normal')
        await input('settings-usage-api', 'rest', 'change')
        await input('settings-usage-api', 'cbor', 'change')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-usage-api"]').value === 'cbor' }`,
            'CBOR saved'
        )
        check('usage API sends cbor', calls('setUsageApiType').at(-1)?.args[0] === 'cbor')

        setScenario('settings-kproxy-fail')
        await click('[data-testid="settings-kproxy"]', 'K-Proxy failure')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-error"]')?.textContent.includes('Synthetic K-Proxy failure') }`,
            'K-Proxy failure'
        )
        setScenario('settings-normal')
        await run(
            `function () { document.querySelector('[data-testid="settings-kproxy"]').checked = false }`
        )
        await click('[data-testid="settings-kproxy"]', 'enable K-Proxy')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-kproxy"]')?.checked === true }`,
            'K-Proxy enabled'
        )
        check('K-Proxy sends boolean', calls('setUseKProxyForApi').at(-1)?.args[0] === true)

        setScenario('settings-tray-fail')
        await click('[data-testid="settings-tray-enabled"]', 'tray failure')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-error"]')?.textContent.includes('Synthetic tray save failure') }`,
            'tray failure'
        )
        setScenario('settings-normal')
        await run(
            `function () { document.querySelector('[data-testid="settings-tray-enabled"]').checked = true }`
        )
        await click('[data-testid="settings-tray-enabled"]', 'disable tray')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-tray-enabled"]')?.checked === false }`,
            'tray disabled'
        )
        check(
            'tray sends one changed field',
            JSON.stringify(calls('saveTraySettings').at(-1)?.args[0]) === '{"enabled":false}'
        )
        await click('[data-testid="settings-tray-enabled"]', 'enable tray')
        await waitFor(
            `function () { return Boolean(document.querySelector('[data-testid="settings-tray-close"]')) }`,
            'tray close action'
        )
        await input('settings-tray-close', 'minimize', 'change')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-tray-close"]')?.value === 'minimize' }`,
            'tray close action saved'
        )
        check(
            'tray close sends one changed field',
            JSON.stringify(calls('saveTraySettings').at(-1)?.args[0]) ===
                '{"closeAction":"minimize"}'
        )

        setScenario('settings-shortcut-fail')
        await run(`function () {
            const root = document.querySelector('[data-testid="settings-shortcut"]')
            const input = root?.matches('input') ? root : root?.querySelector('input')
            if (!input) throw new Error('Missing shortcut input')
            input.focus()
            input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
        }`)
        await waitFor(
            `function () {
                const root = document.querySelector('[data-testid="settings-shortcut"]')
                const input = root?.matches('input') ? root : root?.querySelector('input')
                return input && ['请按键...', 'Press keys...'].includes(input.value)
            }`,
            'shortcut recording focused'
        )
        await run(`function () {
            const root = document.querySelector('[data-testid="settings-shortcut"]')
            const input = root?.matches('input') ? root : root?.querySelector('input')
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }))
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
        }`)
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-shortcut-error"]')?.textContent.includes('Synthetic shortcut registration failure') }`,
            'shortcut failure'
        )
        check(
            'modifier alone ignored and shortcut ordered',
            calls('setShowWindowShortcut').at(-1)?.args[0] === 'Ctrl+Shift+P' &&
                calls('setShowWindowShortcut').length === 1
        )
        setScenario('settings-normal')
        await run(`function () {
            const root = document.querySelector('[data-testid="settings-shortcut"]')
            const input = root?.matches('input') ? root : root?.querySelector('input')
            input.focus()
            input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
        }`)
        await waitFor(
            `function () {
                const root = document.querySelector('[data-testid="settings-shortcut"]')
                const input = root?.matches('input') ? root : root?.querySelector('input')
                return input && ['请按键...', 'Press keys...'].includes(input.value)
            }`,
            'shortcut retry recording focused'
        )
        await run(`function () {
            const root = document.querySelector('[data-testid="settings-shortcut"]')
            const input = root?.matches('input') ? root : root?.querySelector('input')
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
        }`)
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-shortcut"]')?.value === 'Ctrl+Shift+P' }`,
            'shortcut saved'
        )
        await click('[data-testid="settings-shortcut-clear"]', 'clear shortcut')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-shortcut"]')?.value === '' }`,
            'shortcut cleared'
        )
        check(
            'clear shortcut sends empty string',
            calls('setShowWindowShortcut').at(-1)?.args[0] === ''
        )

        await run(`function () {
            const fixture = window.__settingsFixture
            fixture.stores.accounts.checkAndRefreshExpiringTokens = async () => {
                fixture.refreshCalls++
                await new Promise((resolve) => setTimeout(resolve, 180))
            }
        }`)
        await click('[data-testid="settings-refresh-now"]', 'manual refresh')
        await click('[data-testid="settings-refresh-now"]', 'duplicate manual refresh')
        await settled('settings-refresh-now')
        check(
            'manual refresh duplicate locked',
            await run(`function () { return window.__settingsFixture.refreshCalls === 1 }`)
        )

        await input('settings-proxy-url', 'http://proxy.settings.example.invalid:8123')
        await click('[data-testid="settings-proxy-save"]', 'save proxy URL')
        await waitFor(
            `function () { return window.__settingsFixture.stores.settings.proxyUrl === 'http://proxy.settings.example.invalid:8123' && document.querySelector('[data-testid="settings-proxy-save"]')?.disabled }`,
            'proxy saved'
        )
        check(
            'proxy URL saved through existing store',
            await run(
                `function () { return window.__settingsFixture.stores.settings.proxyUrl === 'http://proxy.settings.example.invalid:8123' }`
            )
        )
        await click('[data-testid="settings-proxy-enabled"]', 'enable proxy')
        await waitFor(
            `function () { return window.__settingsFixture.stores.settings.proxyEnabled }`,
            'proxy enabled'
        )

        await click('[data-testid="settings-export"]', 'open account export')
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog[open] [data-testid="account-export-dialog"]')) }`,
            'account export dialog'
        )
        check(
            'export receives all synthetic accounts',
            await run(
                `function () { return document.querySelector('dialog[open]:has([data-testid="account-export-dialog"]) .ui-dialog-header')?.textContent.includes('6') }`
            )
        )
        await click('dialog[open] .ui-dialog-footer button:first-child', 'close account export')
        await waitFor(
            `function () { return !document.querySelector('dialog[open] [data-testid="account-export-dialog"]') }`,
            'account export closed'
        )

        setScenario('settings-import-cancel')
        const beforeImport = calls('save-accounts').length
        const beforeImportIpc = calls('importFromFile').length
        await click('[data-testid="settings-import"]', 'cancel account import')
        for (
            let attempt = 0;
            attempt < 40 && calls('importFromFile').length === beforeImportIpc;
            attempt++
        ) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        await settled('settings-import')
        check(
            'account import cancel has no write',
            calls('importFromFile').length === beforeImportIpc + 1 &&
                calls('save-accounts').length === beforeImport
        )
        setScenario('settings-import-account')
        await click('[data-testid="settings-import"]', 'import synthetic account')
        await waitFor(
            `function () { return document.querySelector('[data-testid="settings-success"]')?.textContent.includes('1') }`,
            'account import result'
        )
        check(
            'account import adds synthetic account',
            await run(
                `function () { return window.__settingsFixture.stores.accounts.accounts.size === 7 }`
            )
        )

        await run(`function () {
            const fixture = window.__settingsFixture
            const proxy = fixture.stores.proxy
            proxy.$patch((state) => {
                state.proxyPool = new Map([['before-legacy', {
                    id: 'before-legacy', url: 'http://before.example.invalid:8080',
                    protocol: 'http', host: 'before.example.invalid', port: 8080,
                    status: 'untested', enabled: true, usedCount: 0, failCount: 0, createdAt: 1700000000000
                }]])
                state.accountProxyBindings = { 'synthetic-0': 'before-legacy' }
            })
            localStorage.setItem('kiro-register-ratelimit-max', '11')
            localStorage.setItem('kiro-register-templates', '[{"name":"Before"}]')
            localStorage.setItem('unlisted-synthetic-key', 'keep-original')
            fixture.exportBlob = null
            URL.createObjectURL = (blob) => { fixture.exportBlob = blob; return 'blob:offline-settings' }
            URL.revokeObjectURL = () => {}
            HTMLAnchorElement.prototype.click = function () {
                fixture.exports.push({ name: this.download, blob: fixture.exportBlob })
            }
        }`)
        await click('[data-testid="settings-config-export"]', 'export legacy configuration')
        await waitFor(
            `function () { return window.__settingsFixture.exports.length === 1 }`,
            'legacy export'
        )
        const exported = await run(`async function () {
            const item = window.__settingsFixture.exports[0]
            return { name: item.name, text: await item.blob.text() }
        }`)
        const legacy = JSON.parse(exported.text)
        check(
            'legacy export exact envelope and Map ID',
            exported.name.startsWith('kiro-config-') &&
                exported.name.endsWith('.json') &&
                legacy.version === 1 &&
                legacy.type === 'kiro-account-manager-config' &&
                typeof legacy.exportedAt === 'number' &&
                Object.keys(legacy.proxyPool).join(',') === 'before-legacy' &&
                legacy.proxyPool['before-legacy'].id === 'before-legacy' &&
                legacy.proxyPoolConfig &&
                legacy.localStorage['kiro-register-ratelimit-max'] === '11'
        )
        check(
            'legacy export excludes account tokens and unlisted storage',
            !exported.text.includes('synthetic-access-') &&
                !exported.text.includes('synthetic-refresh') &&
                !('accounts' in legacy) &&
                !('unlisted-synthetic-key' in legacy.localStorage) &&
                Object.keys(legacy.localStorage).every((key) => whitelist.includes(key))
        )

        setScenario('settings-import-invalid-legacy')
        await click('[data-testid="settings-config-import"]', 'reject wrong legacy config type')
        await waitFor(
            `function () { return document.querySelector('[data-testid="page-settings"]')?.textContent.includes('不是有效的配置文件') }`,
            'invalid legacy type visible'
        )
        await waitFor(
            `function () { return Boolean(document.querySelector('[data-testid="settings-config-import"]')) && document.querySelector('[data-testid="settings-config-import"]')?.disabled === false }`,
            'invalid legacy import settled'
        )
        check(
            'wrong legacy type keeps proxy ID',
            await run(
                `function () { return window.__settingsFixture.stores.proxy.proxyPool.has('before-legacy') }`
            )
        )
        setScenario('settings-import-legacy')
        await click('[data-testid="settings-config-import"]', 'open legacy import confirmation')
        await confirm(false)
        await settled('settings-config-import')
        check(
            'cancel legacy import keeps pool and storage',
            await run(`function () {
            return window.__settingsFixture.stores.proxy.proxyPool.has('before-legacy') &&
                localStorage.getItem('kiro-register-ratelimit-max') === '11'
        }`)
        )
        await click('[data-testid="settings-config-import"]', 'confirm legacy import')
        await confirm(true)
        await waitFor(
            `function () { return window.__settingsFixture.stores.proxy.proxyPool.has('preserved-legacy-id') }`,
            'legacy Map restored'
        )
        check(
            'legacy import preserves IDs, config and clears bindings',
            await run(`function () {
            const proxy = window.__settingsFixture.stores.proxy
            return proxy.proxyPool.size === 1 && proxy.proxyPool.has('preserved-legacy-id') &&
                proxy.proxyPoolConfig.strategy === 'random' &&
                Object.keys(proxy.accountProxyBindings).length === 0 &&
                localStorage.getItem('kiro-register-ratelimit-max') === '37' &&
                localStorage.getItem('unlisted-synthetic-key') === 'keep-original'
        }`)
        )

        const beforeClear = await run(
            `function () { return window.__settingsFixture.stores.accounts.accounts.size }`
        )
        await click('[data-testid="settings-clear"]', 'cancel first account clear')
        await confirm(false)
        await settled('settings-clear')
        check(
            'first clear cancellation preserves accounts',
            await run(
                `function () { return window.__settingsFixture.stores.accounts.accounts.size === ${beforeClear} }`
            )
        )
        await click('[data-testid="settings-clear"]', 'cancel second account clear')
        await confirm(true, true)
        await confirm(false)
        await settled('settings-clear')
        check(
            'second clear cancellation preserves accounts',
            await run(
                `function () { return window.__settingsFixture.stores.accounts.accounts.size === ${beforeClear} }`
            )
        )
        await click('[data-testid="settings-clear"]', 'confirm two account clear prompts')
        await confirm(true, true)
        await confirm(true)
        await waitFor(
            `function () { return window.__settingsFixture.stores.accounts.accounts.size === 0 }`,
            'accounts cleared'
        )
        check(
            'clear removes only accounts and keeps groups/tags',
            await run(`function () {
            const stores = window.__settingsFixture.stores
            return stores.accounts.accounts.size === 0 &&
                stores.accounts.groups.size === window.__settingsFixture.original.groups.size &&
                stores.accounts.tags.size === window.__settingsFixture.original.tags.size
        }`)
        )
        await new Promise((resolve) => setTimeout(resolve, 650))
        check(
            'clear persists zero accounts',
            calls('save-accounts').at(-1)?.args[0] &&
                Object.keys(calls('save-accounts').at(-1).args[0].accounts || {}).length === 0
        )
    } finally {
        setScenario('settings-normal')
        shortcut = mockBefore.shortcut
        usageApi = mockBefore.usageApi
        kproxy = mockBefore.kproxy
        renewal = mockBefore.renewal
        tray = mockBefore.tray
        await run(`function () {
            const fixture = window.__settingsFixture
            if (!fixture) return
            const { stores, original } = fixture
            stores.accounts.checkAndRefreshExpiringTokens = original.refresh
            stores.auto.stopAutoSwitch()
            stores.accounts.stopAutoTokenRefresh()
            stores.accounts.$patch((state) => {
                state.accounts = new Map(original.accounts)
                state.groups = new Map(original.groups)
                state.tags = new Map(original.tags)
                state.activeAccountId = original.activeAccountId
            })
            stores.proxy.$patch((state) => {
                state.proxyPool = new Map(original.proxyPool)
                state.proxyPoolConfig = original.proxyPoolConfig
                state.accountProxyBindings = original.accountProxyBindings
            })
            stores.settings.$patch(original.settings)
            stores.auto.$patch(original.auto)
            stores.app.setThemeMode(original.themeMode)
            if (original.auto.autoSwitchEnabled) stores.auto.startAutoSwitch()
            if (original.settings.autoRefreshEnabled) stores.accounts.startAutoTokenRefresh()
            for (const key of Object.keys(localStorage)) {
                if (!(key in original.localStorage)) localStorage.removeItem(key)
            }
            for (const [key, value] of Object.entries(original.localStorage)) localStorage.setItem(key, value)
            URL.createObjectURL = original.createObjectURL
            URL.revokeObjectURL = original.revokeObjectURL
            HTMLAnchorElement.prototype.click = original.anchorClick
            delete window.__settingsFixture
        }`)
        await click('#kam-navigation-tab-home', 'leave Settings page')
        await chooseMenu(0, 0)
        await chooseMenu(1, 1)
    }
}

module.exports = { mockSettings, verifySettings }
