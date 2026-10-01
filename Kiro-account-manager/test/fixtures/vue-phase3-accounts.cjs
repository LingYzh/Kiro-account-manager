/* Offline Accounts checks use synthetic records and restore renderer state afterward. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

const page = '[data-testid="page-accounts"]'
const syntheticId = 'accounts-synthetic-a'
const secondId = 'accounts-synthetic-b'

async function mockAccounts(name, args, scenario) {
    if (!scenario?.startsWith('accounts-')) return undefined
    if (name === 'importFromFile') {
        if (scenario === 'accounts-import-cancel') return null
        if (scenario === 'accounts-import-json')
            return {
                format: 'json',
                content: JSON.stringify({
                    version: '1.0',
                    groups: [],
                    tags: [],
                    accounts: [
                        {
                            id: 'accounts-imported-json',
                            email: 'json@example.invalid',
                            nickname: 'Synthetic JSON',
                            idp: 'BuilderId',
                            credentials: {
                                accessToken: 'synthetic-json',
                                refreshToken: 'synthetic-json-refresh',
                                authMethod: 'IdC'
                            },
                            subscription: { type: 'Free', title: 'KIRO FREE' },
                            usage: { current: 0, limit: 50, percentUsed: 0 },
                            tags: [],
                            status: 'active'
                        }
                    ]
                })
            }
        if (scenario === 'accounts-import-csv')
            return {
                format: 'csv',
                content:
                    'email,nickname,idp,refreshToken,clientId,clientSecret,region\n"csv@example.invalid","Comma, Name","Google","synthetic-csv-refresh",,,"us-east-1"'
            }
        if (scenario === 'accounts-import-txt')
            return { format: 'txt', content: 'txt@example.invalid,synthetic-txt-refresh\n' }
        return null
    }
    if (name === 'switchAccount') {
        if (scenario === 'accounts-switch-fail')
            return { success: false, error: 'Synthetic IDE failure' }
        return {
            success: true,
            refreshedCredentials: {
                accessToken: 'synthetic-refreshed-access',
                refreshToken: 'synthetic-refreshed-refresh',
                expiresIn: 3600
            }
        }
    }
    if (name === 'switchAccountCli')
        return scenario === 'accounts-cli-fail'
            ? { success: false, error: 'Synthetic CLI failure' }
            : { success: true }
    if (name === 'logoutAccount') return { success: true, deletedCount: 2 }
    if (name === 'proxyClearAccountSuspended')
        return scenario === 'accounts-clear-fail'
            ? { success: false, error: 'Synthetic clear failure' }
            : { success: true }
    if (name === 'accountGetSubscriptions') {
        if (scenario === 'accounts-subscription-fail')
            return { success: false, error: 'Synthetic subscription failure' }
        return {
            success: true,
            plans: [
                {
                    name: 'Pro',
                    qSubscriptionType: 'Q_SYNTHETIC_PRO',
                    description: {
                        title: 'Synthetic Pro',
                        billingInterval: 'monthly',
                        featureHeader: 'Synthetic features',
                        features: ['Offline feature']
                    },
                    pricing: { currency: 'USD', amount: 20 }
                }
            ]
        }
    }
    if (name === 'accountGetSubscriptionUrl')
        return scenario === 'accounts-link-fail'
            ? { success: false, error: 'Synthetic link failure' }
            : { success: true, url: 'https://example.invalid/synthetic-subscription' }
    if (name === 'openSubscriptionWindow') return { success: true }
    if (name === 'accountGetModels') return { success: true, models: [] }
    if (name === 'proxySetAccountProxy') return { success: true }
    return undefined
}

function seedAccounts() {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const accounts = pinia._s.get('kam-accounts')
    const settings = pinia._s.get('kam-settings')
    const pool = pinia._s.get('kam-proxyPool')
    const persistence = pinia._s.get('kam-persistence')
    if (!accounts || !settings || !pool || !persistence)
        throw new Error('Accounts stores unavailable')
    window.__accountsFixture = {
        accounts: new Map(accounts.accounts),
        groups: new Map(accounts.groups),
        tags: new Map(accounts.tags),
        selectedIds: new Set(accounts.selectedIds),
        filter: { ...accounts.filter },
        activeGroupTab: accounts.activeGroupTab,
        activeAccountId: accounts.activeAccountId,
        sort: { ...accounts.sort },
        proxyPool: new Map(pool.proxyPool),
        bindings: { ...pool.accountProxyBindings },
        privacyMode: settings.privacyMode,
        switchTarget: settings.switchTarget,
        viewStorage: localStorage.getItem('accounts_viewMode'),
        groupStorage: localStorage.getItem('accounts_activeGroupTab'),
        refresh: accounts.refreshAccountToken,
        check: accounts.checkAccountStatus,
        batchRefresh: accounts.batchRefreshTokens,
        batchCheck: accounts.batchCheckStatus,
        save: persistence.saveToStorage,
        clipboard: navigator.clipboard.writeText
    }
    window.__accountsFixture.operations = []
    accounts.refreshAccountToken = async (id) => {
        window.__accountsFixture.operations.push('token:' + id)
        return true
    }
    accounts.checkAccountStatus = async (id) => {
        window.__accountsFixture.operations.push('check:' + id)
    }
    accounts.batchRefreshTokens = async (ids) => {
        window.__accountsFixture.operations.push('batch-token:' + ids.join(','))
        return { success: ids.length, failed: 0, errors: [] }
    }
    accounts.batchCheckStatus = async (ids) => {
        window.__accountsFixture.operations.push('batch-check:' + ids.join(','))
        return { success: ids.length, failed: 0, errors: [] }
    }
    persistence.saveToStorage = async () => {
        window.__accountsFixture.operations.push('save')
    }
    navigator.clipboard.writeText = async (value) => {
        window.__accountsFixture.copied = value
    }
    const now = Date.now()
    function makeAccount(id, options = {}) {
        return {
            id,
            email: options.email || id + '@example.invalid',
            nickname: options.nickname || id,
            userId: 'user-' + id,
            idp: options.idp || 'BuilderId',
            credentials: {
                accessToken: 'synthetic-access-' + id,
                refreshToken: options.refreshToken === false ? '' : 'synthetic-refresh-' + id,
                clientId: options.clientId === false ? '' : 'synthetic-client-id',
                clientSecret: options.clientSecret === false ? '' : 'synthetic-client-secret',
                region: 'us-east-1',
                provider: options.provider || 'BuilderId',
                authMethod: options.authMethod || 'IdC',
                expiresAt: now + 86400000
            },
            subscription: {
                type: options.type || 'Free',
                title: options.title || 'KIRO FREE',
                daysRemaining: options.days ?? 30
            },
            usage: {
                current: options.used ?? 20,
                limit: options.limit ?? 100,
                percentUsed: options.percent ?? 0.2,
                bonuses: options.bonuses || []
            },
            status: options.status || 'active',
            lastError: options.lastError,
            groupId: options.groupId,
            tags: options.tags || [],
            profileArn: 'arn:aws:synthetic:' + id,
            machineId: 'synthetic-machine-' + id,
            isActive: Boolean(options.isActive),
            createdAt: now,
            lastUsedAt: now
        }
    }
    window.__accountsFixture.makeAccount = makeAccount
    const seeded = [
        makeAccount('accounts-synthetic-a', {
            groupId: 'accounts-group',
            tags: ['accounts-tag'],
            isActive: true,
            type: 'Pro',
            title: 'KIRO PRO',
            days: 4,
            percent: 1.2,
            used: 120,
            bonuses: [
                {
                    code: 'LONG',
                    name: 'Synthetic long bonus label that must remain visible in the card and list',
                    current: 5,
                    limit: 10
                }
            ]
        }),
        makeAccount('accounts-synthetic-b', {
            email: 'b@other.invalid',
            status: 'error',
            lastError: 'AccountSuspendedException: synthetic',
            tags: []
        }),
        makeAccount('accounts-synthetic-social', {
            authMethod: 'social',
            clientId: false,
            clientSecret: false,
            idp: 'Google'
        }),
        makeAccount('accounts-synthetic-incomplete', { clientId: false }),
        ...Array.from({ length: 18 }, (_, i) =>
            makeAccount('accounts-domain-' + i, {
                email: 'user@domain' + String(i).padStart(2, '0') + '.invalid'
            })
        )
    ]
    accounts.$patch((state) => {
        state.accounts = new Map(seeded.map((item) => [item.id, item]))
        state.groups = new Map([
            [
                'accounts-group',
                {
                    id: 'accounts-group',
                    name: 'Synthetic group',
                    description: 'Offline',
                    color: '#336699',
                    order: 0,
                    createdAt: now
                }
            ]
        ])
        state.tags = new Map([
            ['accounts-tag', { id: 'accounts-tag', name: 'Synthetic tag', color: '#80336699' }]
        ])
        state.activeAccountId = 'accounts-synthetic-a'
        state.selectedIds = new Set()
        state.activeGroupTab = 'all'
        state.filter = {}
        state.sort = { field: 'lastUsedAt', order: 'desc' }
    })
    pool.$patch((state) => {
        state.proxyPool = new Map([
            [
                'accounts-proxy-alive',
                {
                    id: 'accounts-proxy-alive',
                    host: '127.0.0.1',
                    port: 1080,
                    protocol: 'socks5',
                    enabled: true,
                    status: 'alive'
                }
            ],
            [
                'accounts-proxy-dead',
                {
                    id: 'accounts-proxy-dead',
                    host: '127.0.0.2',
                    port: 1080,
                    protocol: 'socks5',
                    enabled: true,
                    status: 'dead'
                }
            ],
            [
                'accounts-proxy-disabled',
                {
                    id: 'accounts-proxy-disabled',
                    host: '127.0.0.3',
                    port: 1080,
                    protocol: 'socks5',
                    enabled: false,
                    status: 'alive'
                }
            ]
        ])
        state.accountProxyBindings = {}
    })
    settings.$patch((state) => {
        state.privacyMode = false
        state.switchTarget = 'ide'
    })
}

function restoreAccounts() {
    const saved = window.__accountsFixture
    if (!saved) return
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const accounts = pinia._s.get('kam-accounts')
    const settings = pinia._s.get('kam-settings')
    const pool = pinia._s.get('kam-proxyPool')
    const persistence = pinia._s.get('kam-persistence')
    accounts.refreshAccountToken = saved.refresh
    accounts.checkAccountStatus = saved.check
    accounts.batchRefreshTokens = saved.batchRefresh
    accounts.batchCheckStatus = saved.batchCheck
    persistence.saveToStorage = saved.save
    navigator.clipboard.writeText = saved.clipboard
    accounts.$patch((state) => {
        state.accounts = new Map(saved.accounts)
        state.groups = new Map(saved.groups)
        state.tags = new Map(saved.tags)
        state.selectedIds = new Set(saved.selectedIds)
        state.filter = { ...saved.filter }
        state.activeGroupTab = saved.activeGroupTab
        state.activeAccountId = saved.activeAccountId
        state.sort = { ...saved.sort }
    })
    pool.$patch((state) => {
        state.proxyPool = new Map(saved.proxyPool)
        state.accountProxyBindings = { ...saved.bindings }
    })
    settings.$patch((state) => {
        state.privacyMode = saved.privacyMode
        state.switchTarget = saved.switchTarget
    })
    for (const [key, value] of [
        ['accounts_viewMode', saved.viewStorage],
        ['accounts_activeGroupTab', saved.groupStorage]
    ]) {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
    }
    delete window.__accountsFixture
}

async function verifyAccounts(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario } = harness
    const storeScript =
        "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')"

    async function navigateAccounts() {
        await click('#kam-navigation-tab-accounts', 'accounts page')
        await waitFor(
            `function () { return document.querySelector('${page}') && document.querySelector('#kam-navigation-panel-accounts')?.classList.contains('is-active') }`,
            'accounts active'
        )
    }
    async function resetFilter() {
        await run(
            `function () { const store = ${storeScript}; store.$patch((state) => { state.filter = {}; state.activeGroupTab = 'all'; state.selectedIds = new Set() }) }`
        )
    }
    async function input(selector, value) {
        await run(
            `function () { const root = document.querySelector(${JSON.stringify(selector)}); const node = root?.matches('input,select,textarea') ? root : root?.querySelector('input,select,textarea'); if (!node) throw new Error('Missing input: ${selector}'); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })) }`
        )
    }
    async function openFilter() {
        await click('[data-testid="toolbar-filter"]', 'accounts filter')
        await waitFor(
            "function () { const panel = document.querySelector('[data-testid=account-filter]'); return !!panel && !!panel.getClientRects().length }",
            'accounts filter open'
        )
    }
    async function answerConfirm(accepted) {
        await waitFor(
            "function () { return !!document.querySelector('dialog.ui-confirm[open]') }",
            'account confirmation open'
        )
        await run(
            `function () { const buttons = [...document.querySelectorAll('dialog.ui-confirm[open] .ui-confirm-actions button')]; if (buttons.length !== 2) throw new Error('Missing confirmation buttons'); buttons[${accepted ? 1 : 0}].click() }`
        )
        await waitFor(
            "function () { return !document.querySelector('dialog.ui-confirm[open]') }",
            'account confirmation closed'
        )
    }

    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    await run(seedAccounts.toString())
    try {
        await navigateAccounts()
        await run(
            "function () { const list = document.querySelector('[data-testid=account-collection]'); if (list) { list.scrollTop = 0; list.dispatchEvent(new Event('scroll')) } }"
        )
        await waitFor(
            `function () { return document.querySelector('[data-testid="account-item-${syntheticId}"]')?.textContent.includes('Synthetic long bonus label') }`,
            'synthetic account visible'
        )
        check(
            'Accounts grid renders synthetic records and long bonus',
            await run(
                `function () { const store = ${storeScript}; const item = document.querySelector('[data-testid="account-item-${syntheticId}"]'); return Boolean(item?.textContent.includes('Synthetic long bonus label') && document.querySelector('[data-testid="account-collection"]') && store.accounts.get('${syntheticId}').usage.bonuses[0].name.includes('Synthetic long bonus label')) }`
            )
        )
        await screenshot('phase3-accounts-grid-light-zh')

        await click('[data-testid="toolbar-list"]', 'accounts list')
        check(
            'List view persists and hides grid-only actions',
            await run(
                `function () { const item = document.querySelector('[data-testid="account-item-${syntheticId}"]'); return localStorage.getItem('accounts_viewMode') === 'list' && !!document.querySelector('[data-testid="account-list-add"]') && !item?.querySelector('[data-testid="account-token-${syntheticId}"]') }`
            )
        )
        await click(`[data-testid="account-refresh-${secondId}"]`, 'list account refresh')
        check(
            'List refresh checks token before status',
            await run(
                `function () { return window.__accountsFixture.operations.slice(-2).join('|') === 'token:${secondId}|check:${secondId}' }`
            )
        )
        await click('#kam-navigation-tab-home', 'hide accounts')
        await navigateAccounts()
        check(
            'List view survives hidden navigation and resize',
            await run(
                "function () { window.dispatchEvent(new Event('resize')); return localStorage.getItem('accounts_viewMode') === 'list' && !!document.querySelector('[data-testid=account-list-add]') }"
            )
        )
        await click('[data-testid="toolbar-grid"]', 'accounts grid')
        await run(
            "function () { const list = document.querySelector('[data-testid=account-collection]'); list.scrollTop = 0; list.dispatchEvent(new Event('scroll')) }"
        )
        await waitFor(
            `function () { return !!document.querySelector('[data-testid="account-select-${syntheticId}"]') }`,
            'grid selection settled'
        )
        await click(`[data-testid="account-select-${syntheticId}"]`, 'select first account')
        await click(`[data-testid="account-select-${secondId}"]`, 'select second account')
        check(
            'Account selection and toolbar count',
            await run(
                `function () { const store = ${storeScript}; return store.selectedIds.has('${syntheticId}') && store.selectedIds.has('${secondId}') && document.querySelector('[data-testid="toolbar-select-all"]')?.textContent.includes('2') }`
            )
        )

        await openFilter()
        check(
            'Domain filter initially shows top 16',
            await run(
                "function () { return document.querySelectorAll('[data-testid^=filter-domain-]').length === 16 && !!document.querySelector('[data-testid=filter-domains-expand]') }"
            )
        )
        await run(
            `function () { ${storeScript}.setFilter({ emailDomains: ['domain17.invalid'] }) }`
        )
        check(
            'Selected domain outside top 16 remains visible',
            await run(
                'function () { return !!document.querySelector(\'[data-testid="filter-domain-domain17.invalid"]\') }'
            )
        )
        await click('[data-testid="filter-domains-expand"]', 'expand domains')
        check(
            'Domain expansion shows all domains',
            await run(
                "function () { return document.querySelectorAll('[data-testid^=filter-domain-]').length >= 18 }"
            )
        )
        await resetFilter()
        await click('[data-testid="filter-subscription-Pro"]', 'filter subscription')
        await click('[data-testid="filter-status-active"]', 'filter status')
        await click('[data-testid="filter-idp-BuilderId"]', 'filter IDP')
        await click('[data-testid="filter-tag-accounts-tag"]', 'filter tag')
        await click('[data-testid="filter-banned"]', 'filter banned')
        check(
            'Each advanced filter merges prior fields',
            await run(
                `function () { const f = ${storeScript}.filter; return f.subscriptionTypes?.includes('Pro') && f.statuses?.includes('active') && f.idps?.includes('BuilderId') && f.tagIds?.includes('accounts-tag') && f.bannedOnly === true }`
            )
        )
        await input('[data-testid="filter-usage-min"]', '30')
        await input('[data-testid="filter-days-max"]', '7')
        check(
            'Usage and days ranges retain all other filters',
            await run(
                `function () { const f = ${storeScript}.filter; return f.usageMin === 0.3 && f.daysRemainingMax === 7 && f.bannedOnly === true }`
            )
        )
        await click('[data-testid="filter-clear"]', 'clear advanced filters')
        await input('[data-testid="toolbar-search"]', 'synthetic-a')
        check(
            'Search does not activate advanced clear button',
            await run(
                `function () { return ${storeScript}.filter.search === 'synthetic-a' && !document.querySelector('[data-testid="filter-clear"]') }`
            )
        )
        await resetFilter()
        await click(`[data-testid="account-select-${syntheticId}"]`, 'reselect first account')
        await click(`[data-testid="account-select-${secondId}"]`, 'reselect second account')

        await click('[data-testid="toolbar-groups"]', 'group menu')
        check(
            'Group menu exposes counts and move action',
            await run(
                "function () { return !!document.querySelector('[data-testid=toolbar-group-accounts-group]') && !!document.querySelector('[data-testid=toolbar-move-accounts-group]') }"
            )
        )
        await click('[data-testid="toolbar-manage-groups"]', 'group manager')
        await waitFor(
            "function () { return !!document.querySelector('dialog[open] [data-testid=group-dialog]') }",
            'group manager open'
        )
        await click('[data-testid="group-new"]', 'create group form')
        await input('dialog[open] [data-testid="group-new-name"]', '  New synthetic group  ')
        await click('[data-testid="group-cancel-create"]', 'cancel group create')
        check(
            'Group create cancellation leaves store unchanged',
            await run(`function () { return ${storeScript}.groups.size === 1 }`)
        )
        await click('[data-testid="group-new"]', 'create group form again')
        await input('dialog[open] [data-testid="group-new-name"]', '  New synthetic group  ')
        await click('[data-testid="group-create"]', 'create group')
        check(
            'Group name is trimmed',
            await run(
                `function () { return [...${storeScript}.groups.values()].some((group) => group.name === 'New synthetic group') }`
            )
        )
        await click('[data-testid="group-assign-accounts-group"]', 'assign group')
        await click(`[data-testid="group-add-account-${secondId}"]`, 'assign account to group')
        check(
            'Group assignment can continue in dialog',
            await run(
                `function () { return ${storeScript}.accounts.get('${secondId}').groupId === 'accounts-group' && !!document.querySelector('dialog[open] [data-testid="group-finish-assign"]') }`
            )
        )
        await click('[data-testid="group-finish-assign"]', 'finish group assignment')
        await click('[data-testid="group-close"]', 'close group manager')

        await click('[data-testid="toolbar-tags"]', 'tag menu')
        await click('[data-testid="toolbar-manage-tags"]', 'tag manager')
        await waitFor(
            "function () { return !!document.querySelector('dialog[open] [data-testid=tag-dialog]') }",
            'tag manager open'
        )
        await click('[data-testid="tag-new"]', 'new tag')
        await input('dialog[open] [data-testid="tag-new-name"]', '  New tag  ')
        await input('dialog[open] [data-testid="tag-new-alpha"]', '128')
        await click('[data-testid="tag-create"]', 'create tag')
        check(
            'Tag creation preserves ARGB alpha and trimmed name',
            await run(
                `function () { return [...${storeScript}.tags.values()].some((tag) => tag.name === 'New tag' && /^#80[0-9a-f]{6}$/i.test(tag.color)) }`
            )
        )
        await click('[data-testid="tag-assign-accounts-tag"]', 'assign tag')
        await click(`[data-testid="tag-add-account-${secondId}"]`, 'tag account')
        check(
            'Tag assignment remains open for repeated actions',
            await run(
                `function () { return ${storeScript}.accounts.get('${secondId}').tags.includes('accounts-tag') && !!document.querySelector('dialog[open] [data-testid="tag-finish-assign"]') }`
            )
        )
        await click('[data-testid="tag-finish-assign"]', 'finish tag assignment')
        await click('[data-testid="tag-close"]', 'close tag manager')
        await click('[data-testid="toolbar-tags"]', 'bulk tag menu')
        await click('[data-testid="toolbar-tag-accounts-tag"]', 'remove tag from all selected')
        check(
            'Bulk tag all-selected removes association',
            await run(
                `function () { const a = ${storeScript}.accounts; return !a.get('${syntheticId}').tags.includes('accounts-tag') && !a.get('${secondId}').tags.includes('accounts-tag') }`
            )
        )

        await click('[data-testid="toolbar-proxies"]', 'proxy menu')
        check(
            'Only enabled alive proxy can be bound',
            await run(
                "function () { return !!document.querySelector('[data-testid=toolbar-bind-accounts-proxy-alive]') && !document.querySelector('[data-testid=toolbar-bind-accounts-proxy-dead]') && !document.querySelector('[data-testid=toolbar-bind-accounts-proxy-disabled]') }"
            )
        )
        await click('[data-testid="toolbar-bind-accounts-proxy-alive"]', 'bind selected proxy')
        check(
            'Bulk proxy binding includes both selected accounts',
            await run(
                `function () { const b = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-proxyPool').accountProxyBindings; return b['${syntheticId}'] === 'accounts-proxy-alive' && b['${secondId}'] === 'accounts-proxy-alive' }`
            )
        )
        await click('[data-testid="toolbar-privacy"]', 'privacy mode')
        check(
            'Privacy mode masks account identity',
            await run(
                `function () { const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; return pinia._s.get('kam-settings').privacyMode && !document.querySelector('[data-testid="account-item-${syntheticId}"]')?.textContent.includes('${syntheticId}@example.invalid') }`
            )
        )
        await click('[data-testid="toolbar-privacy"]', 'restore privacy mode')
        await screenshot('phase3-accounts-grid-selected-light-zh')

        await click('[data-testid="toolbar-refresh"]', 'batch token refresh')
        await click('[data-testid="toolbar-check"]', 'batch status check')
        check(
            'Batch operations receive selected IDs',
            await run(
                `function () { const ops = window.__accountsFixture.operations; return ops.some((item) => item.includes('batch-token:${syntheticId}')) && ops.some((item) => item.includes('batch-check:${syntheticId}')) }`
            )
        )
        await click('[data-testid="toolbar-clear-selection"]', 'clear selection')
        check(
            'No-selection batch controls are disabled',
            await run(
                "function () { return ['toolbar-refresh', 'toolbar-check', 'toolbar-delete'].every((key) => document.querySelector('[data-testid=' + key + ']')?.disabled) }"
            )
        )

        setScenario('accounts-import-cancel')
        const beforeCancel = report.calls.length
        await click('[data-testid="toolbar-import"]', 'cancel account import')
        check(
            'Canceled import does not change accounts',
            await run(`function () { return ${storeScript}.accounts.size === 22 }`)
        )
        check(
            'Import cancel calls file dialog once',
            report.calls.slice(beforeCancel).filter((call) => call.name === 'importFromFile')
                .length === 1
        )
        for (const [scenario, email] of [
            ['accounts-import-json', 'json@example.invalid'],
            ['accounts-import-csv', 'csv@example.invalid'],
            ['accounts-import-txt', 'txt@example.invalid']
        ]) {
            setScenario(scenario)
            if (scenario === 'accounts-import-csv')
                await run(`function () { ${storeScript}.setActiveGroupTab('accounts-group') }`)
            await click('[data-testid="toolbar-import"]', scenario)
            await waitFor(
                `function () { return [...${storeScript}.accounts.values()].some((account) => account.email === '${email}') }`,
                scenario + ' imported'
            )
        }
        check(
            'JSON, escaped CSV, and text imports preserve synthetic accounts',
            await run(
                `function () { const store = ${storeScript}; return store.accounts.size >= 25 && store.accounts.has('${syntheticId}') && [...store.accounts.values()].some((account) => account.nickname === 'Comma, Name') }`
            )
        )
        check(
            'CSV import captures active group and quoted nickname',
            await run(
                `function () { const item = [...${storeScript}.accounts.values()].find((account) => account.email === 'csv@example.invalid'); return item?.groupId === 'accounts-group' && item.nickname === 'Comma, Name' }`
            )
        )
        await run(`function () { ${storeScript}.setActiveGroupTab('all') }`)
        setScenario('accounts-import-json')
        await click('[data-testid="toolbar-import"]', 'duplicate JSON import')
        check(
            'Duplicate JSON import leaves existing accounts intact',
            await run(`function () { return ${storeScript}.accounts.size === 25 }`)
        )

        setScenario('accounts-normal')
        const beforeIncomplete = report.calls.length
        await click(
            '[data-testid="account-switch-accounts-synthetic-incomplete"]',
            'reject incomplete IdC switch'
        )
        check(
            'Incomplete IdC credentials never reach switch IPC',
            !report.calls
                .slice(beforeIncomplete)
                .some((call) => call.name === 'switchAccount' || call.name === 'switchAccountCli')
        )
        check(
            'Incomplete credential error is visible',
            await run(
                "function () { return !!document.querySelector('[data-testid=account-action-error]') }"
            )
        )
        await click(
            '[data-testid="account-switch-accounts-synthetic-social"]',
            'switch social account'
        )
        await waitFor(
            `function () { return ${storeScript}.activeAccountId === 'accounts-synthetic-social' }`,
            'social switch complete'
        )
        const socialCall = report.calls.filter((call) => call.name === 'switchAccount').at(-1)
        check(
            'Social switch accepts missing client keys and retains account context',
            socialCall?.args[0]?.authMethod === 'social' &&
                socialCall.args[0].clientId === '' &&
                socialCall.args[0].accountId === 'accounts-synthetic-social'
        )
        check(
            'IDE refresh persists returned credentials',
            await run(
                `function () { return ${storeScript}.accounts.get('accounts-synthetic-social').credentials.accessToken === 'synthetic-refreshed-access' }`
            )
        )

        await run(
            `function () { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-settings').$patch((state) => { state.switchTarget = 'both' }) }`
        )
        setScenario('accounts-cli-fail')
        const beforeBoth = report.calls.length
        await click(`[data-testid="account-switch-${secondId}"]`, 'switch both targets')
        await waitFor(
            `function () { return ${storeScript}.activeAccountId === '${secondId}' }`,
            'both target switch complete'
        )
        const bothCalls = report.calls
            .slice(beforeBoth)
            .filter((call) => call.name === 'switchAccount' || call.name === 'switchAccountCli')
        check(
            'Both target sends exact IDE then CLI payloads',
            bothCalls.length === 2 &&
                bothCalls[0].name === 'switchAccount' &&
                bothCalls[1].name === 'switchAccountCli' &&
                bothCalls[0].args[0].accountId === secondId &&
                bothCalls[1].args[0].profileArn === 'arn:aws:synthetic:' + secondId
        )
        check(
            'Both target preserves original CLI-failure success quirk',
            await run(`function () { return ${storeScript}.activeAccountId === '${secondId}' }`)
        )
        await run(
            `function () { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-settings').$patch((state) => { state.switchTarget = 'cli' }) }`
        )
        const beforeCli = report.calls.length
        await click('[data-testid="account-switch-accounts-synthetic-social"]', 'CLI-only failure')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=account-action-error]') }",
            'CLI error visible'
        )
        check(
            'CLI-only switch reports failure and keeps active account',
            !report.calls.slice(beforeCli).some((call) => call.name === 'switchAccount') &&
                report.calls.slice(beforeCli).some((call) => call.name === 'switchAccountCli') &&
                (await run(
                    `function () { return ${storeScript}.activeAccountId === '${secondId}' }`
                ))
        )
        await run(
            `function () { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-settings').$patch((state) => { state.switchTarget = 'ide' }) }`
        )
        await click(`[data-testid="account-email-${syntheticId}"]`, 'copy synthetic email')
        check(
            'Email copy uses synthetic address',
            await run(
                "function () { return window.__accountsFixture.copied === 'accounts-synthetic-a@example.invalid' }"
            )
        )
        await click(
            `[data-testid="account-credentials-${syntheticId}"]`,
            'copy synthetic credentials'
        )
        check(
            'Credentials copy contains only expected fields',
            await run(
                "function () { const value = JSON.parse(window.__accountsFixture.copied); return Object.keys(value).sort().join(',') === 'accessToken,clientId,clientSecret,refreshToken' && value.refreshToken === 'synthetic-refresh-accounts-synthetic-a' }"
            )
        )
        await click(`[data-testid="account-refresh-${syntheticId}"]`, 'grid account status refresh')
        check(
            'Grid refresh checks status without token',
            await run(
                `function () { return window.__accountsFixture.operations.at(-1) === 'check:${syntheticId}' }`
            )
        )
        await click(`[data-testid="account-token-${syntheticId}"]`, 'grid token refresh')
        check(
            'Dedicated token action refreshes token',
            await run(
                `function () { return window.__accountsFixture.operations.at(-1) === 'token:${syntheticId}' }`
            )
        )
        await click(`[data-testid="account-ban-${secondId}"]`, 'open banned detail')
        await waitFor(
            "function () { return !!document.querySelector('dialog[open] [data-testid=account-ban-reset]') }",
            'banned dialog open'
        )
        await click('dialog[open] [data-testid="account-ban-reset"]', 'clear synthetic suspension')
        await waitFor(
            `function () { return ${storeScript}.accounts.get('${secondId}').status === 'active' }`,
            'suspension cleared'
        )
        check(
            'Suspension reset uses account ID',
            report.calls.some(
                (call) => call.name === 'proxyClearAccountSuspended' && call.args[0] === secondId
            )
        )

        setScenario('accounts-subscription-fail')
        await click(
            '[data-testid="account-subscription-accounts-synthetic-incomplete"]',
            'open account subscription'
        )
        await waitFor(
            "function () { return !!document.querySelector('dialog[open] [data-testid=account-subscription-error]') }",
            'subscription failure visible'
        )
        setScenario('accounts-normal')
        await click(
            'dialog[open] [data-testid="account-subscription-retry"]',
            'retry subscriptions'
        )
        await waitFor(
            "function () { return !!document.querySelector('dialog[open] [data-testid=account-plan-Q_SYNTHETIC_PRO]') }",
            'synthetic plan visible'
        )
        const subscriptionCall = report.calls
            .filter((call) => call.name === 'accountGetSubscriptions')
            .at(-1)
        check(
            'Subscription request retains full account context',
            subscriptionCall?.args[0] === 'synthetic-access-accounts-synthetic-incomplete' &&
                subscriptionCall.args.at(-1) === 'accounts-synthetic-incomplete' &&
                subscriptionCall.args[1] === 'us-east-1'
        )
        setScenario('accounts-link-fail')
        await click(
            'dialog[open] [data-testid="account-plan-Q_SYNTHETIC_PRO"]',
            'failed subscription link'
        )
        await waitFor(
            "function () { return !!document.querySelector('dialog[open] [data-testid=account-subscription-error]') }",
            'subscription link failure visible'
        )
        setScenario('accounts-normal')
        await click(
            'dialog[open] [data-testid="account-plan-Q_SYNTHETIC_PRO"]',
            'copy subscription link'
        )
        await waitFor(
            "function () { return window.__accountsFixture.copied === 'https://example.invalid/synthetic-subscription' }",
            'subscription link copied'
        )
        await waitFor(
            "function () { return !document.querySelector('dialog[open][data-testid=account-subscription-dialog]') }",
            'subscription window opened after delay',
            3000
        )
        check(
            'Plan link opens after copy delay with synthetic URL',
            report.calls.some(
                (call) =>
                    call.name === 'openSubscriptionWindow' &&
                    call.args[0] === 'https://example.invalid/synthetic-subscription'
            )
        )
        await click(`[data-testid="account-subscription-${syntheticId}"]`, 'open paid subscription')
        await waitFor(
            "function () { return !!document.querySelector('dialog[open] [data-testid=account-subscription-manage]') }",
            'paid subscription management visible'
        )
        await click(
            'dialog[open] [data-testid="account-subscription-manage"]',
            'manage current subscription'
        )
        await waitFor(
            "function () { return !document.querySelector('dialog[open][data-testid=account-subscription-dialog]') }",
            'management link opened'
        )
        check(
            'Manage subscription requests URL without plan selection',
            report.calls.some(
                (call) =>
                    call.name === 'accountGetSubscriptionUrl' &&
                    call.args[1] === undefined &&
                    call.args.at(-1) === syntheticId
            )
        )

        await click(`[data-testid="account-detail-${syntheticId}"]`, 'open account details')
        await waitFor(
            "function () { return !!document.querySelector('dialog[open] [data-testid=account-detail-dialog]') }",
            'account details open'
        )
        await click('dialog[open] [data-testid="account-detail-close"]', 'close account details')

        const beforeLogout = report.calls.length
        await click(`[data-testid="account-logout-${secondId}"]`, 'cancel logout')
        await answerConfirm(false)
        check(
            'Cancel logout preserves active account without IPC',
            (await run(
                `function () { return ${storeScript}.activeAccountId === '${secondId}' }`
            )) && !report.calls.slice(beforeLogout).some((call) => call.name === 'logoutAccount')
        )
        await click(`[data-testid="account-logout-${secondId}"]`, 'confirm logout')
        await answerConfirm(true)
        await waitFor(
            `function () { return ${storeScript}.activeAccountId === null }`,
            'logout cleared current account'
        )
        check(
            'Confirmed logout calls synthetic IPC once',
            report.calls.slice(beforeLogout).filter((call) => call.name === 'logoutAccount')
                .length === 1
        )

        await input('[data-testid="toolbar-search"]', 'json@example.invalid')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=account-delete-accounts-imported-json]') }",
            'imported account filtered'
        )
        await click(
            '[data-testid="account-delete-accounts-imported-json"]',
            'cancel account delete'
        )
        await answerConfirm(false)
        check(
            'Cancel deletion keeps imported account',
            await run(
                `function () { return ${storeScript}.accounts.has('accounts-imported-json') }`
            )
        )
        await click(
            '[data-testid="account-delete-accounts-imported-json"]',
            'confirm account delete'
        )
        await answerConfirm(true)
        await waitFor(
            `function () { return !${storeScript}.accounts.has('accounts-imported-json') }`,
            'imported account deleted'
        )
        await resetFilter()

        await click('[data-testid="toolbar-grid"]', 'grid before stress')
        await run(
            `function () { const store = ${storeScript}; const make = window.__accountsFixture.makeAccount; store.$patch((state) => { state.accounts = new Map(Array.from({ length: 1000 }, (_, i) => { const account = make('accounts-stress-' + i); return [account.id, account] })); state.filter = {}; state.selectedIds = new Set() }) }`
        )
        await waitFor(
            "function () { return document.querySelector('[data-testid=account-toolbar]')?.textContent.includes('1000') }",
            'thousand account stats'
        )
        check(
            'Virtual collection renders a bounded account subset',
            await run(
                "function () { const collection = document.querySelector('[data-testid=account-collection]'); return collection && collection.querySelectorAll('[data-testid^=account-item-]').length < 100 && collection.querySelectorAll('[data-testid^=account-item-]').length > 0 }"
            )
        )
        await click('#kam-navigation-tab-home', 'hide stress list')
        await navigateAccounts()
        check(
            'Virtualizer remains bounded after hidden navigation',
            await run(
                "function () { return document.querySelector('[data-testid=account-collection]')?.querySelectorAll('[data-testid^=account-item-]').length < 100 }"
            )
        )

        await chooseMenu(0, 1)
        await chooseMenu(1, 2)
        await screenshot('phase3-accounts-dark-en')
    } finally {
        setScenario('update-available')
        await run(restoreAccounts.toString())
        await click('#kam-navigation-tab-home', 'leave accounts after restore')
    }
}

module.exports = { mockAccounts, verifyAccounts }
