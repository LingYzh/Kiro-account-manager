/* Offline Proxy Pool checks use synthetic stores and IPC; no network proxy is contacted. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

let activeValidations = 0
let maxValidations = 0

async function mockProxyPool(name, args, scenario) {
    if (!scenario?.startsWith('proxy-pool-')) return undefined
    if (name === 'proxyPoolValidate') {
        activeValidations += 1
        maxValidations = Math.max(maxValidations, activeValidations)
        await new Promise((resolve) => setTimeout(resolve, 120))
        activeValidations -= 1
        if (scenario === 'proxy-pool-validate-fail')
            return { success: false, error: 'Synthetic proxy validation failure' }
        return { success: true, latencyMs: 125, externalIp: '192.0.2.77' }
    }
    if (name === 'proxyPoolDiagnoseChain') {
        await new Promise((resolve) => setTimeout(resolve, 90))
        if (scenario === 'proxy-pool-chain-fail')
            return { success: false, error: 'Synthetic chain failure' }
        return {
            success: true,
            diagnose: {
                upstreamReachable: true,
                upstreamRtMs: 11,
                targetReachable: true,
                targetRtMs: 22,
                endToEndOk: true,
                endToEndRtMs: 33,
                targetStatus: 200,
                targetStatusText: 'Connection Established',
                targetBodySnippet: 'synthetic response'
            }
        }
    }
    if (name === 'accountSetProxyBinding') return { success: true }
    return undefined
}

function seedProxyPool() {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const pool = pinia._s.get('kam-proxyPool')
    const accounts = pinia._s.get('kam-accounts')
    const persistence = pinia._s.get('kam-persistence')
    if (!pool || !accounts || !persistence) throw new Error('Proxy Pool stores unavailable')
    window.__proxyPoolFixture = {
        pool: new Map(pool.proxyPool),
        config: { ...pool.proxyPoolConfig },
        bindings: { ...pool.accountProxyBindings },
        cursor: pool.proxyPoolCursor,
        accounts: new Map(accounts.accounts),
        activeAccountId: accounts.activeAccountId,
        save: persistence.saveToStorage,
        clipboard: navigator.clipboard.writeText
    }
    window.__proxyPoolFixture.copied = ''
    persistence.saveToStorage = async () => {}
    navigator.clipboard.writeText = async (value) => {
        window.__proxyPoolFixture.copied = value
    }
    const now = Date.now()
    function makeProxy(id, options = {}) {
        return {
            id,
            url: options.url || `http://${id}.invalid:8080`,
            protocol: options.protocol || 'http',
            host: `${id}.invalid`,
            port: 8080,
            username: options.username,
            password: options.password,
            label: options.label,
            source: options.source || 'synthetic',
            tags: options.tags || [],
            status: options.status || 'untested',
            latencyMs: options.latencyMs,
            lastTestedAt: options.lastTestedAt,
            lastBoundEmail: options.lastBoundEmail,
            usedCount: options.usedCount || 0,
            failCount: options.failCount || 0,
            enabled: options.enabled !== false,
            createdAt: now
        }
    }
    window.__proxyPoolFixture.makeProxy = makeProxy
    const seeded = [
        makeProxy('proxy-pool-alive', {
            status: 'alive',
            latencyMs: 120,
            usedCount: 12,
            failCount: 2,
            lastTestedAt: now - 600000,
            label: 'Synthetic label',
            username: 'synthetic-user',
            password: 'synthetic-pass',
            url: 'http://synthetic-user:synthetic-pass@proxy-pool-alive.invalid:8080',
            tags: ['synthetic-blue']
        }),
        makeProxy('proxy-pool-slow', {
            status: 'slow',
            latencyMs: 3400,
            usedCount: 8,
            failCount: 1,
            lastTestedAt: now - 86400000,
            lastBoundEmail: 'bound@example.invalid'
        }),
        makeProxy('proxy-pool-dead', {
            status: 'dead',
            latencyMs: 1200,
            usedCount: 4,
            failCount: 9,
            enabled: false,
            lastTestedAt: now - 9 * 86400000
        }),
        makeProxy('proxy-pool-untested', { usedCount: 2, source: 'subscription' }),
        makeProxy('proxy-pool-disabled', { status: 'alive', latencyMs: 80, enabled: false })
    ]
    const accountItems = Array.from({ length: 14 }, (_, index) => ({
        id: `proxy-pool-account-${index}`,
        email: `proxy-pool-${index}@example.invalid`,
        nickname: `Proxy Account ${index}`,
        status: index === 13 ? 'expired' : 'active',
        idp: 'BuilderId',
        tags: [],
        createdAt: now,
        lastUsedAt: now,
        credentials: {
            accessToken: `synthetic-access-${index}`,
            refreshToken: `synthetic-refresh-${index}`,
            authMethod: 'IdC',
            region: 'us-east-1'
        },
        subscription: { type: 'Free', title: 'KIRO FREE', daysRemaining: 30 },
        usage: { current: 0, limit: 100, percentUsed: 0 }
    }))
    pool.$patch((state) => {
        state.proxyPool = new Map(seeded.map((entry) => [entry.id, entry]))
        state.proxyPoolConfig = {
            ...state.proxyPoolConfig,
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
        }
        state.accountProxyBindings = {}
        state.proxyPoolCursor = 0
    })
    accounts.$patch((state) => {
        state.accounts = new Map(accountItems.map((item) => [item.id, item]))
        state.activeAccountId = null
    })
}

function restoreProxyPool() {
    const saved = window.__proxyPoolFixture
    if (!saved) return
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const pool = pinia._s.get('kam-proxyPool')
    const accounts = pinia._s.get('kam-accounts')
    pinia._s.get('kam-persistence').saveToStorage = saved.save
    navigator.clipboard.writeText = saved.clipboard
    pool.$patch((state) => {
        state.proxyPool = new Map(saved.pool)
        state.proxyPoolConfig = { ...saved.config }
        state.accountProxyBindings = { ...saved.bindings }
        state.proxyPoolCursor = saved.cursor
    })
    accounts.$patch((state) => {
        state.accounts = new Map(saved.accounts)
        state.activeAccountId = saved.activeAccountId
    })
    delete window.__proxyPoolFixture
}

async function verifyProxyPool(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario } = harness
    const pool =
        "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-proxyPool')"
    const page = '[data-testid="page-proxyPool"]'

    async function navigate() {
        await click('#kam-navigation-tab-proxyPool', 'proxy pool page')
        await waitFor(
            `function () { return !!document.querySelector(${JSON.stringify(page)}) && document.querySelector('#kam-navigation-panel-proxyPool')?.classList.contains('is-active') }`,
            'proxy pool active'
        )
    }
    async function input(selector, value, event = 'input') {
        await run(
            `function () { const root = document.querySelector(${JSON.stringify(selector)}); const control = root?.matches('input,select,textarea') ? root : root?.querySelector('input,select,textarea'); if (!control) throw new Error('Missing proxy input: ' + ${JSON.stringify(selector)}); control.value = ${JSON.stringify(value)}; control.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })) }`
        )
    }
    async function answerConfirm(accept) {
        await waitFor(
            "function () { return !!document.querySelector('dialog.ui-confirm[open]') }",
            'proxy confirmation open'
        )
        await run(
            `function () { const buttons = document.querySelectorAll('dialog.ui-confirm[open] .ui-confirm-actions button'); buttons[${accept ? 1 : 0}].click() }`
        )
        await waitFor(
            "function () { return !document.querySelector('dialog.ui-confirm[open]') }",
            'proxy confirmation closed'
        )
    }
    function calls(name, start = 0) {
        return report.calls.slice(start).filter((entry) => entry.name === name)
    }

    setScenario('proxy-pool-normal')
    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    await run(seedProxyPool.toString())
    try {
        await navigate()
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=proxy-row-proxy-pool-alive]') }",
            'synthetic proxy row'
        )
        check(
            'Health dashboard uses total/max-success/positive active latency',
            await run(
                "function () { const text = document.querySelector('[data-testid=proxy-health]')?.textContent || ''; return text.includes('5 / 3') && text.includes('14 / 26') && text.includes('1200ms') && document.querySelector('[data-testid=proxy-top-used]')?.textContent.includes('Synthetic label') }"
            )
        )
        check(
            'Row displays redacted URL context and long label',
            await run(
                "function () { const row = document.querySelector('[data-testid=proxy-row-proxy-pool-alive]'); return row?.textContent.includes('Synthetic label') && !row?.textContent.includes('synthetic-pass') && !row?.getAttribute('title')?.includes('synthetic-pass') }"
            )
        )
        await screenshot('phase3-proxy-pool-light-zh')

        for (const strategy of ['random', 'least_used', 'fastest', 'round_robin'])
            await click(`[data-testid="proxy-strategy-${strategy}"]`, `strategy ${strategy}`)
        check(
            'Four strategies write the existing full config',
            await run(
                `function () { return ${pool}.proxyPoolConfig.strategy === 'round_robin' && ${pool}.proxyPoolConfig.failureThreshold === 3 }`
            )
        )
        await input('[data-testid="proxy-config-failure-threshold"]', '4')
        await input('[data-testid="proxy-config-interval"]', '0')
        await input('[data-testid="proxy-config-upstream"]', 'socks5://127.0.0.1:7890')
        check(
            'Config fields retain unknown settings while updating inputs',
            await run(
                `function () { const c = ${pool}.proxyPoolConfig; return c.failureThreshold === 4 && c.upstreamProxy === 'socks5://127.0.0.1:7890' && c.testTimeoutMs === 8000 }`
            )
        )

        const beforeChain = report.calls.length
        await click('[data-testid="proxy-chain-diagnose"]', 'three-stage chain diagnosis')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-chain-results]')?.textContent.includes('200') }",
            'chain stages visible'
        )
        check(
            'Diagnosis uses first enabled target and upstream config',
            calls('proxyPoolDiagnoseChain', beforeChain).length === 1 &&
                calls('proxyPoolDiagnoseChain', beforeChain)[0].args[0].targetUrl.includes(
                    'proxy-pool-alive.invalid'
                ) &&
                calls('proxyPoolDiagnoseChain', beforeChain)[0].args[0].upstreamProxy ===
                    'socks5://127.0.0.1:7890'
        )
        setScenario('proxy-pool-chain-fail')
        await click('[data-testid="proxy-chain-diagnose"]', 'failed chain diagnosis')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-chain-error]')?.textContent.includes('Synthetic chain failure') }",
            'chain failure visible'
        )
        setScenario('proxy-pool-normal')

        await input('[data-testid="proxy-add-input"]', 'http://new-proxy.invalid:8181')
        await click('[data-testid="proxy-add-submit"]', 'add one proxy')
        check(
            'Single add uses original parser and clears input',
            await run(
                `function () { const root = document.querySelector('[data-testid=proxy-add-input]'); const control = root?.matches('input') ? root : root?.querySelector('input'); return [...${pool}.proxyPool.values()].some((item) => item.host === 'new-proxy.invalid') && !control?.value }`
            )
        )
        await click('[data-testid="proxy-bulk-open"]', 'open bulk text import')
        await input(
            '[data-testid="proxy-bulk-input"]',
            'http://bulk-one.invalid:8080\nsocks5://bulk-two.invalid:1080\ninvalid-entry'
        )
        await click('[data-testid="proxy-bulk-submit"]', 'bulk import synthetic URLs')
        check(
            'Bulk import reports added/skipped/failed',
            await run(
                `function () { return ${pool}.proxyPool.size >= 8 && document.querySelector('[data-testid=proxy-pool-feedback]')?.textContent.includes('新增') }`
            )
        )

        await click('[data-testid="proxy-edit-proxy-pool-alive"]', 'edit inline proxy note')
        await input('[data-testid="proxy-label-input-proxy-pool-alive"]', '  Trimmed note  ')
        await run(
            "function () { const root = document.querySelector('[data-testid=proxy-label-input-proxy-pool-alive]'); const control = root?.matches('input') ? root : root?.querySelector('input'); control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }"
        )
        check(
            'Inline note trims on Enter',
            await run(
                `function () { return ${pool}.proxyPool.get('proxy-pool-alive').label === 'Trimmed note' }`
            )
        )
        await click('[data-testid="proxy-edit-proxy-pool-alive"]', 'edit proxy note again')
        await input('[data-testid="proxy-label-input-proxy-pool-alive"]', 'Discarded note')
        await run(
            "function () { const root = document.querySelector('[data-testid=proxy-label-input-proxy-pool-alive]'); const control = root?.matches('input') ? root : root?.querySelector('input'); control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) }"
        )
        check(
            'Escape cancels note without blur save',
            await run(
                `function () { return ${pool}.proxyPool.get('proxy-pool-alive').label === 'Trimmed note' }`
            )
        )
        await click('[data-testid="proxy-copy-proxy-pool-alive"]', 'copy true proxy URL')
        check(
            'Copy uses true URL but text stays redacted',
            await run(
                "function () { return window.__proxyPoolFixture.copied.includes('synthetic-pass') && !document.querySelector('[data-testid=proxy-row-proxy-pool-alive]')?.textContent.includes('synthetic-pass') }"
            )
        )

        await click('[data-testid="proxy-filter-advanced"]', 'open advanced proxy filters')
        await input('[data-testid="proxy-filter-latency"]', 'fast', 'change')
        check(
            'Fast latency means under 200ms',
            await run(
                "function () { return !!document.querySelector('[data-testid=proxy-row-proxy-pool-alive]') && !document.querySelector('[data-testid=proxy-row-proxy-pool-slow]') }"
            )
        )
        await input('[data-testid="proxy-filter-tested"]', '1h', 'change')
        check(
            'Time filter combines with latency',
            await run(
                "function () { return document.querySelectorAll('[data-testid^=proxy-row-]').length === 1 }"
            )
        )
        await input('[data-testid="proxy-filter-search"]', 'synthetic-user')
        await click('[data-testid="proxy-filter-reset-advanced"]', 'reset only advanced filters')
        check(
            'Advanced reset preserves search and status',
            await run(
                "function () { const root = document.querySelector('[data-testid=proxy-filter-search]'); const control = root?.matches('input') ? root : root?.querySelector('input'); return control?.value === 'synthetic-user' && document.querySelector('[data-testid=proxy-filter-status]')?.value === 'all' }"
            )
        )
        await click('[data-testid="proxy-filter-clear-all"]', 'clear proxy filters')

        await run(
            `function () { const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; const p = pinia._s.get('kam-proxyPool'); p.$patch((state) => { state.accountProxyBindings = Object.fromEntries(Array.from({ length: 11 }, (_, i) => ['proxy-pool-account-' + i, 'proxy-pool-alive'])) }) }`
        )
        check(
            'Overload warning threshold is greater than 10',
            await run(
                "function () { return document.querySelector('[data-testid=proxy-overloaded]')?.textContent.includes('1') }"
            )
        )
        await click('[data-testid="proxy-binding-details-toggle"]', 'show binding details')
        const candidateDiagnostic = await run(`function () {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
            const entries = [...pinia._s.get('kam-proxyPool').proxyPool.values()]
            const candidates = entries.filter((entry) => entry.enabled && entry.status !== 'dead')
            const section = document.querySelector('[data-testid=proxy-bindings-section]')
            const labels = [...(section?.querySelectorAll('.kam-muted') || [])]
            const label = labels.find((node) => node.textContent.trim() === '可用代理')
            return {
                pass: candidates.length === 6 && candidates.some((entry) => entry.id === 'proxy-pool-untested') && label?.nextElementSibling?.textContent.trim() === String(candidates.length),
                locale: document.documentElement.lang,
                entries: entries.map((entry) => ({ id: entry.id, enabled: entry.enabled, status: entry.status })),
                candidates: candidates.map((entry) => entry.id),
                section: section?.textContent.slice(0, 250),
                labels: labels.map((node) => ({ text: node.textContent.trim(), next: node.nextElementSibling?.textContent.trim() }))
            }
        }`)
        check(
            'Enabled untested proxy is a distribution candidate',
            candidateDiagnostic.pass,
            candidateDiagnostic
        )
        await click('[data-testid="proxy-unbind-proxy-pool-account-0"]', 'unbind one account')
        check(
            'Individual unbind preserves others',
            await run(
                `function () { const b = ${pool}.accountProxyBindings; return !b['proxy-pool-account-0'] && b['proxy-pool-account-1'] === 'proxy-pool-alive' }`
            )
        )
        await click('[data-testid="proxy-unbind-all"]', 'cancel all unbind')
        await answerConfirm(false)
        check(
            'Cancel all unbind retains bindings',
            await run(
                `function () { return Object.keys(${pool}.accountProxyBindings).length === 10 }`
            )
        )
        await click('[data-testid="proxy-unbind-all"]', 'confirm all unbind')
        await answerConfirm(true)
        await waitFor(
            `function () { return Object.keys(${pool}.accountProxyBindings).length === 0 }`,
            'all bindings cleared'
        )
        await click('[data-testid="proxy-bind-unbound"]', 'bind unbound with default cap')
        check(
            'Default cap 5 uses all eligible enabled non-dead proxies',
            await run(
                `function () { const b = ${pool}.accountProxyBindings; const counts = Object.values(b).reduce((acc, id) => (acc[id] = (acc[id] || 0) + 1, acc), {}); return Object.keys(b).length === 13 && Object.keys(counts).length >= 3 && Object.values(counts).every((count) => count <= 5) }`
            )
        )
        await input('[data-testid="proxy-accounts-per-proxy"]', '0')
        await click('[data-testid="proxy-bind-all"]', 'redistribute evenly')
        check(
            'Zero cap evenly redistributes active accounts only',
            await run(
                `function () { const b = ${pool}.accountProxyBindings; const counts = Object.values(b).reduce((acc, id) => (acc[id] = (acc[id] || 0) + 1, acc), {}); const values = Object.values(counts); return Object.keys(b).length === 13 && !b['proxy-pool-account-13'] && Math.max(...values) - Math.min(...values) <= 1 }`
            )
        )

        setScenario('proxy-pool-validate-fail')
        await click('[data-testid="proxy-test-proxy-pool-alive"]', 'failed single validation')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-pool-error]')?.textContent.includes('Synthetic proxy validation failure') }",
            'validation failure visible'
        )
        setScenario('proxy-pool-normal')
        await input('[data-testid="proxy-test-concurrency"]', '2')
        maxValidations = 0
        const beforeBatch = report.calls.length
        await click('[data-testid="proxy-test-all"]', 'batch validate proxies')
        await click('[data-testid="proxy-test-all"]', 'duplicate batch click locked')
        await waitFor(
            "function () { return !document.querySelector('[data-testid=proxy-test-all]')?.disabled }",
            'batch validation completed',
            12000
        )
        check(
            'Batch validation respects concurrency and duplicate lock',
            maxValidations <= 2 &&
                maxValidations >= 1 &&
                calls('proxyPoolValidate', beforeBatch).length >= 8 &&
                calls('proxyPoolValidate', beforeBatch).length < 16
        )

        await run(
            `function () { const p = ${pool}; const make = window.__proxyPoolFixture.makeProxy; p.$patch((state) => { state.proxyPool = new Map(Array.from({ length: 60 }, (_, i) => { const item = make('proxy-pool-stress-' + i); return [item.id, item] })) }) }`
        )
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=proxy-list-virtual]') }",
            'virtual proxy list'
        )
        check(
            'Virtual list bounds rendered rows for 60 records',
            await run(
                "function () { const root = document.querySelector('[data-testid=proxy-list-virtual]'); return root.querySelectorAll('[data-testid^=proxy-row-]').length > 0 && root.querySelectorAll('[data-testid^=proxy-row-]').length < 50 }"
            )
        )
        await click('#kam-navigation-tab-home', 'hide virtual proxy pool')
        await navigate()
        check(
            'Virtual list survives hidden navigation',
            await run(
                "function () { return document.querySelector('[data-testid=proxy-list-virtual]')?.querySelectorAll('[data-testid^=proxy-row-]').length < 50 }"
            )
        )
        await chooseMenu(0, 1)
        await chooseMenu(1, 2)
        await screenshot('phase3-proxy-pool-dark-en')
    } finally {
        setScenario('proxy-pool-normal')
        await run(restoreProxyPool.toString())
        await click('#kam-navigation-tab-home', 'leave proxy pool')
    }
}

module.exports = { mockProxyPool, verifyProxyPool }
