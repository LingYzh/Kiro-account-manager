/* Registration UI regression uses synthetic results, temporary storage and no production main. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
let serial = 0
let activeRequests = 0
let maxRequests = 0
const attempts = new Map()

function registrationResult(email = `register-${++serial}@example.invalid`) {
    return {
        status: 'success',
        email,
        password: 'synthetic-password',
        accessToken: 'synthetic-register-access',
        refreshToken: 'synthetic-register-refresh',
        clientId: 'synthetic-register-client',
        clientSecret: 'synthetic-register-secret',
        region: 'eu-west-1',
        verify: {
            alive: true,
            email,
            subscription: 'KIRO PRO_PLUS',
            credit_used: 5,
            credit_limit: 50
        }
    }
}

async function mockRegistration(name, args, scenario, emit) {
    if (name === 'registrationStatus') return { inProgress: false }
    if (!scenario?.startsWith('register-')) return undefined
    if (name === 'registrationManualPhase1') {
        if (scenario === 'register-slow-manual')
            await new Promise((resolve) => setTimeout(resolve, 350))
        return { success: true }
    }
    if (name === 'registrationManualPhase2') return { success: true }
    if (name === 'registrationManualPhase3' && scenario === 'register-manual-failed')
        return {
            success: true,
            result: {
                status: 'failed',
                email: 'manual-failed@example.invalid',
                error: 'Synthetic SSO rejection'
            }
        }
    if (name === 'registrationManualPhase3')
        return { success: true, result: registrationResult('manual-register@example.invalid') }
    if (name === 'registrationCancel') {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { success: true }
    }
    if (name === 'registrationStartAuto') {
        activeRequests++
        maxRequests = Math.max(maxRequests, activeRequests)
        const count = (attempts.get(args[0].taskId) || 0) + 1
        attempts.set(args[0].taskId, count)
        try {
            await new Promise((resolve) =>
                setTimeout(resolve, scenario === 'register-slow-batch' ? 350 : 120)
            )
            if (scenario === 'register-retry' && count === 1)
                return {
                    success: false,
                    result: {
                        status: 'failed',
                        email: 'retry@example.invalid',
                        error: 'Synthetic network timeout'
                    }
                }
            const result = registrationResult()
            if (!args[0].taskId) emit('mock-registration-complete', result)
            return { success: true, result }
        } finally {
            activeRequests--
        }
    }
    if (name === 'verifyAccountCredentials')
        return {
            success: true,
            data: {
                email: 'manual-register@example.invalid',
                accessToken: 'synthetic-register-verified',
                subscriptionType: 'Pro',
                subscriptionTitle: 'Verified KIRO PRO',
                expiresIn: 3600,
                usage: { current: 5, limit: 50, baseCurrent: 5, baseLimit: 50 }
            }
        }
    if (name === 'accountGetSubscriptionUrl')
        return { success: true, url: 'https://example.invalid/register-link' }
    if (name === 'protonLoginStatus') return { loggedIn: true }
    if (name === 'protonOpenLogin') return { success: true, loggedIn: true }
    if (name === 'protonClose') return { success: true }
    return undefined
}

async function verifyRegistration(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, setScenario, report, emitEvent } =
        harness
    const suiteCallStart = report.calls.length
    const calls = (name, after = suiteCallStart) =>
        report.calls.slice(after).filter((call) => call.name === name)
    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    setScenario('register-normal')
    await click('#kam-navigation-tab-register', 'Register page')
    await waitFor(
        "function () { return Boolean(document.querySelector('[data-testid=page-register]')) }",
        'Register mounted'
    )
    await run(`function () {
        const app = document.querySelector('#app').__vue_app__
        function find(vnode) {
            if (!vnode) return
            if (vnode.component?.type.__name === 'RegisterPage') return vnode.component.setupState.state
            if (vnode.component) { const value = find(vnode.component.subTree); if (value) return value }
            if (Array.isArray(vnode.children)) for (const child of vnode.children) { const value = find(child); if (value) return value }
        }
        const state = find(app._container._vnode)
        if (!state) throw new Error('Register composable unavailable')
        const pinia = app.config.globalProperties.$pinia
        const accounts = pinia._s.get('kam-accounts'), pool = pinia._s.get('kam-proxyPool')
        window.__registerFixture = {
            state, accounts, pool, originalAccounts: new Map(accounts.accounts),
            originalPool: new Map(pool.proxyPool), poolConfig: { ...pool.proxyPoolConfig },
            config: JSON.parse(JSON.stringify(state.config)),
            history: state.history, templates: state.templates, blacklist: state.blacklist,
            quotaLimit: state.dailyQuotaLimit, rateEnabled: state.rateLimitEnabled,
            scheduleEnabled: state.scheduleEnabled
        }
        state.scheduleEnabled = false; state.rateLimitEnabled = false; state.dailyQuotaLimit = 0
        state.history = []; state.config.mode = 'manual'; state.config.manualParentEmail = ''
        state.config.manualAnonymousEmail = false; state.config.batchAutoImport = false
        state.config.autoFetchProLink = false; state.config.fullName = 'Synthetic Name'
        pool.proxyPoolConfig.enabled = false
    }`)
    const state = 'window.__registerFixture.state'
    async function waitPhase(value) {
        await waitFor(
            `function () { return ${state}.phase === ${JSON.stringify(value)} }`,
            `Register phase ${value}`
        )
    }
    async function input(id, value) {
        await run(`function () {
            const root = document.querySelector('[data-testid=${id}]')
            const control = root?.matches('input,textarea') ? root : root?.querySelector('input,textarea')
            if (!control) throw new Error('Register control missing: ${id}')
            control.value = ${JSON.stringify(value)}; control.dispatchEvent(new Event('input', { bubbles: true }))
        }`)
    }
    try {
        await click('[data-testid=register-start]', 'start manual registration')
        await waitPhase('email')
        check(
            'Active manual flow locks configuration while email entry stays usable',
            await run(`function () {
                const fullName = document.querySelector('[data-testid=register-full-name]')
                const email = document.querySelector('[data-testid=register-email]')
                const input = root => root?.matches('input') ? root : root?.querySelector('input')
                return input(fullName)?.disabled && !input(email)?.disabled &&
                    [...document.querySelectorAll('[data-testid^=register-mode-]')].every(button => button.disabled)
            }`)
        )
        check(
            'Manual phase 1 preserves full name',
            calls('registrationManualPhase1').at(-1).args[0].fullName === 'Synthetic Name'
        )
        await input('register-email', 'manual-register@example.invalid')
        await click('[data-testid=register-submit-email]', 'submit registration email')
        await waitPhase('otp')
        check(
            'Manual phase 2 exact email and name',
            JSON.stringify(calls('registrationManualPhase2').at(-1).args) ===
                JSON.stringify(['manual-register@example.invalid', 'Synthetic Name'])
        )
        await input('register-otp', '123456')
        await click('[data-testid=register-submit-otp]', 'submit OTP')
        await waitPhase('done')
        check(
            'Manual final result and one history row',
            await run(
                `function () { return ${state}.result.status === 'success' && ${state}.history.length === 1 }`
            )
        )
        await click('[data-testid=register-import]', 'import manual result')
        await waitFor(`function () { return ${state}.imported }`, 'manual import')
        check(
            'Manual import always verifies, excludes password and preserves original percent unit',
            calls('verifyAccountCredentials').length === 1 &&
                (await run(
                    `function () { const a = [...window.__registerFixture.accounts.accounts.values()].find(a => a.email === 'manual-register@example.invalid'); return !a.password && a.credentials.accessToken === 'synthetic-register-verified' && a.usage.percentUsed === 10 }`
                ))
        )
        await screenshot('phase3-register-manual-light-zh')
        await click('[data-testid=register-reset]', 'reset registration')
        await waitPhase('idle')
        await run(`function () { ${state}.config.batchAutoImport = true }`)
        const beforeManualAuto = report.calls.length
        await click('[data-testid=register-start]', 'start manual registration with automatic import')
        await waitPhase('email')
        await input('register-email', 'manual-register@example.invalid')
        await click('[data-testid=register-submit-email]', 'submit automatic-import email')
        await waitPhase('otp')
        await input('register-otp', '123456')
        await click('[data-testid=register-submit-otp]', 'submit automatic-import OTP')
        await waitPhase('finalized')
        check(
            'Manual automatic import retains password and uses successful registration verification',
            calls('verifyAccountCredentials', beforeManualAuto).length === 0 &&
                (await run(`function () {
                    const account = [...window.__registerFixture.accounts.accounts.values()].reverse().find(a => a.email === 'manual-register@example.invalid')
                    return ${state}.imported && account.password === 'synthetic-password' &&
                        account.credentials.accessToken === 'synthetic-register-access'
                }`))
        )
        await click('[data-testid=register-reset]', 'reset automatic-import registration')
        await waitPhase('idle')
        await run(`function () { ${state}.config.batchAutoImport = false }`)
        setScenario('register-slow-manual')
        const beforeSlow = report.calls.length
        await click('[data-testid=register-start]', 'start delayed manual phase')
        await waitPhase('initializing')
        await click('[data-testid=register-cancel]', 'cancel delayed manual phase')
        await waitPhase('idle')
        await new Promise((resolve) => setTimeout(resolve, 400))
        check(
            'Cancelled phase cannot revive email step',
            (await run(`function () { return ${state}.phase === 'idle' }`)) &&
                calls('registrationManualPhase1', beforeSlow).length === 1
        )

        setScenario('register-normal')
        await run(
            `function () { Object.assign(${state}.config, { mode: 'outlook', outlookData: 'single@example.invalid----synthetic-pass', batchAutoImport: true, autoFetchProLink: true }) }`
        )
        const beforeSingle = report.calls.length
        const historyBefore = await run(`function () { return ${state}.history.length }`)
        await click('[data-testid=register-start]', 'start single Outlook registration')
        await waitPhase('finalized')
        await new Promise((resolve) => setTimeout(resolve, 170))
        check(
            'Single complete event plus invoke result is imported once',
            (await run(
                `function () { return ${state}.history.length === ${historyBefore + 1} && ${state}.imported }`
            )) && calls('verifyAccountCredentials', beforeSingle).length === 0
        )
        check(
            'Registered links share subscription state and retain generation time',
            await run(
                `function () { const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-subscription'); return s.links.some(link => link.url === 'https://example.invalid/register-link' && link.generatedAt > 0) }`
            )
        )
        const linkArgs = calls('accountGetSubscriptionUrl', beforeSingle).at(-1).args
        check(
            'Registration subscription URL uses original eight arguments',
            linkArgs.length === 8 &&
                linkArgs[2] === 'eu-west-1' &&
                linkArgs[5] === 'BuilderId' &&
                linkArgs[6] === 'IdC' &&
                linkArgs[7] === undefined
        )
        await run(
            `function () { ${state}.reset(); Object.assign(${state}.config, { batchAutoImport: false, autoFetchProLink: false, protonBaseEmail: 'protonfixture@example.invalid', gptMailBaseURL: ' https://mail.example.invalid ', gptMailInboxEmail: ' inbox@example.invalid ', gptMailDomain: 'example.invalid', gptMailPrefix: ' synthetic ', gptMailPrivatePassword: 'synthetic-private' }) }`
        )
        for (const mode of ['proton', 'gptmail']) {
            await click(`[data-testid=register-mode-${mode}]`, `select ${mode} registration`)
            const beforeSource = report.calls.length
            await click('[data-testid=register-start]', `register with ${mode}`)
            await waitPhase('done')
            const payload = calls('registrationStartAuto', beforeSource).at(-1).args[0]
            check(
                `${mode} preserves source configuration`,
                mode === 'proton'
                    ? payload.useProton && payload.protonEmail.endsWith('@example.invalid')
                    : payload.useGptMail &&
                          payload.gptMailBaseURL === 'https://mail.example.invalid' &&
                          payload.gptMailInboxEmail === 'inbox@example.invalid' &&
                          payload.gptMailPrefix === 'synthetic' &&
                          payload.gptMailPrivatePassword === 'synthetic-private'
            )
            await click('[data-testid=register-reset]', `reset ${mode} registration`)
        }
        await click('[data-testid=register-mode-mixed]', 'select mixed source')
        await run(
            `function () { Object.assign(${state}.config, { mixedEnabledSources: ['gptmail'], batchCount: 2, batchConcurrency: 1, batchInterval: 0, batchRetries: 0 }); ${state}.mixedWeights.gptmail = 3 }`
        )
        const beforeMixed = report.calls.length
        await click('[data-testid=register-batch-start]', 'mixed configured source batch')
        await waitFor(
            `function () { return !${state}.batchRunning && ${state}.batchDone === 2 }`,
            'mixed batch completes'
        )
        check(
            'Mixed dispatch respects configured source eligibility and task IDs',
            calls('registrationStartAuto', beforeMixed).length === 2 &&
                calls('registrationStartAuto', beforeMixed).every(
                    (call) => call.args[0].useGptMail && call.args[0].taskId
                )
        )
        await click('[data-testid=register-mode-manual]', 'return to manual mode')
        setScenario('register-manual-failed')
        await click('[data-testid=register-start]', 'start manual failure scenario')
        await waitPhase('email')
        await input('register-email', 'manual-failed@example.invalid')
        await click('[data-testid=register-submit-email]', 'submit failing manual email')
        await waitPhase('otp')
        await input('register-otp', '654321')
        await click('[data-testid=register-submit-otp]', 'manual SSO failure')
        await waitPhase('idle')
        check(
            'Manual failed result restores idle phase',
            await run(`function () { return ${state}.result.status === 'failed' }`)
        )
        setScenario('register-normal')
        await run(
            `function () { ${state}.reset(); Object.assign(${state}.config, { mode: 'tempmail', tempMailEmail: 'mail@example.invalid', tempMailEpin: 'synthetic-epin', tempMailDomain: 'example.invalid', batchCount: 4, batchConcurrency: 2, batchInterval: 0, batchRetries: 0, batchAutoImport: false, autoFetchProLink: false }) }`
        )
        maxRequests = 0
        const beforeBatch = report.calls.length
        await click('[data-testid=register-batch-start]', 'start concurrent batch')
        await waitFor(
            `function () { return !${state}.batchRunning && ${state}.batchDone === 4 }`,
            'four registration tasks complete'
        )
        check(
            'Batch concurrency bounded at two and task IDs unique',
            maxRequests === 2 &&
                new Set(
                    calls('registrationStartAuto', beforeBatch).map((call) => call.args[0].taskId)
                ).size === 4
        )
        check(
            'Batch source credential contract remains exact',
            calls('registrationStartAuto', beforeBatch).every(
                (call) =>
                    call.args[0].useTempMailPlus &&
                    call.args[0].tempMailPlusEpin === 'synthetic-epin'
            )
        )

        await run(
            `function () { ${state}.config.batchCount = 6; ${state}.dailyQuotaLimit = ${state}.dailyQuotaUsed + 2 }`
        )
        const beforeQuota = report.calls.length
        await click('[data-testid=register-batch-start]', 'batch remaining daily quota')
        await waitFor(
            `function () { return !${state}.batchRunning && ${state}.batchDone === 2 }`,
            'daily quota truncates queue'
        )
        check(
            'Quota truncates actual IPC starts',
            calls('registrationStartAuto', beforeQuota).length === 2
        )
        await run(
            `function () { ${state}.dailyQuotaLimit = 0; ${state}.config.batchCount = 1; ${state}.config.batchRetries = 1 }`
        )
        setScenario('register-retry')
        const beforeRetry = report.calls.length
        await click('[data-testid=register-batch-start]', 'retry failed registration')
        await waitFor(
            `function () { return !${state}.batchRunning && ${state}.batchDone === 1 }`,
            'failed task retried'
        )
        check(
            'Retry repeats same task ID and records success once',
            calls('registrationStartAuto', beforeRetry).length === 2 &&
                (await run(
                    `function () { return ${state}.batchSuccess === 1 && ${state}.batchFail === 0 }`
                ))
        )

        setScenario('register-slow-batch')
        await run(
            `function () { Object.assign(${state}.config, { batchCount: 2, batchConcurrency: 1, batchRetries: 0, batchInterval: 0 }) }`
        )
        const beforePause = report.calls.length
        await click('[data-testid=register-batch-start]', 'batch to pause')
        await waitFor(
            `function () { return ${state}.batchItems.some(item => item.status === 'running') }`,
            'pause target active'
        )
        await click('[data-testid=register-batch-pause]', 'pause registration dispatch')
        await new Promise((resolve) => setTimeout(resolve, 450))
        check(
            'Pause allows in-flight completion and prevents next dispatch',
            calls('registrationStartAuto', beforePause).length === 1 &&
                (await run(`function () { return ${state}.batchPaused }`))
        )
        await click('[data-testid=register-batch-resume]', 'resume registration dispatch')
        await waitFor(
            `function () { return !${state}.batchRunning && ${state}.batchDone === 2 }`,
            'paused batch resumed'
        )
        check(
            'Resume starts remaining task exactly once',
            calls('registrationStartAuto', beforePause).length === 2
        )

        setScenario('register-slow-batch')
        await run(
            `function () { Object.assign(${state}.config, { batchCount: 5, batchConcurrency: 1, batchRetries: 0, batchInterval: 0 }) }`
        )
        const beforeStop = report.calls.length
        await click('[data-testid=register-batch-start]', 'start batch to cancel')
        await waitFor(
            `function () { return ${state}.batchItems.some(item => item.status === 'running') }`,
            'batch task started'
        )
        await click('[data-testid=register-batch-stop]', 'stop registration batch')
        await waitFor(
            `function () { return !${state}.batchRunning && !${state}.cancelling }`,
            'batch stops'
        )
        await new Promise((resolve) => setTimeout(resolve, 400))
        check(
            'Cancelled batch launches no later tasks and task center remains cancelled',
            calls('registrationStartAuto', beforeStop).length === 1 &&
                (await run(
                    `function () { const tasks = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-tasks'); return [...tasks.tasks.values()].filter(t => t.kind === 'register-batch').at(-1).status === 'cancelled' && ${state}.phase === 'idle' }`
                ))
        )
        setScenario('register-normal')
        await run(
            `function () { window.__registerFixture.pool.proxyPool = new Map(); window.__registerFixture.pool.proxyPoolConfig.enabled = true; ${state}.config.batchCount = 1 }`
        )
        const beforeStrict = report.calls.length
        await click('[data-testid=register-batch-start]', 'strict empty proxy pool')
        await waitFor(
            `function () { return !${state}.batchRunning && ${state}.batchFail === 1 }`,
            'strict proxy failure'
        )
        check(
            'Enabled empty pool refuses direct registration IPC',
            calls('registrationStartAuto', beforeStrict).length === 0
        )
        await run(`function () {
            const state = ${state}; window.__registerFixture.pool.proxyPoolConfig.enabled = false
            state.saveTemplate('Synthetic template')
            const template = state.templates[0]
            state.importTemplates(JSON.stringify([{ ...template, name: 'Updated synthetic template' }]))
            state.config.mode = 'outlook'; state.applyTemplate(state.templates[0])
        }`)
        check(
            'Templates dedupe IDs, imported values win and restore full config',
            await run(
                `function () { return ${state}.templates.length === 1 && ${state}.templates[0].name === 'Updated synthetic template' && ${state}.config.mode === 'tempmail' }`
            )
        )
        const beforeLate = await run(`function () { return ${state}.history.length }`)
        emitEvent('mock-registration-complete', registrationResult('late-register@example.invalid'))
        await new Promise((resolve) => setTimeout(resolve, 100))
        check(
            'Idle completion cannot mutate history',
            await run(`function () { return ${state}.history.length === ${beforeLate} }`)
        )
        await chooseMenu(0, 1)
        await chooseMenu(1, 2)
        await screenshot('phase3-register-dark-en')
    } finally {
        await run(`function () {
            const f = window.__registerFixture, state = f.state
            state.scheduleEnabled = false; state.reset(); Object.assign(state.config, f.config)
            state.history = f.history; state.templates = f.templates; state.blacklist = f.blacklist
            state.dailyQuotaLimit = f.quotaLimit; state.rateLimitEnabled = f.rateEnabled
            f.accounts.accounts = f.originalAccounts; f.pool.proxyPool = f.originalPool
            f.pool.proxyPoolConfig = f.poolConfig
        }`)
        setScenario('update-available')
        await click('#kam-navigation-tab-home', 'leave Register fixture')
    }
}

module.exports = { mockRegistration, verifyRegistration }
