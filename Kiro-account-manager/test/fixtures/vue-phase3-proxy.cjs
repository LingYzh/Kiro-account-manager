/* Offline proxy state. All accounts and requests are synthetic. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
let running = false
let config = {
    port: 5580,
    host: '127.0.0.1',
    enableMultiAccount: true,
    logRequests: true,
    clientDrivenToolExecution: true,
    claudeModelIdMappingEnabled: true
}
let pool = []
let savedLogs = []
let apiKeys = []
let desktopOperations = []
let desktopInput
let mockRestart = false
let mockAudit = []
let nextKey = 1
const stats = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalCredits: 0,
    inputTokens: 0,
    outputTokens: 0,
    startTime: Date.now()
}
async function mockProxy(name, args, scenario) {
    if (name === 'proxyGetStatus') {
        if (scenario === 'proxy-init-fail') throw new Error('Synthetic proxy status failure')
        return {
            running,
            config,
            stats,
            sessionStats: {
                totalRequests: 0,
                successRequests: 0,
                failedRequests: 0,
                startTime: stats.startTime
            }
        }
    }
    if (name === 'proxyGetAccounts') return { accounts: pool, availableCount: pool.length }
    if (name === 'proxyUpdateConfig') {
        if (scenario === 'proxy-queued-config')
            await new Promise((resolve) => setTimeout(resolve, 55))
        if (scenario === 'proxy-config-fail')
            return { success: false, error: 'Synthetic proxy save failure' }
        config = { ...config, ...args[0] }
        return { success: true }
    }
    if (name === 'proxyStart') {
        if (scenario === 'proxy-start-fail')
            return { success: false, error: 'Synthetic proxy start failure' }
        config = { ...config, ...(args[0] || {}) }
        running = true
        return { success: true }
    }
    if (name === 'proxyStop') {
        running = false
        return { success: true }
    }
    if (name === 'proxySyncAccounts') {
        pool = args[0]
        return { success: true, accountCount: pool.length }
    }
    if (name === 'proxyRefreshModels') return { success: true }
    if (name === 'proxyGetModels' && scenario?.startsWith('proxy-')) {
        if (scenario === 'proxy-models-fail')
            return { success: false, error: 'Synthetic model catalog failure' }
        return {
            success: true,
            fromCache: true,
            models: [
                {
                    id: 'synthetic.sonnet-v1:0',
                    name: 'Synthetic Sonnet',
                    description: 'Offline model',
                    inputTypes: ['TEXT', 'IMAGE'],
                    supportsThinking: true,
                    thinkingEfforts: ['low', 'high'],
                    supportsPromptCaching: true,
                    maxInputTokens: 200000,
                    maxOutputTokens: 32000,
                    rateMultiplier: 1
                },
                { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', inputTypes: ['TEXT'] },
                { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', inputTypes: ['TEXT'] },
                { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', inputTypes: ['TEXT'] },
                { id: 'synthetic.unknown', name: 'Synthetic Unknown', inputTypes: ['TEXT'] }
            ]
        }
    }
    if (name === 'proxyLoadLogs') return { success: true, logs: savedLogs }
    if (name === 'proxySaveLogs') {
        savedLogs = args[0]
        return { success: true }
    }
    if (name === 'proxyResetCredits') stats.totalCredits = 0
    if (name === 'proxyResetTokens') {
        stats.inputTokens = 0
        stats.outputTokens = 0
    }
    if (name === 'proxyResetRequestStats') {
        stats.totalRequests = 0
        stats.successRequests = 0
        stats.failedRequests = 0
    }
    if (['proxyResetCredits', 'proxyResetTokens', 'proxyResetRequestStats'].includes(name))
        return { success: true }
    if (name === 'proxyNeedsRestart') return { needsRestart: mockRestart }
    if (name === 'proxyRestart') {
        mockRestart = false
        return { success: true }
    }
    if (name === 'proxySelfSignedCertInfo')
        return {
            success: true,
            subject: 'CN=localhost',
            fingerprint: 'AA:BB:CC',
            cert: 'SYNTHETIC PEM',
            altNames: ['localhost'],
            notAfter: '2027-01-01'
        }
    if (name === 'proxySelfSignedCertRegenerate')
        return {
            success: true,
            subject: 'CN=localhost',
            fingerprint: 'DD:EE:FF',
            cert: 'SYNTHETIC NEW PEM',
            altNames: ['localhost'],
            notAfter: '2027-01-01'
        }
    if (name === 'proxyAuditLog') return { success: true, entries: mockAudit }
    if (name === 'proxyGetLogs' && scenario?.startsWith('proxy-')) return [...mockAudit]
    if (name === 'proxyClearLogs' && scenario?.startsWith('proxy-')) {
        mockAudit = []
        return { success: true }
    }
    if (name === 'proxyGetApiKeys') return { success: true, apiKeys }
    if (name === 'proxyAddApiKey') {
        const key = {
            id: `synthetic-key-${nextKey++}`,
            key: `sk-synthetic-${nextKey}`,
            name: args[0].name,
            format: args[0].format,
            enabled: true,
            creditsLimit: args[0].creditsLimit,
            createdAt: Date.now(),
            usage: {
                totalRequests: 2,
                totalCredits: 0.5,
                totalInputTokens: 10,
                totalOutputTokens: 5,
                daily: {}
            }
        }
        apiKeys = [...apiKeys, key]
        return { success: true, apiKey: key }
    }
    if (name === 'proxyDeleteApiKey') {
        apiKeys = apiKeys.filter((key) => key.id !== args[0])
        return { success: true }
    }
    if (name === 'proxyUpdateApiKey') {
        apiKeys = apiKeys.map((key) => (key.id === args[0] ? { ...key, ...args[1] } : key))
        return { success: true }
    }
    if (name === 'proxyResetApiKeyUsage') return { success: true }
    if (name === 'proxyDesktopState')
        return {
            success: true,
            data: { input: desktopInput, operations: desktopOperations, proxyRunning: running }
        }
    if (name === 'proxyDesktopPreview') {
        desktopInput = args[0]
        return {
            success: true,
            data: {
                token: `synthetic-preview-${Date.now()}`,
                proxyOrigin: 'http://127.0.0.1:5580',
                models: ['synthetic.sonnet-v1:0'],
                files: [
                    {
                        path: 'synthetic/claude-desktop.json',
                        changed: true,
                        exists: true,
                        fields: ['mcpServers']
                    }
                ],
                warnings: []
            }
        }
    }
    if (name === 'proxyDesktopApply') {
        desktopOperations = [
            {
                id: 'synthetic-operation',
                status: 'applied',
                createdAt: new Date().toISOString(),
                paths: ['synthetic/claude-desktop.json']
            }
        ]
        return { success: true, data: desktopOperations[0] }
    }
    if (name === 'proxyDesktopRestore') {
        desktopOperations = desktopOperations.map((operation) => ({
            ...operation,
            status: 'restored'
        }))
        return { success: true, data: undefined }
    }
    if (name === 'proxyConfigureClients') return { success: true, results: [] }
    if (name === 'accountSetProxyBinding') return { success: true }
    return undefined
}
async function verifyProxy(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario, emitEvent } =
        harness
    const suiteCallStart = report.calls.length
    const calls = (name) => report.calls.slice(suiteCallStart).filter((call) => call.name === name)
    const page = '[data-testid="page-proxy"]'
    const panel = '[data-testid="proxy-panel"]'

    async function waitForCall(name, predicate, label) {
        const started = Date.now()
        while (Date.now() - started < 8000) {
            if (calls(name).some(predicate)) return
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error(`Timed out: ${label}`)
    }

    async function input(selector, value, event = 'input') {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(selector)})
            const control = root?.matches('input,textarea,select') ? root : root?.querySelector('input,textarea,select')
            if (!control) throw new Error('Missing control: ' + ${JSON.stringify(selector)})
            control.value = ${JSON.stringify(value)}
            control.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }))
        }`)
    }

    async function clickText(text, scope = panel) {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(scope)})
            const button = [...root.querySelectorAll('button')].find((node) => node.textContent.trim() === ${JSON.stringify(text)})
            if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)})
            button.click()
        }`)
    }

    async function answerConfirm(accept) {
        await waitFor(
            "function () { return !!document.querySelector('dialog.ui-confirm[open]') }",
            'proxy confirmation'
        )
        await run(`function () {
            const dialog = document.querySelector('dialog.ui-confirm[open]')
            const buttons = [...dialog.querySelectorAll('.ui-confirm-actions button')]
            if (buttons.length !== 2) throw new Error('Missing confirmation buttons')
            buttons[${accept ? '1' : '0'}].click()
        }`)
        await waitFor(
            "function () { return !document.querySelector('dialog.ui-confirm[open]') }",
            'proxy confirmation closed'
        )
    }

    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    const original = {
        running,
        config: { ...config },
        pool: [...pool],
        savedLogs: [...savedLogs],
        stats: { ...stats },
        apiKeys: [...apiKeys],
        desktopOperations: [...desktopOperations],
        desktopInput,
        mockRestart,
        mockAudit: [...mockAudit],
        nextKey
    }
    await run(`function () {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        const accounts = pinia._s.get('kam-accounts')
        window.__proxyFixture = { accounts: new Map(accounts.accounts), groups: new Map(accounts.groups), clipboard: navigator.clipboard.writeText }
        window.__proxyFixture.copied = []
        navigator.clipboard.writeText = async (value) => window.__proxyFixture.copied.push(value)
        const now = Date.now()
        function account(id, groupId, status = 'active', withToken = true) {
            return { id, email: id + '@example.invalid', status, groupId, idp: 'BuilderId',
                profileArn: 'arn:synthetic:' + id, machineId: 'machine-' + id,
                credentials: { accessToken: withToken ? 'synthetic-access-' + id : '', refreshToken: 'synthetic-refresh-' + id,
                    expiresAt: now + 3600000, clientId: 'client-' + id, clientSecret: 'secret-' + id,
                    region: 'us-west-2', authMethod: 'IdC', provider: 'BuilderId' },
                usage: { current: 1, limit: 100, percentUsed: 0.01 }, subscription: { title: 'Synthetic Pro' }, tags: [] }
        }
        accounts.$patch((state) => {
            state.accounts = new Map([
                account('proxy-grouped', 'proxy-group'), account('proxy-ungrouped', undefined),
                account('proxy-inactive', 'proxy-group', 'expired'), account('proxy-empty-token', undefined, 'active', false)
            ].map((item) => [item.id, item]))
            state.groups = new Map([['proxy-group', { id: 'proxy-group', name: 'Synthetic group', order: 1 }]])
        })
    }`)
    running = false
    config = {
        ...original.config,
        port: 5580,
        host: '127.0.0.1',
        enableMultiAccount: true,
        apiKey: undefined,
        apiKeys: [{ id: 'fixture-config-key', name: 'Fixture scope key' }],
        selectedAccountIds: [],
        multiAccountSelectionMode: 'all',
        extraUnknown: 'preserved'
    }
    pool = []
    savedLogs = []
    apiKeys = []
    desktopOperations = []
    desktopInput = undefined
    mockRestart = false
    mockAudit = [{ ts: Date.now(), type: 'synthetic', data: { state: 'offline' } }]
    Object.assign(stats, {
        totalRequests: 12,
        successRequests: 10,
        failedRequests: 2,
        totalCredits: 1.5,
        inputTokens: 100,
        outputTokens: 50,
        startTime: Date.now()
    })

    try {
        setScenario('proxy-init-fail')
        await click('#kam-navigation-tab-proxy', 'API proxy page')
        await waitFor(
            `function () { return !!document.querySelector(${JSON.stringify(page)}) && !!document.querySelector('[data-testid=proxy-error]') }`,
            'proxy init error visible'
        )
        check(
            'Init status failure leaves Start disabled',
            await run(
                "function () { return document.querySelector('[data-testid=proxy-toggle]')?.disabled === true }"
            )
        )
        setScenario('proxy-normal')
        await clickText('重试加载')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-toggle]')?.disabled === false }",
            'proxy retry ready'
        )
        check(
            'Retry obtains status and model catalog',
            calls('proxyGetStatus').length >= 2 && calls('proxyGetModels').length >= 2
        )
        await screenshot('phase3-proxy-light-zh')

        setScenario('proxy-queued-config')
        await input('[data-testid=proxy-port]', '6911')
        await input(`${panel} label:nth-of-type(2) input`, '127.0.0.2')
        await clickText('启动服务')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-toggle]')?.textContent.includes('停止') }",
            'proxy started'
        )
        const starts = calls('proxyStart')
        const syncs = calls('proxySyncAccounts')
        const firstStart = starts.at(-1)
        check(
            'Config writes complete before start',
            firstStart.args[0].port === 6911 &&
                firstStart.args[0].host === '127.0.0.2' &&
                calls('proxyUpdateConfig').length >= 2
        )
        check(
            'Start receives seven original fields',
            Object.keys(firstStart.args[0]).sort().join('|') ===
                [
                    'port',
                    'host',
                    'apiKey',
                    'enableMultiAccount',
                    'logRequests',
                    'clientDrivenToolExecution',
                    'disableTools'
                ]
                    .sort()
                    .join('|')
        )
        check(
            'Account sync precedes start with complete credentials',
            syncs.length >= 1 &&
                syncs.at(-1).args[0].length === 2 &&
                syncs
                    .at(-1)
                    .args[0].every(
                        (entry) =>
                            entry.accessToken &&
                            entry.refreshToken &&
                            entry.clientId &&
                            entry.clientSecret &&
                            entry.profileArn &&
                            entry.machineId &&
                            entry.region === 'us-west-2'
                    ) &&
                report.calls.indexOf(syncs.at(-1)) < report.calls.indexOf(firstStart)
        )
        await screenshot('phase3-proxy-running-light-zh')

        const syncCount = calls('proxySyncAccounts').length
        await run(
            "function () { const a = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts'); a.accounts.get('proxy-grouped').credentials.accessToken = 'synthetic-new-token'; a.accounts.get('proxy-grouped').usage.current = 5 }"
        )
        await new Promise((resolve) => setTimeout(resolve, 750))
        check(
            'Token and usage changes do not re-sync accounts',
            calls('proxySyncAccounts').length === syncCount
        )
        await run(
            "function () { const a = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts'); a.accounts.get('proxy-grouped').groupId = undefined }"
        )
        await waitFor(
            `function () { return document.querySelector(${JSON.stringify(panel)})?.textContent.includes('运行中') }`,
            'proxy remains running after group change'
        )
        await new Promise((resolve) => setTimeout(resolve, 750))
        check(
            'Group change schedules a single account re-sync',
            calls('proxySyncAccounts').length === syncCount + 1
        )

        const statusBeforeResponse = calls('proxyGetStatus').length
        await emitEvent('mock-proxy-response', {
            path: '/synthetic/new',
            model: 'synthetic.sonnet-v1:0',
            status: 200,
            inputTokens: 7,
            outputTokens: 3,
            credits: 0.1
        })
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-panel]')?.textContent.includes('/synthetic/new') }",
            'proxy response visible'
        )
        await waitForCall(
            'proxyGetStatus',
            () => calls('proxyGetStatus').length > statusBeforeResponse,
            'response event refreshes status'
        )
        check(
            'Event status refresh and recent request',
            calls('proxyGetStatus').length > statusBeforeResponse
        )
        await clickText('查看全部')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=proxy-logs-dialog][open]') }",
            'proxy logs dialog'
        )
        await screenshot('phase3-proxy-logs-light-zh')
        for (let index = 0; index < 101; index += 1)
            emitEvent('mock-proxy-response', {
                path: `/synthetic/${index}`,
                status: index % 9 ? 200 : 429,
                inputTokens: index,
                credits: 0.001
            })
        await waitFor(
            "function () { const dialog = document.querySelector('[data-testid=proxy-logs-dialog][open]'); return dialog?.textContent.includes('/synthetic/100') && dialog?.textContent.includes('100') }",
            'latest 100 proxy logs'
        )
        await waitFor(
            "function () { return window.__proxyFixture && document.querySelector('[data-testid=proxy-logs-dialog][open]') }",
            'proxy log store ready'
        )
        check(
            'Recent log buffer caps at 100 and preserves newest',
            await run(
                "function () { const dialog = document.querySelector('[data-testid=proxy-logs-dialog][open]'); return dialog.querySelectorAll('[data-testid^=proxy-log-row-]').length <= 100 && !dialog.textContent.includes('/synthetic/new') && dialog.textContent.includes('/synthetic/100') }"
            )
        )
        await click('[data-testid=proxy-logs-clear]', 'clear recent proxy logs')
        await waitFor(
            "function () { return !document.querySelector('[data-testid=proxy-logs-dialog][open]')?.textContent.includes('/synthetic/100') }",
            'recent logs cleared'
        )
        check('Clear persists empty history', calls('proxySaveLogs').at(-1)?.args[0]?.length === 0)
        await run(
            "function () { const dialog = document.querySelector('[data-testid=proxy-logs-dialog][open]'); [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === '关闭')?.click() }"
        )

        await clickText('模型列表')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-models-dialog][open]')?.textContent.includes('Synthetic Sonnet') }",
            'synthetic models'
        )
        check(
            'Model catalog includes source metadata and unknown ID',
            await run(
                "function () { const dialog = document.querySelector('[data-testid=proxy-models-dialog][open]'); return dialog.textContent.includes('Synthetic Sonnet') && dialog.textContent.includes('Synthetic Unknown') && dialog.textContent.includes('200K') }"
            )
        )
        await screenshot('phase3-proxy-models-light-zh')
        await click('[data-testid=proxy-model-mapping-open]', 'open model mappings')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=proxy-mapping-dialog][open]') }",
            'mapping dialog'
        )
        await click('[data-testid=mapping-add]', 'add model mapping')
        check(
            'New mapping retains unknown target selection',
            await run(
                "function () { return !!document.querySelector('[data-testid=proxy-mapping-dialog][open] [data-testid=mapping-rule-0]') }"
            )
        )
        await screenshot('phase3-proxy-mapping-light-zh')
        await click('[data-testid=mapping-cancel]', 'cancel unsaved mapping')
        check(
            'Cancel mapping does not write config',
            !calls('proxyUpdateConfig').some((call) => call.args[0].modelMappings)
        )
        await clickText('模型列表')
        await click('[data-testid=proxy-model-mapping-open]', 'edit model mappings')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=proxy-mapping-dialog][open]') }",
            'mapping editor reopened'
        )
        await click('[data-testid=mapping-add]', 'create persisted mapping')
        await input('[data-testid=mapping-name-0]', 'Synthetic future alias')
        await input('[data-testid=mapping-source-0]', 'custom.future-*')
        await input('[data-testid=mapping-target-0-0]', 'synthetic.unknown')
        await input('[data-testid=mapping-effort-0]', 'high', 'change')
        await click('[data-testid=mapping-key-0-fixture-config-key]', 'scope mapping to API key')
        await click('[data-testid=mapping-save]', 'save model mapping')
        await waitForCall(
            'proxyUpdateConfig',
            (call) => call.args[0].modelMappings?.[0]?.sourceModel === 'custom.future-*',
            'mapping saved'
        )
        check(
            'Mapping saves unknown ID, effort and key scope',
            calls('proxyUpdateConfig').at(-1)?.args[0]?.modelMappings?.[0]?.targetModels?.[0] ===
                'synthetic.unknown' &&
                calls('proxyUpdateConfig').at(-1)?.args[0]?.modelMappings?.[0]
                    ?.defaultReasoningEffort === 'high' &&
                calls('proxyUpdateConfig')
                    .at(-1)
                    ?.args[0]?.modelMappings?.[0]?.apiKeyIds?.includes('fixture-config-key')
        )
        await waitFor(
            "function () { return !document.querySelector('[data-testid=proxy-mapping-dialog][open]') }",
            'saved mapping dialog closed'
        )
        await clickText('模型列表')
        await click('[data-testid=proxy-model-mapping-open]', 'reopen saved mapping')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=proxy-mapping-dialog][open] [data-testid=mapping-rule-0]') }",
            'saved mapping rendered'
        )
        await click('[data-testid=mapping-delete-0]', 'delete model mapping')
        await click('[data-testid=mapping-save]', 'save mapping deletion')
        await waitForCall(
            'proxyUpdateConfig',
            (call) =>
                Array.isArray(call.args[0].modelMappings) &&
                call.args[0].modelMappings.length === 0,
            'mapping deletion saved'
        )

        await clickText('管理多个 Key')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=api-key-manager][open]') }",
            'API key manager'
        )
        await input('[data-testid=api-key-name]', 'Synthetic CLI key')
        await click('[data-testid=api-key-add]', 'add API key')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=api-key-synthetic-key-1]') }",
            'API key added'
        )
        check(
            'API key add preserves format and name',
            calls('proxyAddApiKey').at(-1).args[0].name === 'Synthetic CLI key' &&
                calls('proxyAddApiKey').at(-1).args[0].format === 'sk'
        )
        await screenshot('phase3-proxy-keys-light-zh')
        await click('[data-testid=api-key-select-synthetic-key-1]', 'inspect API key usage')
        await input('[data-testid=api-key-limit]', '3.5')
        await click('[data-testid=api-key-save-limit]', 'save API key quota')
        await waitFor(
            "function () { return document.querySelector('[data-testid=api-key-synthetic-key-1]')?.textContent.includes('/3.5') }",
            'API key quota shown'
        )
        check(
            'API key quota update IPC',
            calls('proxyUpdateApiKey').some(
                (call) => call.args[0] === 'synthetic-key-1' && call.args[1].creditsLimit === 3.5
            )
        )
        await click('[data-testid=api-key-view-usage]', 'API key usage details')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=api-key-usage-dialog][open]') }",
            'API key usage dialog'
        )
        await click('[data-testid=usage-tab-model]', 'model usage')
        await click('[data-testid=usage-tab-daily]', 'daily usage')
        await run(
            "function () { const dialog = document.querySelector('[data-testid=api-key-usage-dialog][open]'); [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === '关闭')?.click() }"
        )
        await waitFor(
            "function () { return !document.querySelector('[data-testid=api-key-usage-dialog][open]') }",
            'API key usage dialog closed'
        )
        await click('[data-testid=api-key-reset-usage]', 'reset API key usage')
        await answerConfirm(true)
        await waitFor(
            "function () { return document.querySelector('[data-testid=api-key-selected]')?.textContent.includes('0.00') }",
            'API key usage reset'
        )
        check(
            'Usage reset IPC targets selected key',
            calls('proxyResetApiKeyUsage').at(-1)?.args[0] === 'synthetic-key-1'
        )
        for (const [format, name] of [
            ['simple', 'Synthetic simple'],
            ['token', 'Synthetic token']
        ]) {
            await input('[data-testid=api-key-format]', format, 'change')
            await input('[data-testid=api-key-name]', name)
            await click('[data-testid=api-key-add]', `add ${format} API key`)
        }
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=api-key-synthetic-key-3]') }",
            'three API key formats added'
        )
        check(
            'Three API key formats preserved',
            calls('proxyAddApiKey')
                .slice(-3)
                .map((call) => call.args[0].format)
                .join(',') === 'sk,simple,token'
        )
        await click('[data-testid=api-key-delete-synthetic-key-1]', 'delete API key')
        await answerConfirm(true)
        await waitFor(
            "function () { return !document.querySelector('[data-testid=api-key-manager][open] [data-testid=api-key-synthetic-key-1]') }",
            'API key deleted'
        )
        check(
            'API key deletion IPC',
            calls('proxyDeleteApiKey').at(-1)?.args[0] === 'synthetic-key-1'
        )
        await run(
            "function () { const dialog = document.querySelector('[data-testid=api-key-manager][open]'); [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === '关闭')?.click() }"
        )

        await clickText('客户端配置')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=client-config-dialog][open] [data-testid=desktop-config]') }",
            'Claude Desktop config'
        )
        await waitFor(
            "function () { return document.querySelector('[data-testid=desktop-preview-action]')?.disabled === false }",
            'Desktop models ready'
        )
        await click('[data-testid=desktop-preview-action]', 'preview synthetic Desktop files')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=desktop-preview]') }",
            'Desktop preview'
        )
        check(
            'Desktop preview uses complete three-route input',
            calls('proxyDesktopPreview').at(-1)?.args[0]?.routes?.length === 3
        )
        await screenshot('phase3-proxy-desktop-preview-light-zh')
        await input('[data-testid=desktop-target-0]', 'synthetic.unknown', 'change')
        check(
            'Changing Desktop target invalidates preview token',
            await run(
                "function () { return !document.querySelector('[data-testid=desktop-preview]') && document.querySelector('[data-testid=desktop-apply]')?.disabled }"
            )
        )
        await click('[data-testid=desktop-preview-action]', 'preview changed Desktop routes')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=desktop-preview]') }",
            'Desktop changed preview'
        )
        await click('[data-testid=desktop-apply]', 'apply synthetic Desktop preview')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=desktop-operations]') }",
            'Desktop recovery record'
        )
        check(
            'Desktop apply uses latest preview token',
            calls('proxyDesktopApply').length === 1 &&
                String(calls('proxyDesktopApply')[0].args[0]).startsWith('synthetic-preview-')
        )
        await input('[data-testid=desktop-restore-operation]', 'synthetic-operation', 'change')
        await click('[data-testid=desktop-restore]', 'restore synthetic Desktop files')
        await waitFor(
            "function () { return !document.querySelector('[data-testid=desktop-operations]') }",
            'Desktop recovery completed'
        )
        check(
            'Desktop restore targets selected operation',
            calls('proxyDesktopRestore').at(-1)?.args[0] === 'synthetic-operation'
        )
        await click('[data-testid=client-tab-others]', 'other client configuration')
        await input('[data-testid=client-model]', 'synthetic.sonnet-v1:0', 'change')
        await click('[data-testid=client-select-claudeCode]', 'select synthetic Claude Code client')
        await click('[data-testid=client-apply]', 'configure synthetic client')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=client-config-dialog][open] [data-testid=client-apply]:not([disabled])') }",
            'client configuration settled'
        )
        check(
            'Other-client configuration contains model and selected client',
            calls('proxyConfigureClients').at(-1)?.args[0]?.modelId === 'synthetic.sonnet-v1:0' &&
                calls('proxyConfigureClients').at(-1)?.args[0]?.clients?.includes('claudeCode')
        )
        await run(
            "function () { const dialog = document.querySelector('[data-testid=client-config-dialog][open]'); [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === '关闭')?.click() }"
        )

        await click('[data-testid=proxy-security-toggle]', 'expand proxy security')
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=proxy-security-body]') }",
            'security panel expanded'
        )
        await input('[data-testid=proxy-security-body-mb]', '2')
        await input('[data-testid=proxy-security-allowed-ips]', ' 192.0.2.1\n2001:db8::1\n')
        await run(
            "function () { document.querySelector('[data-testid=proxy-security-allowed-ips]').dispatchEvent(new Event('blur', { bubbles: true })) }"
        )
        await waitForCall(
            'proxyUpdateConfig',
            (call) => Array.isArray(call.args[0].allowedIPs),
            'allowed IP configuration saved'
        )
        await waitFor(
            "function () { return !!document.querySelector('[data-testid=proxy-security-cert-toggle]') }",
            'TLS controls'
        )
        check(
            'Security converts MB and trims IP entries',
            calls('proxyUpdateConfig').some(
                (call) => call.args[0].maxRequestBodyBytes === 2 * 1024 * 1024
            ) &&
                calls('proxyUpdateConfig').some(
                    (call) =>
                        Array.isArray(call.args[0].allowedIPs) &&
                        call.args[0].allowedIPs.includes('192.0.2.1')
                )
        )
        await click('[data-testid=proxy-security-cert-toggle]', 'show TLS certificate')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-security-cert-info]')?.textContent.includes('AA:BB:CC') }",
            'synthetic TLS info'
        )
        await click(
            '[data-testid=proxy-security-cert-regenerate]',
            'regenerate synthetic TLS certificate'
        )
        await answerConfirm(false)
        check(
            'Cancelled certificate generation does not call IPC',
            calls('proxySelfSignedCertRegenerate').length === 0
        )
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-security-cert-regenerate]')?.disabled === false }",
            'certificate confirmation released'
        )
        await click(
            '[data-testid=proxy-security-cert-regenerate]',
            'confirm synthetic TLS certificate regeneration'
        )
        await answerConfirm(true)
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-security-cert-info]')?.textContent.includes('DD:EE:FF') }",
            'regenerated synthetic TLS info'
        )
        await click('[data-testid=proxy-security-audit-toggle]', 'show audit')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-security-audit]')?.textContent.includes('synthetic') }",
            'synthetic audit'
        )
        await run(
            "function () { document.querySelector('[data-testid=proxy-security-body]')?.scrollIntoView({ block: 'start' }) }"
        )
        await screenshot('phase3-proxy-security-light-zh')

        await run(
            "function () { const card = [...document.querySelectorAll('[data-testid=proxy-panel] .ui-card')].find((node) => node.querySelector('.kam-muted')?.textContent.trim() === '总请求'); const button = [...(card?.querySelectorAll('button') || [])].find((node) => node.textContent.trim() === '重置'); if (!button) throw new Error('Missing request reset'); button.click() }"
        )
        await waitFor(
            "function () { return [...document.querySelectorAll('[data-testid=proxy-panel] .ui-card')].some((node) => node.querySelector('.kam-muted')?.textContent.trim() === '总请求' && node.querySelector('strong')?.textContent.trim() === '0') }",
            'request stats reset'
        )
        check(
            'Request reset uses dedicated IPC method',
            calls('proxyResetRequestStats').length === 1
        )

        const previousStarts = calls('proxyStart').length
        const previousStops = calls('proxyStop').length
        await run(
            "function () { const label = [...document.querySelectorAll('[data-testid=proxy-panel] label.proxy-toggle')].find((node) => node.textContent.includes('外网访问')); if (!label) throw new Error('Missing public access switch'); label.querySelector('input[type=checkbox]').click() }"
        )
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-security-external-warning]')?.textContent.includes('0.0.0.0') }",
            'public exposure warning'
        )
        const restartStarted = Date.now()
        while (
            Date.now() - restartStarted < 8000 &&
            (calls('proxyStop').length < previousStops + 1 ||
                calls('proxyStart').length < previousStarts + 1)
        )
            await new Promise((resolve) => setTimeout(resolve, 50))
        check(
            'Public host update stops then restarts without replacing config',
            calls('proxyStop').length === previousStops + 1 &&
                calls('proxyStart').length === previousStarts + 1 &&
                calls('proxyStart').at(-1).args.length === 0 &&
                config.host === '0.0.0.0'
        )
        emitEvent('mock-proxy-status', { running: true, port: 6911 })
        emitEvent('mock-proxy-error', 'Synthetic proxy event error')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-error]')?.textContent.includes('Synthetic proxy event error') }",
            'proxy error event visible'
        )

        await chooseMenu(0, 1)
        await chooseMenu(1, 2)
        await run(
            "function () { document.querySelector('[data-testid=page-proxy]')?.scrollIntoView({ block: 'start' }) }"
        )
        await screenshot('phase3-proxy-dark-en')
        await clickText('Stop server')
        await waitFor(
            "function () { return document.querySelector('[data-testid=proxy-toggle]')?.textContent.includes('Start server') }",
            'proxy stopped'
        )
        await chooseMenu(0, 0)
        await chooseMenu(1, 1)
        for (const [format, pattern] of [
            ['sk', /^sk-[a-z0-9]{48}$/],
            ['simple', /^PROXY_KEY_[A-Z0-9]{32}$/],
            ['token', /^PROXY_KEY:[a-z0-9]{32}$/]
        ]) {
            await input('[data-testid=proxy-panel] .proxy-key select', format, 'change')
            await clickText('随机生成')
            await waitForCall(
                'proxyUpdateConfig',
                (call) => pattern.test(call.args[0].apiKey || ''),
                `${format} generated key saved`
            )
        }
        check(
            'All generated key formats follow source patterns',
            calls('proxyUpdateConfig').filter((call) => call.args[0].apiKey).length >= 3
        )

        await run(
            "function () { const label = [...document.querySelectorAll('[data-testid=proxy-panel] label.proxy-toggle')].find((node) => node.textContent.includes('多账号轮询')); if (!label) throw new Error('Missing multi-account switch'); label.querySelector('input[type=checkbox]').click() }"
        )
        await waitForCall(
            'proxyUpdateConfig',
            (call) => call.args[0].enableMultiAccount === false,
            'single-account mode saved'
        )
        await clickText('第一个可用账号')
        await waitFor(
            `function () { return !!document.querySelector('dialog[open][aria-label="选择账号"]') }`,
            'single account picker'
        )
        await run(
            `function () { const dialog = document.querySelector('dialog[open][aria-label="选择账号"]'); const card = [...dialog.querySelectorAll('.ui-card')].find((node) => node.textContent.includes('proxy-grouped@example.invalid')); if (!card) throw new Error('Missing grouped account'); [...card.querySelectorAll('button')].find((node) => node.textContent.trim() === '选择').click() }`
        )
        await waitForCall(
            'proxyUpdateConfig',
            (call) => call.args[0].selectedAccountId === 'proxy-grouped',
            'single account selected'
        )
        check(
            'Single selection keeps legacy selectedAccountIds',
            calls('proxyUpdateConfig').at(-1).args[0].selectedAccountIds?.join() === 'proxy-grouped'
        )

        await run(
            "function () { const a = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts'); a.accounts.get('proxy-grouped').groupId = 'proxy-group'; const label = [...document.querySelectorAll('[data-testid=proxy-panel] label.proxy-toggle')].find((node) => node.textContent.includes('多账号轮询')); label.querySelector('input[type=checkbox]').click() }"
        )
        await waitForCall(
            'proxyUpdateConfig',
            (call) => call.args[0].enableMultiAccount === true,
            'multi-account mode restored'
        )
        await run(
            "function () { const label = [...document.querySelectorAll('[data-testid=proxy-panel] label')].find((node) => node.textContent.includes('轮询范围')); const select = label?.querySelector('select'); if (!select) throw new Error('Missing group scope selector'); select.value = 'groups'; select.dispatchEvent(new Event('change', { bubbles: true })) }"
        )
        await waitForCall(
            'proxyUpdateConfig',
            (call) => call.args[0].multiAccountSelectionMode === 'groups',
            'group scope saved'
        )
        await clickText('Synthetic group (1)')
        await waitForCall(
            'proxySyncAccounts',
            (call) => call.args[0].length === 1 && call.args[0][0].id === 'proxy-grouped',
            'grouped account sync'
        )
        const beforeUngroupedSyncs = calls('proxySyncAccounts').length
        await clickText('未分组 (1)')
        const ungroupedStarted = Date.now()
        while (
            Date.now() - ungroupedStarted < 8000 &&
            calls('proxySyncAccounts').length <= beforeUngroupedSyncs
        )
            await new Promise((resolve) => setTimeout(resolve, 50))
        check(
            'Ungrouped addition expands the sync pool',
            calls('proxySyncAccounts').at(-1)?.args[0]?.length === 2 &&
                calls('proxySyncAccounts')
                    .at(-1)
                    .args[0].some((entry) => entry.id === 'proxy-ungrouped')
        )
    } finally {
        setScenario('proxy-normal')
        running = original.running
        config = original.config
        pool = original.pool
        savedLogs = original.savedLogs
        Object.assign(stats, original.stats)
        apiKeys = original.apiKeys
        desktopOperations = original.desktopOperations
        desktopInput = original.desktopInput
        mockRestart = original.mockRestart
        mockAudit = original.mockAudit
        nextKey = original.nextKey
        await run(`function () {
            const old = window.__proxyFixture
            if (!old) return
            const accounts = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
            accounts.$patch((state) => { state.accounts = old.accounts; state.groups = old.groups })
            navigator.clipboard.writeText = old.clipboard
            delete window.__proxyFixture
        }`)
        await chooseMenu(0, 0)
        await chooseMenu(1, 1)
    }
}

module.exports = { mockProxy, verifyProxy }
