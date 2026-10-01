/* Offline subscription page checks use synthetic account context and IPC replies only. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

const plans = [
    {
        name: 'Synthetic Plus',
        qSubscriptionType: 'Q_PRO_PLUS',
        description: {
            title: 'Synthetic Pro Plus',
            billingInterval: 'monthly',
            featureHeader: 'Plus features',
            features: ['More synthetic credits']
        },
        pricing: { amount: 500, currency: 'USD' }
    },
    {
        name: 'Synthetic Pro',
        qSubscriptionType: 'Q_PRO',
        description: {
            title: 'Synthetic Pro',
            billingInterval: 'monthly',
            featureHeader: 'Pro features',
            features: ['Synthetic credits']
        },
        pricing: { amount: 200, currency: 'USD' }
    }
]

async function mockSubscription(name, args, scenario) {
    if (!scenario?.startsWith('subscription-')) return undefined
    if (name === 'accountGetSubscriptions') {
        if (scenario === 'subscription-plans-fail')
            return { success: false, error: 'Synthetic plans unavailable' }
        return { success: true, plans }
    }
    if (name === 'accountGetSubscriptionUrl') {
        if (scenario === 'subscription-slow-links')
            await new Promise((resolve) => setTimeout(resolve, 420))
        const id = args[7] || 'missing-id'
        if (args[1] && id === 'subscription-free-error')
            return { success: false, error: 'Synthetic URL rejection' }
        return {
            success: true,
            url: `https://example.invalid/${args[1] ? 'subscribe' : 'portal'}/${id}`
        }
    }
    if (name === 'accountSetOverage') {
        if (scenario === 'subscription-slow-overage')
            await new Promise((resolve) => setTimeout(resolve, 120))
        const id = args[7]
        if (args[1] === 'ENABLED' && id === 'subscription-paid-4')
            return { success: false, error: 'Synthetic overage denial' }
        return { success: true }
    }
    if (name === 'diagnoseHttpProbe') {
        if (scenario === 'subscription-slow-probe')
            await new Promise((resolve) => setTimeout(resolve, 350))
        return args[0].url.includes('subscription-free-1')
            ? { success: false, status: 503, error: 'Synthetic HEAD failure' }
            : { success: true, status: 200 }
    }
    if (name === 'openSubscriptionWindow') return { success: true }
    return undefined
}

async function verifySubscription(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario } = harness
    const calls = (name) => report.calls.filter((call) => call.name === name)
    const page = '[data-testid="page-subscription"]'

    async function input(selector, value, event = 'input') {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(selector)})
            const field = root?.matches('input,textarea,select') ? root : root?.querySelector('input,textarea,select')
            if (!field) throw new Error('Missing subscription input: ' + ${JSON.stringify(selector)} + '; visible hooks=' + [...document.querySelectorAll('[data-testid^="subscription-"]')].filter((node) => node.getClientRects().length).map((node) => node.getAttribute('data-testid')).join(','))
            field.value = ${JSON.stringify(value)}
            field.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }))
        }`)
    }

    async function confirm(accept) {
        await waitFor(
            "function () { return Boolean(document.querySelector('dialog.ui-confirm[open]')) }",
            'subscription confirmation'
        )
        await click(
            `dialog.ui-confirm[open] .ui-confirm-actions button:nth-child(${accept ? 2 : 1})`,
            accept ? 'accept subscription confirmation' : 'cancel subscription confirmation'
        )
        await waitFor(
            "function () { return !document.querySelector('dialog.ui-confirm[open]') }",
            'subscription confirmation closes'
        )
    }

    setScenario('subscription-normal')
    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    await run(`function () {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        const accounts = pinia._s.get('kam-accounts')
        if (!accounts) throw new Error('Account store missing')
        window.__subscriptionFixture = {
            accounts: new Map(accounts.accounts),
            selectedIds: new Set(accounts.selectedIds),
            activeAccountId: accounts.activeAccountId,
            clipboard: navigator.clipboard.writeText,
            copied: []
        }
        navigator.clipboard.writeText = async (value) => { window.__subscriptionFixture.copied.push(value) }
        const synthetic = []
        function account(id, type, options = {}) {
            return {
                id, email: id + '@example.invalid', status: options.status || 'active',
                lastError: options.lastError || '', idp: 'BuilderId',
                profileArn: 'arn:synthetic:profile/' + id, machineId: 'synthetic-machine-' + id,
                credentials: { accessToken: options.noToken ? '' : 'synthetic-token-' + id,
                    refreshToken: 'synthetic-refresh-' + id, region: 'eu-west-1',
                    provider: 'BuilderId', authMethod: 'IdC' },
                subscription: { type, title: type === 'Free' ? 'KIRO FREE' : 'KIRO PRO',
                    overageCapability: options.capable ? 'OVERAGE_CAPABLE' : 'NOT_CAPABLE',
                    upgradeCapability: options.upgradeCapability || 'UPGRADE_CAPABLE',
                    daysRemaining: options.daysRemaining ?? 20 },
                usage: { current: 1, limit: 10, percentUsed: 10, resourceDetail: { overageEnabled: Boolean(options.overage) } },
                tags: [], createdAt: Date.now(), lastUsedAt: Date.now()
            }
        }
        synthetic.push(account('subscription-free-0', 'Free'))
        synthetic.push(account('subscription-free-1', 'Free'))
        synthetic.push(account('subscription-free-error', 'Free'))
        synthetic.push(account('subscription-free-banned', 'Free', { status: 'error', lastError: 'Temporarily suspended' }))
        synthetic.push(account('subscription-free-no-token', 'Free', { noToken: true }))
        synthetic.push(account('subscription-free-no-upgrade', 'Free', { upgradeCapability: 'NOT_ALLOWED' }))
        for (let index = 0; index < 55; index++) synthetic.push(account('subscription-paid-' + index, 'Pro', { capable: index % 2 === 0, overage: index % 7 === 0, daysRemaining: index % 10 }))
        accounts.$patch((state) => {
            state.accounts = new Map(synthetic.map((item) => [item.id, item]))
            state.selectedIds = new Set()
            state.activeAccountId = 'subscription-free-0'
        })
    }`)

    try {
        await click('#kam-navigation-tab-subscription', 'subscription page')
        await waitFor(
            `function () { return Boolean(document.querySelector(${JSON.stringify(page)})) }`,
            'subscription page mounted'
        )
        check(
            'Overage is default tab',
            await run(
                "function () { return !!document.querySelector('[data-testid=subscription-overage]') }"
            )
        )
        await screenshot('phase3-subscription-overage-light-zh')
        await click('[data-testid=subscription-tab-links]', 'subscription links tab')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=subscription-links]') }",
            'links tab'
        )
        check(
            'Preflight excludes banned and no-upgrade while FREE batch includes them',
            await run(`function () {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
            const state = pinia._s.get('kam-subscription')
            return state?.preflightReport.eligible.length === 3 && state?.upgradeableAccounts.length === 5 && state?.preflightReport.reasonBuckets.banned === 1 && state?.preflightReport.reasonBuckets['cant-upgrade'] === 1
        }`)
        )
        setScenario('subscription-plans-fail')
        await click('[data-testid=subscription-load-plans]', 'load plans failure')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=subscription-error]') }",
            'plan failure visible'
        )
        setScenario('subscription-normal')
        await click('[data-testid=subscription-load-plans]', 'load synthetic plans')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=subscription-plan-Q_PRO]') }",
            'plans visible'
        )
        check(
            'Non-PLUS Pro is default',
            await run(
                `function () { return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').selectedPlanType === 'Q_PRO' }`
            )
        )
        check(
            'Plans use seven account context arguments',
            calls('accountGetSubscriptions').at(-1)?.args.length === 7 &&
                calls('accountGetSubscriptions').at(-1)?.args[0] ===
                    'synthetic-token-subscription-free-0' &&
                calls('accountGetSubscriptions').at(-1)?.args[2] ===
                    'arn:synthetic:profile/subscription-free-0' &&
                calls('accountGetSubscriptions').at(-1)?.args[6] === 'subscription-free-0'
        )

        setScenario('subscription-slow-links')
        await input('[data-testid=subscription-concurrency]', '1')
        await click('[data-testid=subscription-fetch-links]', 'start slow link batch')
        await waitFor(
            "function () { const state = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription'); return state.isFetching && state.links.some((link) => link.status === 'loading') }",
            'link batch started'
        )
        await run(`function () {
            const state = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription')
            state.clearLinks()
        }`)
        await waitFor(
            `function () { return document.querySelector('[data-testid=subscription-fetch-links]')?.disabled === false }`,
            'clear releases generation lock'
        )
        await new Promise((resolve) => setTimeout(resolve, 500))
        check(
            'Cleared in-flight links do not return',
            await run(
                `function () { const state = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription'); return state.links.length === 0 && !state.isFetching }`
            )
        )
        setScenario('subscription-normal')
        await click('[data-testid=subscription-fetch-links]', 'fetch links')
        await waitFor(
            "function () { const state = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription'); return !state.isFetching && state.links.length === 5 }",
            'link batch completes'
        )
        check(
            'Batch URL requests use selected plan and full context',
            calls('accountGetSubscriptionUrl')
                .filter((entry) => entry.args[1] === 'Q_PRO')
                .some(
                    (entry) =>
                        entry.args.length === 8 &&
                        entry.args[7] === 'subscription-free-0' &&
                        entry.args[2] === 'eu-west-1' &&
                        entry.args[3] === 'arn:synthetic:profile/subscription-free-0'
                )
        )
        check(
            'Failed link kept for retry',
            await run(
                `function () { const state = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription'); return state.links.find((item) => item.accountId === 'subscription-free-error')?.status === 'error' }`
            )
        )
        await screenshot('phase3-subscription-links-light-zh')

        await click('[data-testid=subscription-validate]', 'validate generated links')
        await waitFor(
            "function () { return !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').isValidatingLinks }",
            'validation finishes'
        )
        check(
            'HEAD probe uses timeout and expires failed link',
            calls('diagnoseHttpProbe').some(
                (entry) => entry.args[0].method === 'HEAD' && entry.args[0].timeoutMs === 6000
            ) &&
                (await run(
                    `function () { return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').links.find((item) => item.accountId === 'subscription-free-1')?.status === 'expired' }`
                ))
        )
        await click('[data-testid=subscription-import-open]', 'open import links')
        await input(
            'dialog[open] [data-testid=subscription-import-text]',
            'offline@example.invalid ---- https://example.invalid/import-a),\nhttps://example.invalid/import-a\nhttps://example.invalid/import-b'
        )
        await click(
            'dialog[open] [data-testid=subscription-import-confirm]',
            'import synthetic links'
        )
        check(
            'Import strips punctuation and deduplicates URL',
            await run(
                `function () { const links = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').links; return links.filter((item) => item.url === 'https://example.invalid/import-a').length === 1 && links.some((item) => item.email === 'offline@example.invalid' && item.url === 'https://example.invalid/import-a') }`
            )
        )
        await click('[data-testid=subscription-quick-top]', 'pick first batch')
        check(
            'Quick pick selects success URLs',
            await run(
                `function () { return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').selectedLinkIds.size > 0 }`
            )
        )
        await click('[data-testid=subscription-export-selected]', 'copy selected URLs')
        check(
            'Export is newline clipboard text',
            await run(
                `function () { return window.__subscriptionFixture.copied.at(-1)?.startsWith('https://example.invalid/') }`
            )
        )
        await click('[data-testid=subscription-delete-failed]', 'request failed cleanup')
        await confirm(false)
        check(
            'Cancelled failed cleanup preserves links',
            await run(
                `function () { return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').links.some((item) => item.status === 'expired') }`
            )
        )
        await click('[data-testid=subscription-delete-failed]', 'remove failed and expired links')
        await confirm(true)
        check(
            'Failed cleanup only removes failed/expired links',
            await run(
                `function () { const links = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').links; return links.every((item) => item.status === 'success') && links.some((item) => item.accountId.startsWith('import-')) }`
            )
        )

        await click('[data-testid=subscription-tab-overage]', 'overage tab')
        await click('[data-testid=subscription-enable-overage]', 'enable overage batch')
        await waitFor(
            "function () { return !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').isSettingOverage }",
            'overage batch finishes'
        )
        check(
            'Overage failures and success preserve unrelated usage',
            await run(
                `function () { const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; const state = pinia._s.get('kam-subscription'); const accounts = pinia._s.get('kam-accounts'); return state.overageItems.some((item) => item.status === 'error') && accounts.accounts.get('subscription-paid-2').usage.current === 1 && accounts.accounts.get('subscription-paid-2').usage.resourceDetail.overageEnabled === true }`
            )
        )
        check(
            'ENABLE uses all eight account context arguments',
            calls('accountSetOverage').some(
                (entry) =>
                    entry.args.length === 8 &&
                    entry.args[1] === 'ENABLED' &&
                    entry.args[7] === 'subscription-paid-2' &&
                    entry.args[2] === 'eu-west-1'
            )
        )
        await click('[data-testid=subscription-retry-overage]', 'retry failed overage')
        await waitFor(
            "function () { return !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').isSettingOverage }",
            'retry overage finishes'
        )

        await click('[data-testid=subscription-tab-manage]', 'manage tab')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=subscription-manage]') }",
            'manage subscription tab'
        )
        check(
            'At least fifty subscribed rows use virtual rendering',
            await run(
                `function () { const scroll = document.querySelector('[data-testid=manage-scroll]'); const state = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription'); const visible = scroll?.querySelectorAll('.kam-manage-row').length || 0; return state.subscribedAccounts.length >= 50 && visible > 0 && visible < state.subscribedAccounts.length }`
            )
        )
        await screenshot('phase3-subscription-manage-light-zh')
        await click('[data-testid=manage-select-subscription-paid-0]', 'select paid account')
        await click('[data-testid=manage-open-selected]', 'open selected portal')
        await confirm(true)
        await waitFor(
            "function () { return !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').isBatchOpening }",
            'portal batch finishes'
        )
        check(
            'Portal requests omit plan and use account context',
            calls('accountGetSubscriptionUrl').some(
                (entry) =>
                    entry.args.length === 8 &&
                    entry.args[1] === undefined &&
                    entry.args[7] === 'subscription-paid-0'
            ) &&
                calls('openSubscriptionWindow').some(
                    (entry) =>
                        entry.args[0] === 'https://example.invalid/portal/subscription-paid-0'
                )
        )
        await click('[data-testid=manage-disable-selected]', 'disable selected overage')
        await confirm(true)
        await waitFor(
            "function () { return !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription').isBatchDisablingOverage }",
            'disable overage finishes'
        )
        check(
            'DISABLED keeps unrelated usage fields',
            calls('accountSetOverage').some(
                (entry) => entry.args[1] === 'DISABLED' && entry.args[7] === 'subscription-paid-0'
            ) &&
                (await run(
                    `function () { const account = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts').accounts.get('subscription-paid-0'); return account.usage.current === 1 && account.usage.resourceDetail.overageEnabled === false }`
                ))
        )
        await chooseMenu(0, 1)
        await chooseMenu(1, 2)
        await screenshot('phase3-subscription-manage-dark-en')
    } finally {
        setScenario('subscription-normal')
        await click('#kam-navigation-tab-home', 'leave subscription page')
        await run(`function () {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
            const accounts = pinia._s.get('kam-accounts')
            const state = pinia._s.get('kam-subscription')
            const old = window.__subscriptionFixture
            if (!old) return
            accounts.$patch((target) => {
                target.accounts = new Map(old.accounts)
                target.selectedIds = new Set(old.selectedIds)
                target.activeAccountId = old.activeAccountId
            })
            state.clearLinks()
            state.overageItems = []
            state.availablePlans = []
            state.selectedPlanType = ''
            state.manageSelectedIds = new Set()
            state.activeTab = 'overage'
            navigator.clipboard.writeText = old.clipboard
            delete window.__subscriptionFixture
        }`)
        await chooseMenu(0, 0)
        await chooseMenu(1, 1)
    }
}

module.exports = { mockSubscription, verifySubscription }
