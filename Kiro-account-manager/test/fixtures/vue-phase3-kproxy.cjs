/* Offline K-Proxy checks use synthetic IPC results; no proxy, cert, or network is started. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

const generatedId = 'b'.repeat(64)
const invalidId = 'g'.repeat(64)
let mockConfig = {
    enabled: false,
    port: 8899,
    host: '127.0.0.1',
    mitmDomains: ['amazonaws.com', 'amazon.com', 'kiro.dev'],
    autoStart: false,
    logRequests: true,
    extraSavedField: 'retained'
}
let mockRunning = false
let mockCaInstalled = false
let completedUpdates = []
let startSawCompletedUpdates = []

async function mockKProxy(name, args, scenario) {
    if (name === 'kproxyInit') {
        await new Promise((resolve) => setTimeout(resolve, 90))
        if (scenario === 'kproxy-init-fail')
            return { success: false, error: 'Synthetic init failure' }
        return {
            success: true,
            caInfo: {
                certPath: 'synthetic-ca.crt',
                fingerprint: 'AA:BB:CC:DD',
                validFrom: '2026-01-01T00:00:00.000Z',
                validTo: '2027-01-01T00:00:00.000Z'
            }
        }
    }
    if (name === 'kproxyGetStatus') {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (scenario === 'kproxy-status-fail') throw new Error('Synthetic status failure')
        return {
            running: mockRunning,
            config: { ...mockConfig },
            stats: {
                totalRequests: 12,
                mitmRequests: 7,
                bypassRequests: 5,
                modifiedRequests: 3,
                startTime: 1,
                lastRequestTime: 2
            },
            caInfo: null
        }
    }
    if (name === 'kproxyCheckCaCertInstalled') {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return { success: true, installed: mockCaInstalled }
    }
    if (name === 'kproxyUpdateConfig') {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (scenario === 'kproxy-update-fail')
            return { success: false, error: 'Synthetic update failure' }
        mockConfig = { ...mockConfig, ...args[0] }
        completedUpdates.push(args[0])
        return { success: true, config: { ...mockConfig } }
    }
    if (name === 'kproxyStart') {
        startSawCompletedUpdates = [...completedUpdates]
        await new Promise((resolve) => setTimeout(resolve, 130))
        if (scenario === 'kproxy-start-fail')
            return { success: false, error: 'Synthetic start failure' }
        mockConfig = { ...mockConfig, ...args[0], enabled: true }
        mockRunning = true
        return { success: true, port: mockConfig.port }
    }
    if (name === 'kproxyStop') {
        await new Promise((resolve) => setTimeout(resolve, 130))
        if (scenario === 'kproxy-stop-fail')
            return { success: false, error: 'Synthetic stop failure' }
        mockRunning = false
        mockConfig = { ...mockConfig, enabled: false }
        return { success: true }
    }
    if (name === 'kproxySetDeviceId') {
        if (!/^[a-f0-9]{64}$/i.test(args[0])) {
            return { success: false, error: 'Invalid device ID format (must be 64 hex characters)' }
        }
        mockConfig.deviceId = args[0]
        return { success: true }
    }
    if (name === 'kproxyGenerateDeviceId') {
        await new Promise((resolve) => setTimeout(resolve, 90))
        return { success: true, deviceId: generatedId }
    }
    if (name === 'kproxyInstallCaCert') {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (scenario === 'kproxy-ca-install-fail')
            return { success: false, error: 'Synthetic CA install failure' }
        mockCaInstalled = true
        return { success: true, message: 'Synthetic CA installed' }
    }
    if (name === 'kproxyUninstallCaCert') {
        await new Promise((resolve) => setTimeout(resolve, 100))
        mockCaInstalled = false
        return { success: true, message: 'Synthetic CA uninstalled' }
    }
    if (name === 'kproxyExportCaCert') {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (scenario === 'kproxy-ca-export-cancel')
            return { success: false, error: 'Export cancelled' }
        return { success: true, path: 'synthetic-export.crt' }
    }
    return undefined
}

async function verifyKProxy(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario, emitEvent } =
        harness
    const calls = (name) => report.calls.filter((call) => call.name === name)
    const page = '[data-testid="page-kproxy"]'

    async function input(selector, value) {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(selector)})
            const control = root?.matches('input') ? root : root?.querySelector('input')
            if (!control) throw new Error('Missing input: ' + ${JSON.stringify(selector)})
            control.value = ${JSON.stringify(value)}
            control.dispatchEvent(new Event('input', { bubbles: true }))
        }`)
    }

    async function navigate() {
        await click('#kam-navigation-tab-kproxy', 'K-Proxy page')
        await waitFor(
            `function () { return document.querySelector(${JSON.stringify(page)}) && document.querySelector('#kam-navigation-panel-kproxy')?.classList.contains('is-active') }`,
            'K-Proxy page active'
        )
    }

    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    setScenario('kproxy-init-fail')
    await navigate()
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-error"]')?.textContent.includes('Synthetic init failure') }`,
        'init failure visible'
    )
    check(
        'K-Proxy init failure keeps controls closed',
        !(await run(
            `function () { return !!document.querySelector('[data-testid="kproxy-toggle"]') }`
        ))
    )
    check(
        'K-Proxy parallel CA check',
        calls('kproxyInit').length === 1 && calls('kproxyCheckCaCertInstalled').length === 1
    )

    setScenario('kproxy-normal')
    await run(`function () {
        const button = document.querySelector('[data-testid="kproxy-retry-init"]')
        button.click()
        button.click()
    }`)
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="kproxy-toggle"]') }`,
        'K-Proxy initialized'
    )
    check(
        'K-Proxy init retry locked',
        calls('kproxyInit').length === 2 && calls('kproxyGetStatus').length === 1
    )
    check(
        'saved status and stats shown',
        await run(`function () {
        const panel = document.querySelector('[data-testid="kproxy-panel"]')
        return panel.textContent.includes('kiro.dev') === false &&
            panel.textContent.includes('12') && panel.textContent.includes('7') &&
            document.querySelector('[data-testid="kproxy-port"]')?.value === '8899'
    }`)
    )
    await screenshot('phase3-kproxy-light-zh')

    await run(`function () {
        window.__kproxyClipboard = []
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (value) => window.__kproxyClipboard.push(value) }
        })
    }`)
    await click('[data-testid="kproxy-copy-address"]', 'copy synthetic proxy address')
    await waitFor(
        `function () { return window.__kproxyClipboard?.length === 1 }`,
        'proxy address copied'
    )
    check(
        'proxy address clipboard value',
        await run(`function () { return window.__kproxyClipboard[0] === '127.0.0.1:8899' }`)
    )

    setScenario('kproxy-start-fail')
    const beforeFailedStartStatus = calls('kproxyGetStatus').length
    await click('[data-testid="kproxy-toggle"]', 'synthetic start failure')
    await click('[data-testid="kproxy-toggle"]', 'duplicate failed start')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-error"]')?.textContent.includes('Synthetic start failure') }`,
        'start error visible'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="kproxy-toggle"]')?.disabled }`,
        'failed start settled'
    )
    check(
        'start failure refreshes stopped status and locks duplicate',
        calls('kproxyStart').length === 1 &&
            calls('kproxyGetStatus').length === beforeFailedStartStatus + 1 &&
            !mockRunning
    )
    setScenario('kproxy-normal')

    await input('[data-testid="kproxy-host"]', 'offline.proxy.invalid')
    await input('[data-testid="kproxy-port"]', '9010')
    await click('[data-testid="kproxy-toggle"]', 'start after queued config updates')
    await click('[data-testid="kproxy-toggle"]', 'duplicate K-Proxy start')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-running-status"]')?.textContent.includes('运行中') }`,
        'K-Proxy running status'
    )
    check(
        'serialized config writes before start',
        startSawCompletedUpdates.length >= 2 &&
            startSawCompletedUpdates.at(-2).host === 'offline.proxy.invalid' &&
            startSawCompletedUpdates.at(-1).port === 9010 &&
            calls('kproxyStart').length === 2
    )
    check(
        'full config preserves saved fields and domains',
        calls('kproxyStart')[1].args[0].extraSavedField === 'retained' &&
            calls('kproxyStart')[1].args[0].mitmDomains.includes('kiro.dev') &&
            calls('kproxyStart')[1].args[0].host === 'offline.proxy.invalid' &&
            calls('kproxyStart')[1].args[0].port === 9010
    )
    check(
        'host and port disabled while running',
        await run(`function () {
        return document.querySelector('[data-testid="kproxy-host"]').disabled &&
            document.querySelector('[data-testid="kproxy-port"]').disabled
    }`)
    )

    setScenario('kproxy-stop-fail')
    const beforeStopStatus = calls('kproxyGetStatus').length
    await click('[data-testid="kproxy-toggle"]', 'synthetic stop failure')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-error"]')?.textContent.includes('Synthetic stop failure') }`,
        'stop error visible'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="kproxy-toggle"]')?.disabled }`,
        'failed stop settled'
    )
    check(
        'stop failure refreshes authoritative status',
        calls('kproxyGetStatus').length === beforeStopStatus + 1 && mockRunning
    )
    setScenario('kproxy-normal')
    await click('[data-testid="kproxy-toggle"]', 'stop synthetic proxy')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-running-status"]')?.textContent.includes('已停止') }`,
        'K-Proxy stopped'
    )

    await input('[data-testid="kproxy-port"]', '')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-port"]')?.value === '8899' }`,
        'port fallback'
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    check(
        'empty port uses original 8899 fallback',
        calls('kproxyUpdateConfig').some((call) => call.args[0].port === 8899)
    )
    setScenario('kproxy-update-fail')
    await click('[data-testid="kproxy-log-requests"]', 'synthetic config update failure')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-error"]')?.textContent.includes('Synthetic update failure') }`,
        'config update error visible'
    )
    check(
        'failed update retains newest local input',
        await run(
            `function () { return !document.querySelector('[data-testid="kproxy-log-requests"]').checked }`
        )
    )
    setScenario('kproxy-normal')
    await click('[data-testid="kproxy-log-requests"]', 'restore request logging')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-log-requests"]')?.checked }`,
        'request logging restored'
    )
    await input('[data-testid="kproxy-device-id"]', invalidId)
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-error"]')?.textContent.includes('Invalid device ID format') }`,
        'invalid 64-character device ID error'
    )
    check(
        'exactly 64 characters reach set-device validation',
        calls('kproxySetDeviceId').at(-1).args[0] === invalidId
    )

    const beforeGenerate = calls('kproxyGenerateDeviceId').length
    await click('[data-testid="kproxy-generate-id"]', 'generate synthetic device ID')
    await click('[data-testid="kproxy-generate-id"]', 'duplicate device ID generation')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-device-id"]')?.value === ${JSON.stringify(generatedId)} }`,
        'generated ID displayed'
    )
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-generate-id"]')?.disabled === false }`,
        'generate action settled'
    )
    check(
        'generate update precedes set-device',
        calls('kproxyGenerateDeviceId').length === beforeGenerate + 1 &&
            calls('kproxyUpdateConfig').at(-1).args[0].deviceId === generatedId &&
            calls('kproxySetDeviceId').at(-1).args[0] === generatedId
    )
    await click('[data-testid="kproxy-copy-device-id"]', 'copy generated device ID')
    await waitFor(
        `function () { return window.__kproxyClipboard?.length === 2 }`,
        'device ID copied'
    )
    check(
        'device clipboard value',
        await run(
            `function () { return window.__kproxyClipboard[1] === ${JSON.stringify(generatedId)} }`
        )
    )

    setScenario('kproxy-ca-install-fail')
    await click('[data-testid="kproxy-install-ca"]', 'synthetic CA install failure')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-error"]')?.textContent.includes('Synthetic CA install failure') }`,
        'CA install error'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="kproxy-install-ca"]')?.disabled }`,
        'failed CA install settled'
    )
    check(
        'failed CA installation keeps install option',
        await run(
            `function () { return !!document.querySelector('[data-testid="kproxy-install-ca"]') }`
        )
    )
    setScenario('kproxy-normal')
    await click('[data-testid="kproxy-install-ca"]', 'install synthetic CA')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="kproxy-uninstall-ca"]') }`,
        'CA installed state'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="kproxy-uninstall-ca"]')?.disabled }`,
        'CA install settled'
    )
    await click('[data-testid="kproxy-uninstall-ca"]', 'uninstall synthetic CA')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="kproxy-install-ca"]') }`,
        'CA uninstalled state'
    )
    setScenario('kproxy-ca-export-cancel')
    await click('[data-testid="kproxy-export-ca"]', 'cancel synthetic CA export')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-error"]')?.textContent.includes('Export cancelled') }`,
        'CA export cancellation visible'
    )

    emitEvent('mock-kproxy-status', { running: true, port: 8899 })
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-running-status"]')?.textContent.includes('运行中') }`,
        'status event reflected'
    )
    emitEvent('mock-kproxy-error', 'Synthetic event error')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kproxy-error"]')?.textContent.includes('Synthetic event error') }`,
        'error event reflected'
    )
    await click('#kam-navigation-tab-home', 'hide K-Proxy page')
    for (let index = 0; index < 55; index++) {
        emitEvent('mock-kproxy-request', {
            timestamp: 1000 + index,
            method: 'GET',
            host: `offline-${index}.invalid`,
            path: '/synthetic',
            isMitm: index % 2 === 0,
            deviceIdReplaced: index === 54
        })
    }
    await navigate()
    await waitFor(
        `function () { return document.querySelector('.kproxy-requests li')?.textContent.includes('offline-54.invalid') }`,
        'hidden request events retained'
    )
    check(
        'recent requests newest first and display ten',
        await run(`function () {
        const rows = [...document.querySelectorAll('.kproxy-requests li')]
        return rows.length === 10 && rows[0].textContent.includes('offline-54.invalid') &&
            rows[9].textContent.includes('offline-45.invalid') && rows[0].textContent.includes('ID')
    }`)
    )
    check(
        'request buffer capped at 50 when component state is inspectable',
        await run(`function () {
        const instance = document.querySelector('[data-testid="kproxy-panel"]')?.__vueParentComponent
        const recent = instance?.setupState?.recentRequests
        return recent === undefined || recent.length === 50
    }`)
    )
    await chooseMenu(0, 1)
    await chooseMenu(1, 2)
    await screenshot('phase3-kproxy-dark-en')
    check(
        'K-Proxy English content',
        await run(
            `function () { return document.querySelector('[data-testid="page-kproxy"]').textContent.includes('Recent Requests') }`
        )
    )
    await click('#kam-navigation-tab-home', 'leave K-Proxy page')
    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
}

module.exports = { mockKProxy, verifyKProxy }
