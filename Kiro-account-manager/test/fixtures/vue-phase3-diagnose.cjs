/* Offline Diagnose checks drive the mounted Vue page with synthetic accounts and IPC. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
const targetIds = [
    'public-ip',
    'cloudflare',
    'kiro-auth',
    'kiro-oidc',
    'kiro-codewhisperer',
    'aws-signin',
    'tempmail-plus',
    'outlook-login',
    'custom-probe'
]
const syntheticProxy = 'http://synthetic:secret@proxy.invalid:8080'

async function mockDiagnose(name, args, scenario) {
    if (name === 'proxyGetModels') {
        if (scenario === 'diagnose-proxy-models') {
            return {
                success: true,
                models: [{ id: 'synthetic-proxy-model', name: 'Synthetic Proxy Model' }]
            }
        }
        return { success: true, models: [] }
    }
    if (name === 'getKiroAvailableModels') {
        return { models: [{ id: 'synthetic-kiro-model', name: 'Synthetic Kiro Model' }] }
    }
    if (name === 'diagnoseRun') {
        return {
            results: args[0].targets.map((target) => ({
                id: target.id,
                label: target.label,
                url: target.url,
                success: target.id !== 'cloudflare',
                httpStatus: target.id === 'cloudflare' ? 503 : 200,
                latencyMs: 12,
                ...(target.id === 'cloudflare' ? { error: 'Synthetic unreachable endpoint' } : {})
            }))
        }
    }
    if (name === 'diagnoseAccountLiveness') {
        if (scenario === 'diagnose-slow-liveness') {
            await new Promise((resolve) => setTimeout(resolve, 850))
        }
        const account = args[0].account
        const index = Number(account.email.match(/synthetic(\d+)/)?.[1] || 0)
        return index % 2
            ? { success: false, latencyMs: 23, error: `Synthetic liveness failure ${index}` }
            : {
                  success: true,
                  latencyMs: 18,
                  model: args[0].model,
                  content: `pong synthetic${index}`,
                  usage: { inputTokens: 2, outputTokens: 3, credits: 0.1 }
              }
    }
    return undefined
}

async function verifyDiagnose(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario } = harness
    const calls = (name) => report.calls.filter((call) => call.name === name)
    const page = '[data-testid="page-diagnose"]'

    async function input(selector, value, event = 'input') {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(selector)})
            const control = root?.matches('input,select,textarea') ? root : root?.querySelector('input,select,textarea')
            if (!control) throw new Error('Missing control: ' + ${JSON.stringify(selector)})
            control.value = ${JSON.stringify(value)}
            control.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }))
        }`)
    }

    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    await run(`function () {
        localStorage.removeItem('kiro-diagnose-probe-url')
        localStorage.setItem('kiro-diagnose-moemail', 'legacy-probe.invalid/health')
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        const accounts = pinia._s.get('kam-accounts')
        const proxy = pinia._s.get('kam-proxyPool')
        if (!accounts || !proxy) throw new Error('Missing public account/proxy stores')
        window.__diagnoseExistingIds = [...accounts.accounts.keys()]
        const ids = []
        for (let index = 0; index < 6; index++) {
            ids.push(accounts.addAccount({
                email: 'synthetic' + index + '@example.invalid',
                idp: 'Google',
                credentials: {
                    accessToken: 'synthetic-access-' + index,
                    refreshToken: 'synthetic-refresh-' + index,
                    csrfToken: 'synthetic-csrf-' + index,
                    clientId: 'synthetic-client-' + index,
                    clientSecret: 'synthetic-secret-' + index,
                    region: 'us-east-1',
                    authMethod: 'social',
                    provider: 'Google',
                    expiresAt: 4102444800000
                },
                profileArn: 'arn:aws:synthetic:profile/' + index,
                machineId: 'synthetic-machine-' + index,
                subscription: { type: 'Free' },
                usage: { current: 0, limit: 100, percentUsed: 0, lastUpdated: Date.now() },
                status: 'active',
                tags: []
            }))
        }
        proxy.$patch((state) => {
            state.proxyPool = new Map(state.proxyPool).set('synthetic-proxy', {
                id: 'synthetic-proxy', url: ${JSON.stringify(syntheticProxy)},
                protocol: 'http', host: 'proxy.invalid', port: 8080,
                status: 'alive', enabled: true, usedCount: 0, failCount: 0, createdAt: Date.now()
            })
            state.accountProxyBindings = { ...state.accountProxyBindings, [ids[0]]: 'synthetic-proxy' }
        })
        accounts.deselectAll()
        for (const id of ids) accounts.selectAccount(id)
        window.__diagnoseIds = ids
    }`)
    await click('#kam-navigation-tab-diagnose', 'diagnose page')
    await waitFor(
        `function () { return Boolean(document.querySelector(${JSON.stringify(page)})) }`,
        'diagnose mounted'
    )
    check(
        'legacy URL migrated once',
        await run(`function () {
        return localStorage.getItem('kiro-diagnose-probe-url') === 'legacy-probe.invalid/health' &&
            localStorage.getItem('kiro-diagnose-moemail') === null &&
            document.querySelector('#diagnose-probe-url')?.value === 'legacy-probe.invalid/health'
    }`)
    )
    check(
        'selected mode inferred from account selection',
        await run(`function () {
        const page = document.querySelector(${JSON.stringify(page)})
        return page.querySelector('[data-testid="liveness-run"]')?.textContent.includes('6')
    }`)
    )
    await waitFor(
        `function () { return localStorage.getItem('kiro-liveness-models-cache')?.includes('synthetic-kiro-model') }`,
        'Kiro model fallback cached'
    )
    check(
        'model source fallback',
        calls('proxyGetModels').length >= 1 && calls('getKiroAvailableModels').length >= 1
    )

    await input('#diagnose-probe-url', 'custom-probe.invalid/health')
    await click('[data-testid="diagnose-run"]', 'run synthetic network diagnostics')
    await waitFor(
        `function () { return document.querySelector(${JSON.stringify(page)})?.textContent.includes('Synthetic unreachable endpoint') && !document.querySelector('[data-testid="diagnose-run"]').disabled }`,
        'network results settled'
    )
    const networkCalls = calls('diagnoseRun')
    check(
        'nine targets in ordered 4+4+1 batches',
        networkCalls.length === 3 &&
            networkCalls.map((call) => call.args[0].targets.length).join(',') === '4,4,1' &&
            networkCalls
                .flatMap((call) => call.args[0].targets.map((target) => target.id))
                .join(',') === targetIds.join(',')
    )
    check(
        'network target IPC fields',
        networkCalls.every(
            (call) =>
                call.args[0].proxyUrl === undefined &&
                call.args[0].targets.every(
                    (target) =>
                        typeof target.id === 'string' &&
                        typeof target.label === 'string' &&
                        typeof target.url === 'string' &&
                        Object.keys(target).sort().join(',') === 'expectStatus,id,label,url'
                )
        ) &&
            networkCalls[2].args[0].targets[0].url === 'https://custom-probe.invalid/health' &&
            networkCalls[2].args[0].targets[0].expectStatus.join(',') ===
                '200,201,204,301,302,400,401,403,404,405'
    )
    check(
        'custom probe saved after run',
        await run(
            `function () { return localStorage.getItem('kiro-diagnose-probe-url') === 'custom-probe.invalid/health' }`
        )
    )
    await screenshot('phase3-diagnose-light-zh')

    await run(`function () {
        window.__diagnoseCopied = ''
        navigator.clipboard.writeText = async (text) => { window.__diagnoseCopied = text }
    }`)
    await run(
        `function () { const button = [...document.querySelectorAll(${JSON.stringify(page + ' button')})].find((item) => item.textContent.includes('复制报告')); if (!button) throw new Error('Missing copy report'); button.click() }`
    )
    await waitFor(
        `function () { return window.__diagnoseCopied.includes('custom-probe.invalid/health') }`,
        'clipboard diagnostic report'
    )
    check(
        'original clipboard report lines',
        await run(`function () {
        return window.__diagnoseCopied.startsWith('Kiro Account Manager - 诊断报告') &&
            window.__diagnoseCopied.includes('[公网连通性]') &&
            window.__diagnoseCopied.includes('HTTP: 503') &&
            window.__diagnoseCopied.includes('✗ 失败')
    }`)
    )

    await click(`${page} input[type="checkbox"]`, 'enable diagnostic proxy')
    await input('[aria-label="代理"]', 'synthetic-proxy', 'change')
    await click('[data-testid="diagnose-run"]', 'run diagnostics through synthetic proxy')
    await waitFor(
        `function () { return !document.querySelector('[data-testid="diagnose-run"]').disabled }`,
        'proxy run settled'
    )
    check(
        'network proxy forwarded to all batches',
        calls('diagnoseRun').length === 6 &&
            calls('diagnoseRun')
                .slice(3)
                .every((call) => call.args[0].proxyUrl === syntheticProxy)
    )

    setScenario('diagnose-proxy-models')
    await run(
        `function () { const button = [...document.querySelectorAll(${JSON.stringify(page + ' button')})].find((item) => item.textContent.includes('个缓存')); if (!button) throw new Error('Missing model refresh'); button.click() }`
    )
    await waitFor(
        `function () { return localStorage.getItem('kiro-liveness-models-cache')?.includes('synthetic-proxy-model') }`,
        'proxy model cache refresh'
    )
    await input('#diagnose-model', 'arbitrary-synthetic-model')
    check(
        'arbitrary model persisted',
        await run(
            `function () { return localStorage.getItem('kiro-liveness-model') === 'arbitrary-synthetic-model' }`
        )
    )

    setScenario('diagnose-slow-liveness')
    const beforeSlow = calls('diagnoseAccountLiveness').length
    await click('[data-testid="liveness-run"]', 'run selected accounts')
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="liveness-stop"]')) }`,
        'batch stop available'
    )
    const workerDeadline = Date.now() + 500
    while (
        calls('diagnoseAccountLiveness').length < beforeSlow + 3 &&
        Date.now() < workerDeadline
    ) {
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
    check(
        'exactly three initial workers',
        calls('diagnoseAccountLiveness').length === beforeSlow + 3
    )
    const sample = calls('diagnoseAccountLiveness')[beforeSlow].args[0]
    check(
        'liveness IPC credentials and fields',
        sample.model === 'arbitrary-synthetic-model' &&
            sample.message === 'Hi, reply with "pong" only.' &&
            sample.account.email.startsWith('synthetic') &&
            sample.account.accessToken.startsWith('synthetic-access-') &&
            sample.account.refreshToken.startsWith('synthetic-refresh-') &&
            sample.account.clientId.startsWith('synthetic-client-') &&
            sample.account.clientSecret.startsWith('synthetic-secret-') &&
            sample.account.region === 'us-east-1' &&
            sample.account.authMethod === 'social' &&
            sample.account.provider === 'Google' &&
            sample.account.profileArn.startsWith('arn:aws:synthetic:profile/') &&
            sample.account.machineId.startsWith('synthetic-machine-') &&
            sample.account.expiresAt === 4102444800000
    )
    await click('[data-testid="liveness-stop"]', 'stop selected queue')
    setScenario('diagnose-fast-liveness')
    await click('[data-testid="liveness-run"]', 'start fresh selected queue')
    await waitFor(
        `function () { const page = document.querySelector(${JSON.stringify(page)}); return page?.textContent.includes('Synthetic liveness failure') && !page.querySelector('[data-testid="liveness-run"]').disabled }`,
        'new batch settled'
    )
    await new Promise((resolve) => setTimeout(resolve, 950))
    check(
        'stopped workers never dispatch remaining queue',
        calls('diagnoseAccountLiveness').length === beforeSlow + 9
    )
    check(
        'bound proxy passed to liveness IPC',
        calls('diagnoseAccountLiveness')
            .slice(beforeSlow, beforeSlow + 9)
            .some((call) => call.args[0].account.proxyUrl === syntheticProxy)
    )
    check(
        'new batch results replace old run',
        await run(`function () {
        const page = document.querySelector(${JSON.stringify(page)})
        return page.textContent.includes('3 个失败') && page.textContent.includes('pong synthetic0')
    }`)
    )
    await click('[data-testid="liveness-retest"]', 'retest failed accounts')
    await waitFor(
        `function () { return !document.querySelector('[data-testid="liveness-run"]').disabled }`,
        'failed retest settled'
    )
    check(
        'failed retest uses only three accounts',
        calls('diagnoseAccountLiveness').length === beforeSlow + 12
    )
    await run(
        `function () { const button = document.querySelector('[aria-label^="重测 synthetic0"]'); if (!button) throw new Error('Missing row retest'); button.click() }`
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="liveness-run"]').disabled }`,
        'one retest settled'
    )
    check('one row retest', calls('diagnoseAccountLiveness').length === beforeSlow + 13)
    await run(
        `function () { const button = [...document.querySelectorAll(${JSON.stringify(page + ' button')})].find((item) => item.textContent.includes('标记为错误')); if (!button) throw new Error('Missing mark failed'); button.click() }`
    )
    check(
        'mark failed updates only failing synthetic accounts',
        await run(`function () {
        const accounts = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        const values = window.__diagnoseIds.map((id) => accounts.accounts.get(id))
        return values.length === 6 && values.filter((item) => item.status === 'error').length === 3 &&
            values.filter((item) => item.status === 'error').every((item) => item.lastError?.includes('Synthetic liveness failure'))
    }`)
    )
    await run(
        `function () { const button = [...document.querySelectorAll(${JSON.stringify(page + ' button')})].find((item) => item.textContent.includes('删除失败')); if (!button) throw new Error('Missing delete failed'); button.click() }`
    )
    await waitFor(
        `function () { return Boolean(document.querySelector('dialog[open]')) }`,
        'delete confirm'
    )
    await run(
        `function () { const dialog = [...document.querySelectorAll('dialog[open]')].at(-1); const button = [...dialog.querySelectorAll('button')].find((item) => item.textContent.includes('取消')); if (!button) throw new Error('Missing cancel'); button.click() }`
    )
    await waitFor(
        `function () { return !document.querySelector('dialog[open]') }`,
        'delete cancelled'
    )
    check(
        'cancel keeps six synthetic accounts',
        await run(`function () {
        const accounts = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        return window.__diagnoseIds.every((id) => accounts.accounts.has(id))
    }`)
    )
    await screenshot('phase3-diagnose-results-light-zh')

    await run(`function () {
        const table = document.querySelector('table[aria-label="账号测活结果"]')
        if (!table) throw new Error('Missing account liveness table')
        table.scrollIntoView({ block: 'start' })
    }`)
    await waitFor(
        `function () {
        const rect = document.querySelector('table[aria-label="账号测活结果"]')?.getBoundingClientRect()
        return rect && rect.top >= 0 && rect.top < innerHeight
    }`,
        'liveness result table visible'
    )
    await screenshot('phase3-diagnose-liveness-results-light-zh')
    await run(`function () {
        const table = document.querySelector('table[aria-label="网络"]')
        if (!table) throw new Error('Missing network result table')
        table.scrollIntoView({ block: 'start' })
    }`)
    await waitFor(
        `function () {
        const rect = document.querySelector('table[aria-label="网络"]')?.getBoundingClientRect()
        return rect && rect.top >= 0 && rect.top < innerHeight
    }`,
        'network result table visible'
    )
    await screenshot('phase3-diagnose-network-results-light-zh')
    await run(`function () { document.querySelector('.kam-content').scrollTop = 0 }`)

    await run(
        `function () { const button = [...document.querySelectorAll(${JSON.stringify(page + ' button')})].find((item) => item.textContent.includes('删除失败')); if (!button) throw new Error('Missing delete failed'); button.click() }`
    )
    await waitFor(
        `function () { return Boolean(document.querySelector('dialog.ui-confirm[open]')) }`,
        'confirm delete failed'
    )
    await run(`function () {
        const confirm = document.querySelector('dialog.ui-confirm[open]')
        const button = [...confirm.querySelectorAll('button')].find((item) => item.textContent.includes('删除'))
        if (!button) throw new Error('Missing confirm delete button')
        button.click()
    }`)
    await waitFor(
        `function () {
        const accounts = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        return window.__diagnoseIds.filter((id) => accounts.accounts.has(id)).length === 3
    }`,
        'failed synthetic accounts deleted'
    )
    check(
        'confirm deletes only three failed synthetic accounts',
        await run(`function () {
        const accounts = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        return window.__diagnoseIds.every((id, index) => accounts.accounts.has(id) === (index % 2 === 0)) &&
            window.__diagnoseExistingIds.length === 6 &&
            window.__diagnoseExistingIds.every((id) => accounts.accounts.has(id)) &&
            accounts.accounts.size === 9
    }`)
    )

    await chooseMenu(0, 1)
    await chooseMenu(1, 2)
    await screenshot('phase3-diagnose-dark-en')
    check(
        'English diagnosis visible',
        await run(
            `function () { return document.querySelector(${JSON.stringify(page)})?.textContent.includes('Diagnostics') }`
        )
    )
    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    await click('#kam-navigation-tab-home', 'return home after diagnosis')
}

module.exports = { verifyDiagnose, mockDiagnose }
