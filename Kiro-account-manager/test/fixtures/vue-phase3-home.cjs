/* Offline Home checks use only synthetic Pinia account data and restore the original state. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

const page = '[data-testid="page-home"]'

async function verifyHome(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu } = harness

    async function navigateHome() {
        await click('#kam-navigation-tab-home', 'home page')
        await waitFor(
            `function () { return document.querySelector(${JSON.stringify(page)}) && document.querySelector('#kam-navigation-panel-home')?.classList.contains('is-active') }`,
            'home active'
        )
    }

    async function resetJumpState() {
        await run(`function () {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
            const accounts = pinia._s.get('kam-accounts')
            accounts.$patch((state) => {
                state.activeGroupTab = 'synthetic-group'
                state.filter = { search: 'stale-filter', statuses: ['unknown'] }
            })
        }`)
        await navigateHome()
    }

    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    await run(`function () {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        const accounts = pinia._s.get('kam-accounts')
        const settings = pinia._s.get('kam-settings')
        if (!accounts || !settings) throw new Error('Missing account/settings stores')
        window.__homeOriginal = {
            accounts: new Map(accounts.accounts),
            filter: { ...accounts.filter },
            activeGroupTab: accounts.activeGroupTab,
            activeAccountId: accounts.activeAccountId,
            usagePrecision: settings.usagePrecision,
            groupStorage: localStorage.getItem('accounts_activeGroupTab')
        }
        const now = Date.now()
        function account(id, options) {
            return {
                id, email: id + '@example.invalid', nickname: options.nickname,
                idp: 'BuilderId', userId: 'user-' + id,
                credentials: {
                    accessToken: 'synthetic-' + id, csrfToken: '',
                    authMethod: 'IdC', provider: 'BuilderId', expiresAt: options.tokenExpiresAt ?? now + 86400000
                },
                subscription: {
                    type: 'Free', title: options.title || 'KIRO FREE',
                    daysRemaining: options.days, rawType: options.rawType,
                    expiresAt: options.subscriptionExpiresAt,
                    upgradeCapability: options.upgradeCapability,
                    overageCapability: options.overageCapability
                },
                usage: {
                    current: options.used, limit: options.limit,
                    percentUsed: options.percent, lastUpdated: now,
                    baseCurrent: options.baseCurrent, baseLimit: options.baseLimit,
                    freeTrialCurrent: options.freeTrialCurrent,
                    freeTrialLimit: options.freeTrialLimit,
                    freeTrialExpiry: options.freeTrialExpiry,
                    bonuses: options.bonuses,
                    nextResetDate: options.nextResetDate
                },
                status: options.status || 'active', lastError: options.lastError,
                isActive: id === 'home-current', tags: [], createdAt: now, lastUsedAt: now
            }
        }
        const synthetic = [
            account('home-current', {
                nickname: 'Synthetic Current', title: 'KIRO PRO', days: 3,
                rawType: 'Q_DEVELOPER_STANDALONE_PRO',
                subscriptionExpiresAt: Date.UTC(2027, 0, 15),
                upgradeCapability: 'UPGRADE_CAPABLE', overageCapability: 'OVERAGE_CAPABLE',
                used: 140, limit: 100, percent: 1.4,
                tokenExpiresAt: now - 1000,
                baseCurrent: 100, baseLimit: 100,
                freeTrialCurrent: 25, freeTrialLimit: 30, freeTrialExpiry: '2027-02-03T10:00:00Z',
                bonuses: [{ code: 'BONUS', name: 'Synthetic bonus', current: 15, limit: 20, expiresAt: '2027-03-04T10:00:00Z' }],
                nextResetDate: '2027-04-05T10:00:00Z'
            }),
            account('home-banned', {
                status: 'error', lastError: 'AccountSuspendedException: synthetic ban',
                days: 2, used: 99, limit: 100, percent: 0.99
            }),
            account('home-expiring', { days: 7, used: 0, limit: 0, percent: 0 }),
            account('home-normal', { days: 30, used: 25, limit: 50, percent: 0.5 }),
            account('home-inactive', { status: 'expired', days: 1, used: 200, limit: 200, percent: 1 }),
            account('home-unmetered', { used: 300, limit: 0, percent: 1, tokenExpiresAt: 0 })
        ]
        accounts.$patch((state) => {
            state.accounts = new Map(synthetic.map((item) => [item.id, item]))
            state.activeAccountId = 'home-current'
            state.activeGroupTab = 'synthetic-group'
            state.filter = { search: 'stale-filter', statuses: ['unknown'] }
        })
        settings.$patch((state) => { state.usagePrecision = true })
    }`)

    try {
        await navigateHome()
        await waitFor(
            `function () { return document.querySelector('[data-testid="home-current"]')?.textContent.includes('Synthetic Current') }`,
            'synthetic home rendered'
        )
        check(
            'Home stats keep getStats semantics, including banned in expiring count',
            await run(`function () {
                const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
                const stats = pinia._s.get('kam-accounts').getStats()
                const text = document.querySelector('[data-testid="home-stats"]')?.textContent || ''
                return stats.total === 6 && stats.byStatus.active === 4 && stats.byStatus.error === 1 &&
                    stats.expiringSoonCount === 4 && text.includes('6') && text.includes('4') && text.includes('1')
            }`)
        )
        check(
            'Home warnings exclude banned account from expiring/quota rows',
            await run(`function () {
                const rows = ['banned', 'expiring', 'quota'].map((key) => document.querySelector('[data-testid="home-warning-' + key + '"]'))
                return rows.every(Boolean) && rows[0].textContent.includes('1') &&
                    rows[1].textContent.includes('3') && rows[2].textContent.includes('1') &&
                    !rows[1].textContent.includes('home-banned') && !rows[2].textContent.includes('home-banned')
            }`)
        )
        check(
            'Home usage excludes inactive and zero-limit accounts and retains over-quota precision',
            await run(`function () {
                const text = document.querySelector('[data-testid="home-usage"]')?.textContent || ''
                return text.includes('150') && text.includes('165') && text.includes('-15') &&
                    text.includes('110.00%') && text.includes('+10.00%') &&
                    !!document.querySelector('[data-testid="home-usage"] .ui-alert')
            }`)
        )
        check(
            'Current account shows raw subscription, quota details, token expiry, and dates',
            await run(`function () {
                const text = document.querySelector('[data-testid="home-current"]')?.textContent || ''
                return ['Synthetic Current', 'home-current@example.invalid', 'KIRO PRO',
                    'Q_DEVELOPER_STANDALONE_PRO', '2027/1/15', 'UPGRADE_CAPABLE',
                    'OVERAGE_CAPABLE', '100 / 100', '25 / 30', 'Synthetic bonus',
                    '15 / 20', '2027-02-03', '2027-03-04', '2027-04-05',
                    '已过期', 'Builder ID', 'user-home-current'].every((part) => text.includes(part))
            }`)
        )
        await screenshot('phase3-home-light-zh')
        await run(
            `function () { document.querySelector('[data-testid="home-current"]').scrollIntoView({ block: 'start' }) }`
        )
        await screenshot('phase3-home-current-light-zh')
        await run(`function () { document.querySelector('.kam-content').scrollTop = 0 }`)

        const jumps = [
            { key: 'banned', field: 'bannedOnly', value: true },
            { key: 'expiring', field: 'daysRemainingMax', value: 7 },
            { key: 'quota', field: 'usageMin', value: 0.9 }
        ]
        for (const jump of jumps) {
            await resetJumpState()
            await click(`[data-testid="home-warning-${jump.key}"]`, `home ${jump.key} warning`)
            await waitFor(
                `function () { return document.querySelector('#kam-navigation-panel-accounts')?.classList.contains('is-active') }`,
                `home ${jump.key} accounts navigation`
            )
            check(
                `${jump.key} warning clears group restriction and applies only target filter`,
                await run(`function () {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
                    return store.activeGroupTab === 'all' &&
                        store.filter[${JSON.stringify(jump.field)}] === ${JSON.stringify(jump.value)} &&
                        !store.filter.search && !store.filter.statuses
                }`)
            )
        }

        await navigateHome()
        await run(`function () {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
            pinia._s.get('kam-settings').$patch((state) => { state.usagePrecision = false })
            pinia._s.get('kam-accounts').$patch((state) => { state.activeAccountId = 'home-unmetered' })
        }`)
        check(
            'Home non-precise display and permanent/unknown current-account fallback',
            await run(`function () {
                const usage = document.querySelector('[data-testid="home-usage"]')?.textContent || ''
                const current = document.querySelector('[data-testid="home-current"]')?.textContent || ''
                return usage.includes('110.0%') && current.includes('永久') && current.includes('未知')
            }`)
        )
        await chooseMenu(0, 1)
        await chooseMenu(1, 2)
        await run(`function () {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
            store.$patch((state) => { state.activeAccountId = 'home-current' })
        }`)
        await screenshot('phase3-home-dark-en')
        await run(
            `function () { document.querySelector('[data-testid="home-current"]').scrollIntoView({ block: 'start' }) }`
        )
        await screenshot('phase3-home-current-dark-en')
    } finally {
        await run(`function () {
            const original = window.__homeOriginal
            if (!original) return
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
            const accounts = pinia._s.get('kam-accounts')
            const settings = pinia._s.get('kam-settings')
            accounts.$patch((state) => {
                state.accounts = new Map(original.accounts)
                state.filter = { ...original.filter }
                state.activeGroupTab = original.activeGroupTab
                state.activeAccountId = original.activeAccountId
            })
            settings.$patch((state) => { state.usagePrecision = original.usagePrecision })
            if (original.groupStorage === null) localStorage.removeItem('accounts_activeGroupTab')
            else localStorage.setItem('accounts_activeGroupTab', original.groupStorage)
            delete window.__homeOriginal
        }`)
        await navigateHome()
    }
}

module.exports = { verifyHome }
