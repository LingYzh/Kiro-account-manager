/* Offline Edit/Detail checks drive actual Vue dialogs with synthetic accounts only. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

const verifiedUsage = {
    current: 135.5,
    limit: 100,
    baseCurrent: 70,
    baseLimit: 80,
    freeTrialCurrent: 15,
    freeTrialLimit: 20,
    freeTrialExpiry: '2027-01-15T00:00:00Z',
    bonuses: [
        {
            code: 'OFFLINE',
            name: 'Offline bonus',
            current: 5,
            limit: 10,
            expiresAt: '2027-03-01T00:00:00Z'
        }
    ],
    nextResetDate: '2027-02-01T00:00:00Z'
}
const models = (accountId) => [
    {
        id: `offline-model-${accountId}`,
        name: 'Offline Model',
        description: 'Synthetic model for offline verification',
        inputTypes: ['TEXT', 'IMAGE'],
        maxInputTokens: 200000,
        maxOutputTokens: 4000,
        rateMultiplier: 1.5
    }
]

async function mockAccountDetails(name, args, scenario) {
    if (name === 'accountGetModels') {
        if (scenario === 'account-detail-model-error')
            return { success: false, error: 'Synthetic model catalog failure', models: [] }
        if (scenario === 'account-detail-slow-models') {
            await new Promise((resolve) => setTimeout(resolve, 280))
        }
        return { success: true, models: models(args[6]) }
    }
    if (name === 'loadKiroCredentials' && scenario.startsWith('account-edit')) {
        if (scenario === 'account-edit-local-fail')
            return { success: false, error: 'Synthetic local credential failure' }
        return {
            success: true,
            data: {
                accessToken: 'must-not-import-access',
                refreshToken: 'offline-local-refresh',
                clientId: 'offline-local-client',
                clientSecret: 'offline-local-secret',
                region: 'eu-west-1',
                authMethod: 'IdC',
                provider: 'BuilderId'
            }
        }
    }
    if (name === 'verifyAccountCredentials' && scenario.startsWith('account-edit')) {
        if (scenario === 'account-edit-verify-fail') {
            await new Promise((resolve) => setTimeout(resolve, 180))
            return { success: false, error: 'Synthetic credential verification failure' }
        }
        if (scenario === 'account-edit-late-result') {
            await new Promise((resolve) => setTimeout(resolve, 300))
        }
        return {
            success: true,
            data: {
                email:
                    scenario === 'account-edit-social'
                        ? 'offline-1@example.invalid'
                        : 'verified-0@example.invalid',
                userId: scenario === 'account-edit-social' ? 'social-user' : 'verified-user',
                accessToken: 'offline-verified-access',
                refreshToken: 'offline-rotated-refresh',
                subscriptionType: 'Pro',
                subscriptionTitle: 'KIRO PRO',
                usage: verifiedUsage,
                daysRemaining: 42,
                expiresAt: 1900000000000
            }
        }
    }
    return undefined
}

async function verifyAccountDetails(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario } = harness
    const calls = (name) => report.calls.filter((call) => call.name === name)
    const initialVerifyCount = calls('verifyAccountCredentials').length

    async function input(testid, value, event = 'input') {
        await run(`function () {
            const root = document.querySelector('dialog[open] [data-testid="${testid}"]')
            const control = root?.matches('input,textarea,select') ? root : root?.querySelector('input,textarea,select')
            if (!control) throw new Error('Missing account dialog control: ${testid}')
            control.value = ${JSON.stringify(value)}
            control.dispatchEvent(new Event('${event}', { bubbles: true }))
        }`)
    }

    async function confirm(accept) {
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog.ui-confirm[open]')) }`,
            'proxy unbind confirmation'
        )
        await click(
            `dialog.ui-confirm[open] .ui-confirm-actions button:nth-child(${accept ? 2 : 1})`,
            accept ? 'accept proxy unbind' : 'cancel proxy unbind'
        )
        await waitFor(
            `function () { return !document.querySelector('dialog.ui-confirm[open]') }`,
            'proxy confirmation closed'
        )
    }

    async function openDetail(id) {
        await click(`[data-testid="account-detail-${id}"]`, `details ${id}`)
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog[open] [data-testid="account-detail-dialog"]')) }`,
            'account detail open'
        )
    }

    async function closeDetail() {
        await click('dialog[open] [data-testid="account-detail-close"]', 'close account details')
        await waitFor(
            `function () { return !document.querySelector('dialog[open] [data-testid="account-detail-dialog"]') }`,
            'account detail closed'
        )
    }

    async function openEdit(id) {
        await click(`[data-testid="account-edit-${id}"]`, `edit ${id}`)
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog[open] [data-testid="account-edit-save"]')) }`,
            'account editor open'
        )
    }

    async function closeEdit() {
        await click('dialog[open] [data-testid="account-edit-cancel"]', 'cancel account edit')
        await waitFor(
            `function () { return !document.querySelector('dialog[open] [data-testid="account-edit-save"]') }`,
            'account editor closed'
        )
    }

    await run(`function () {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        const accounts = pinia._s.get('kam-accounts')
        const settings = pinia._s.get('kam-settings')
        const proxy = pinia._s.get('kam-proxyPool')
        if (!accounts || !settings || !proxy) throw new Error('Missing account detail stores')
        window.__accountDetailsFixture = {
            stores: { accounts, settings, proxy },
            original: {
                accounts: new Map(accounts.accounts),
                settings: JSON.parse(JSON.stringify(settings.$state)),
                proxyPool: new Map(proxy.proxyPool),
                proxyBindings: { ...proxy.accountProxyBindings },
                checkStatus: accounts.checkAccountStatus,
                clipboard: navigator.clipboard?.writeText
            },
            statusChecks: 0,
            copied: ''
        }
        window.__accountDetailsFixture.fieldValue = (testid) => {
            const root = document.querySelector('dialog[open]:has([data-testid="account-edit-save"]) [data-testid="' + testid + '"]')
            const input = root?.matches('input,textarea,select') ? root : root?.querySelector('input,textarea,select')
            return input?.value
        }
        const original = accounts.accounts.get('synthetic-0')
        const social = accounts.accounts.get('synthetic-1')
        accounts.$patch((state) => {
            const next = new Map(state.accounts)
            next.set('synthetic-0', {
                ...original,
                idp: 'BuilderId',
                userId: 'offline-user-0',
                profileArn: 'arn:aws:codewhisperer:us-east-1:offline:profile/offline',
                machineId: 'offline-machine-0',
                nickname: 'Offline Nickname',
                credentials: {
                    ...original.credentials,
                    authMethod: 'IdC',
                    provider: 'BuilderId',
                    clientId: 'original-client',
                    clientSecret: 'original-secret',
                    region: 'us-west-2',
                    unknownCredential: 'keep-this'
                },
                subscription: {
                    ...original.subscription,
                    type: 'Pro',
                    title: 'KIRO PRO',
                    rawType: 'PRO_RAW',
                    upgradeCapability: 'UPGRADE_CAPABLE',
                    daysRemaining: 9,
                    expiresAt: 1900000000000
                },
                usage: {
                    ...original.usage,
                    current: 105.5,
                    limit: 100,
                    percentUsed: 1.055,
                    baseCurrent: 65,
                    baseLimit: 80,
                    freeTrialCurrent: 15,
                    freeTrialLimit: 20,
                    freeTrialExpiry: '2027-01-15T00:00:00Z',
                    bonuses: [{ code: 'OFFLINE', name: 'Offline bonus', current: 5, limit: 10, expiresAt: '2027-03-01T00:00:00Z' }],
                    nextResetDate: '2027-02-01T00:00:00Z',
                    resourceDetail: { overageRate: 0.25, unit: 'INV', resourceType: 'CREDIT' }
                }
            })
            next.set('synthetic-1', {
                ...social,
                machineId: 'offline-machine-1',
                credentials: { ...social.credentials, authMethod: 'social', provider: 'Google', clientId: '', clientSecret: '' }
            })
            state.accounts = next
        })
        proxy.$patch((state) => {
            state.proxyPool = new Map([
                ['proxy-alive', { id: 'proxy-alive', url: 'http://alive.example.invalid:8080', protocol: 'http', host: 'alive.example.invalid', port: 8080, status: 'alive', enabled: true, latencyMs: 12 }],
                ['proxy-disabled', { id: 'proxy-disabled', url: 'http://disabled.example.invalid:8081', protocol: 'http', host: 'disabled.example.invalid', port: 8081, status: 'alive', enabled: false }],
                ['proxy-dead', { id: 'proxy-dead', url: 'http://dead.example.invalid:8082', protocol: 'http', host: 'dead.example.invalid', port: 8082, status: 'dead', enabled: true }]
            ])
            state.accountProxyBindings = { 'synthetic-0': 'missing-proxy' }
        })
        accounts.checkAccountStatus = async () => {
            window.__accountDetailsFixture.statusChecks++
            await new Promise((resolve) => setTimeout(resolve, 120))
        }
        Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async (value) => { window.__accountDetailsFixture.copied = value }
        })
    }`)

    try {
        await chooseMenu(0, 0)
        await chooseMenu(1, 1)
        setScenario('account-detail-normal')
        await click('#kam-navigation-tab-accounts', 'account manager')
        await waitFor(
            `function () { return Boolean(document.querySelector('[data-testid="account-detail-synthetic-0"]')) }`,
            'synthetic account item mounted'
        )
        await openDetail('synthetic-0')
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog[open] [data-testid="account-detail-model-offline-model-synthetic-0"]')) }`,
            'first account models loaded'
        )
        check(
            'model IPC receives all seven account context arguments',
            JSON.stringify(calls('accountGetModels').at(-1)?.args) ===
                JSON.stringify([
                    'synthetic-access-0',
                    'us-west-2',
                    'arn:aws:codewhisperer:us-east-1:offline:profile/offline',
                    'offline-machine-0',
                    'BuilderId',
                    'IdC',
                    'synthetic-0'
                ])
        )
        check(
            'detail displays original quota, bonus, expiry, resource and model capability',
            await run(`function () {
                const text = document.querySelector('dialog[open] [data-testid="account-detail-dialog"]')?.textContent || ''
                return ['105', '105.5%', 'Offline bonus', 'PRO_RAW', '$0.25/INV', 'CREDIT', 'YES',
                    'offline-model-synthetic-0', 'Offline Model', 'Text', 'Image', '1.5x', '200K', '4K'].every((part) => text.includes(part))
            }`)
        )
        await screenshot('phase3-account-detail-light-zh')

        await run(`function () {
            window.__accountDetailsFixture.stores.settings.$patch({ privacyMode: true, usagePrecision: true })
        }`)
        check(
            'detail privacy masks email nickname and user ID',
            await run(`function () {
                const text = document.querySelector('dialog[open] [data-testid="account-detail-dialog"]')?.textContent || ''
                return text.includes('********') && text.includes('user') && !text.includes('offline-0@example.invalid') &&
                    !text.includes('Offline Nickname') && !text.includes('offline-user-0')
            }`)
        )
        check(
            'precision retains fractional quota',
            await run(`function () {
            return document.querySelector('dialog[open] [data-testid="account-detail-dialog"]')?.textContent.includes('105.5')
        }`)
        )
        await run(
            `function () { window.__accountDetailsFixture.stores.settings.$patch({ privacyMode: false }) }`
        )
        await click(
            'dialog[open] [data-testid="account-detail-refresh"]',
            'refresh detail through parent'
        )
        await waitFor(
            `function () { return window.__accountDetailsFixture.statusChecks === 1 }`,
            'parent detail refresh invoked'
        )
        check(
            'detail refresh only delegates once',
            await run(`function () { return window.__accountDetailsFixture.statusChecks === 1 }`)
        )

        await click('dialog[open] [data-testid="account-detail-proxy-open"]', 'open proxy choices')
        check(
            'proxy candidates require enabled and alive',
            await run(`function () {
                const dialog = document.querySelector('dialog[open] [data-testid="account-detail-dialog"]')
                return Boolean(dialog.querySelector('[data-testid="account-detail-proxy-proxy-alive"]')) &&
                    !dialog.querySelector('[data-testid="account-detail-proxy-proxy-disabled"]') &&
                    !dialog.querySelector('[data-testid="account-detail-proxy-proxy-dead"]')
            }`)
        )
        check(
            'stale proxy binding shown',
            await run(`function () {
            return document.querySelector('dialog[open] [data-testid="account-detail-dialog"]')?.textContent.includes('之前绑定的代理已不可用')
        }`)
        )
        await click(
            'dialog[open] [data-testid="account-detail-proxy-proxy-alive"]',
            'bind alive proxy'
        )
        await waitFor(
            `function () { return window.__accountDetailsFixture.stores.proxy.accountProxyBindings['synthetic-0'] === 'proxy-alive' }`,
            'alive proxy bound'
        )
        await click(
            'dialog[open] [data-testid="account-detail-proxy-unbind"]',
            'cancel unbind proxy'
        )
        await confirm(false)
        check(
            'cancel unbind leaves binding',
            await run(
                `function () { return window.__accountDetailsFixture.stores.proxy.accountProxyBindings['synthetic-0'] === 'proxy-alive' }`
            )
        )
        await click(
            'dialog[open] [data-testid="account-detail-proxy-unbind"]',
            'confirm unbind proxy'
        )
        await confirm(true)
        await waitFor(
            `function () { return !window.__accountDetailsFixture.stores.proxy.accountProxyBindings['synthetic-0'] }`,
            'proxy unbound'
        )

        await closeDetail()
        setScenario('account-detail-model-error')
        await openDetail('synthetic-0')
        await waitFor(
            `function () { return document.querySelector('dialog[open] [data-testid="account-detail-models-error"]')?.textContent.includes('Synthetic model catalog failure') }`,
            'model error visible'
        )
        setScenario('account-detail-normal')
        await click('dialog[open] [data-testid="account-detail-models-retry"]', 'retry models')
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog[open] [data-testid="account-detail-model-offline-model-synthetic-0"]')) }`,
            'model retry success'
        )
        await closeDetail()

        setScenario('account-detail-slow-models')
        await openDetail('synthetic-0')
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog[open] [data-testid="account-detail-models-loading"]')) }`,
            'old model load pending'
        )
        await closeDetail()
        setScenario('account-detail-normal')
        await openDetail('synthetic-1')
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog[open] [data-testid="account-detail-model-offline-model-synthetic-1"]')) }`,
            'new account model'
        )
        await new Promise((resolve) => setTimeout(resolve, 340))
        check(
            'late old model result ignored after account switch',
            await run(`function () {
                const dialog = document.querySelector('dialog[open] [data-testid="account-detail-dialog"]')
                return Boolean(dialog.querySelector('[data-testid="account-detail-model-offline-model-synthetic-1"]')) &&
                    !dialog.querySelector('[data-testid="account-detail-model-offline-model-synthetic-0"]')
            }`)
        )
        await closeDetail()

        setScenario('account-edit-normal')
        await openEdit('synthetic-0')
        check(
            'editor retains original seeded data before verification',
            await run(`function () {
            const value = window.__accountDetailsFixture.fieldValue
            return value('account-edit-refresh-token') === 'synthetic-refresh' &&
                value('account-edit-client-id') === 'original-client' &&
                value('account-edit-region') === 'us-west-2'
        }`)
        )
        await input('account-edit-nickname', 'cancelled nickname')
        const accountBeforeCancel = await run(`function () {
            return JSON.stringify(window.__accountDetailsFixture.stores.accounts.accounts.get('synthetic-0'))
        }`)
        const beforeCancelSave = calls('save-accounts').length
        await closeEdit()
        const accountAfterCancel = await run(`function () {
            return JSON.stringify(window.__accountDetailsFixture.stores.accounts.accounts.get('synthetic-0'))
        }`)
        check(
            'edit cancel leaves account unchanged and never persists the draft',
            accountAfterCancel === accountBeforeCancel &&
                calls('save-accounts')
                    .slice(beforeCancelSave)
                    .every((call) => !JSON.stringify(call.args).includes('cancelled nickname'))
        )

        await openEdit('synthetic-0')
        await input('account-edit-refresh-token', '')
        check(
            'non-social refresh token required and verification not called',
            (await run(
                `function () { return document.querySelector('dialog[open] [data-testid="account-edit-verify"]')?.disabled }`
            )) && calls('verifyAccountCredentials').length === initialVerifyCount
        )
        await input('account-edit-refresh-token', 'offline-draft-refresh')
        await input('account-edit-client-id', '')
        check(
            'non-social client pair required',
            await run(
                `function () { return document.querySelector('dialog[open] [data-testid="account-edit-verify"]')?.disabled }`
            )
        )
        await input('account-edit-client-id', 'original-client')
        setScenario('account-edit-local-success')
        await click(
            'dialog[open] [data-testid="account-edit-import-local"]',
            'import local four fields'
        )
        await waitFor(
            `function () { return window.__accountDetailsFixture.fieldValue('account-edit-refresh-token') === 'offline-local-refresh' }`,
            'local credentials populated'
        )
        check(
            'local import replaces four fields only',
            await run(`function () {
            const dialog = document.querySelector('dialog[open]:has([data-testid="account-edit-save"])')
            const value = window.__accountDetailsFixture.fieldValue
            return value('account-edit-client-id') === 'offline-local-client' &&
                value('account-edit-client-secret') === 'offline-local-secret' &&
                value('account-edit-region') === 'eu-west-1' &&
                !dialog.textContent.includes('must-not-import-access')
        }`)
        )

        setScenario('account-edit-verify-fail')
        const beforeVerify = calls('verifyAccountCredentials').length
        await click(
            'dialog[open] [data-testid="account-edit-verify"]',
            'failed credential verification'
        )
        await click(
            'dialog[open] [data-testid="account-edit-verify"]',
            'duplicate credential verification'
        )
        await waitFor(
            `function () { return document.querySelector('dialog[open] [data-testid="account-edit-error"]')?.textContent.includes('Synthetic credential verification failure') }`,
            'credential failure visible'
        )
        check(
            'verification duplicate lock and complete IPC context',
            calls('verifyAccountCredentials').length === beforeVerify + 1 &&
                JSON.stringify(calls('verifyAccountCredentials').at(-1).args[0]) ===
                    JSON.stringify({
                        refreshToken: 'offline-local-refresh',
                        clientId: 'offline-local-client',
                        clientSecret: 'offline-local-secret',
                        region: 'eu-west-1',
                        authMethod: 'IdC',
                        provider: 'BuilderId'
                    })
        )

        setScenario('account-edit-normal')
        await click(
            'dialog[open] [data-testid="account-edit-verify"]',
            'verify and rotate credentials'
        )
        await waitFor(
            `function () { return window.__accountDetailsFixture.fieldValue('account-edit-refresh-token') === 'offline-rotated-refresh' }`,
            'rotated refresh token'
        )
        await input('account-edit-nickname', 'Verified nickname')
        await click(
            'dialog[open] [data-testid="account-edit-copy-access"]',
            'copy verified access token'
        )
        await waitFor(
            `function () { return window.__accountDetailsFixture.copied === 'offline-verified-access' }`,
            'access copied'
        )
        const beforeSave = calls('save-accounts').length
        await click('dialog[open] [data-testid="account-edit-save"]', 'save verified account')
        await waitFor(
            `function () { return !document.querySelector('dialog[open] [data-testid="account-edit-save"]') }`,
            'verified editor closed'
        )
        check(
            'verified save retains unknown credential and fields',
            await run(`function () {
            const account = window.__accountDetailsFixture.stores.accounts.accounts.get('synthetic-0')
            return account.email === 'verified-0@example.invalid' && account.userId === 'verified-user' &&
                account.nickname === 'Verified nickname' && account.credentials.accessToken === 'offline-verified-access' &&
                account.credentials.refreshToken === 'offline-rotated-refresh' && account.credentials.csrfToken === '' &&
                account.credentials.unknownCredential === 'keep-this' && account.credentials.clientId === 'offline-local-client' &&
                account.subscription.type === 'Pro' && account.subscription.daysRemaining === 42 &&
                account.usage.current === 135.5 && account.usage.baseLimit === 80 &&
                account.usage.freeTrialLimit === 20 && account.usage.bonuses[0].code === 'OFFLINE' &&
                account.usage.percentUsed === 1.355 && account.status === 'active' &&
                Math.abs(account.credentials.expiresAt - (account.usage.lastUpdated + 3600000)) < 1000
        }`)
        )
        await new Promise((resolve) => setTimeout(resolve, 650))
        check(
            'verified account persisted',
            calls('save-accounts').length > beforeSave &&
                calls('save-accounts').at(-1).args[0].accounts['synthetic-0']?.credentials
                    ?.refreshToken === 'offline-rotated-refresh'
        )

        setScenario('account-edit-late-result')
        await openEdit('synthetic-0')
        const beforeLate = calls('verifyAccountCredentials').length
        await click('dialog[open] [data-testid="account-edit-verify"]', 'start late verification')
        await waitFor(
            `function () { return document.querySelector('dialog[open] [data-testid="account-edit-verify"]')?.disabled }`,
            'late verification pending'
        )
        await run(`function () {
            document.querySelector('dialog[open]:has([data-testid="account-edit-save"])')?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))
        }`)
        await waitFor(
            `function () { return !document.querySelector('dialog[open] [data-testid="account-edit-save"]') }`,
            'late editor closed'
        )
        setScenario('account-edit-social')
        await openEdit('synthetic-1')
        await new Promise((resolve) => setTimeout(resolve, 340))
        check(
            'late old verification ignored after switching accounts',
            calls('verifyAccountCredentials').length === beforeLate + 1 &&
                (await run(`function () {
                const dialog = document.querySelector('dialog[open]:has([data-testid="account-edit-save"])')
                return window.__accountDetailsFixture.fieldValue('account-edit-refresh-token') === 'synthetic-refresh' &&
                    !dialog.querySelector('[data-testid="account-edit-client-id"]') &&
                    !dialog.textContent.includes('verified-0@example.invalid')
            }`))
        )
        await click(
            'dialog[open] [data-testid="account-edit-verify"]',
            'verify social refresh only'
        )
        await waitFor(
            `function () { return window.__accountDetailsFixture.fieldValue('account-edit-refresh-token') === 'offline-rotated-refresh' }`,
            'social verified'
        )
        check(
            'social verify omits client requirement but sends context',
            calls('verifyAccountCredentials').at(-1)?.args[0]?.authMethod === 'social' &&
                calls('verifyAccountCredentials').at(-1)?.args[0]?.provider === 'Google' &&
                calls('verifyAccountCredentials').at(-1)?.args[0]?.clientId === '' &&
                calls('verifyAccountCredentials').at(-1)?.args[0]?.clientSecret === ''
        )
        await closeEdit()
        await chooseMenu(0, 1)
        await chooseMenu(1, 2)
        await openDetail('synthetic-0')
        await screenshot('phase3-account-detail-dark-en')
        await closeDetail()
    } finally {
        setScenario('account-detail-normal')
        await run(`function () {
            const fixture = window.__accountDetailsFixture
            if (!fixture) return
            const { stores, original } = fixture
            stores.accounts.checkAccountStatus = original.checkStatus
            stores.accounts.$patch((state) => { state.accounts = new Map(original.accounts) })
            stores.settings.$patch(original.settings)
            stores.proxy.$patch((state) => {
                state.proxyPool = new Map(original.proxyPool)
                state.accountProxyBindings = original.proxyBindings
            })
            if (navigator.clipboard && original.clipboard) {
                Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: original.clipboard })
            }
            delete window.__accountDetailsFixture
        }`)
        await click('#kam-navigation-tab-home', 'leave account details')
        await chooseMenu(0, 0)
        await chooseMenu(1, 1)
    }
}

module.exports = { mockAccountDetails, verifyAccountDetails }
