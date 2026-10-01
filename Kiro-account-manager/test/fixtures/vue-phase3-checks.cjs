/* Offline business checks run in the actual App.vue Electron renderer. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
async function verifySmallPages(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario, appendLogs } =
        harness
    async function navigate(page) {
        await click(`#kam-navigation-tab-${page}`, `${page} business page`)
        await waitFor(
            `function () { return document.querySelector('#kam-navigation-panel-${page}')?.classList.contains('is-active') }`,
            `${page} mounted`
        )
    }
    async function input(selector, value, event = 'input') {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(selector)})
            const element = root?.matches('input,select,textarea') ? root : root?.querySelector('input,select,textarea')
            if (!element) throw new Error('Missing control: ' + ${JSON.stringify(selector)})
            element.value = ${JSON.stringify(value)}
            element.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }))
        }`)
    }
    async function closeUpdate() {
        await click('[data-testid="about-close-update"]', 'close update result')
        await waitFor(
            `function () { return !document.querySelector('[data-testid="about-update-dialog"][open]') }`,
            'update dialog closed'
        )
    }

    await chooseMenu(0, 0)
    await navigate('about')
    check(
        'about never checks automatically',
        !report.calls.some((call) => call.name === 'checkForUpdatesManual')
    )
    await waitFor(
        `function () { return document.querySelector('[data-testid="page-about"]').textContent.includes('1.7.9') }`,
        'about version'
    )
    await screenshot('phase3-about-light-zh')
    await click('[data-testid="about-check-updates"]', 'manual update check')
    await click('[data-testid="about-check-updates"]', 'duplicate update check')
    await waitFor(
        `function () { return document.querySelector('[data-testid="about-update-dialog"][open]')?.textContent.includes('9.0.0') }`,
        'available update result'
    )
    check(
        'manual update lock',
        report.calls.filter((call) => call.name === 'checkForUpdatesManual').length === 1
    )
    check(
        'update asset limit and remainder',
        await run(`function () {
        const dialog = document.querySelector('[data-testid="about-update-dialog"]')
        return dialog.querySelectorAll('.about-assets li').length === 6 && dialog.textContent.includes('2') && dialog.textContent.includes('Offline release notes')
    }`)
    )
    await screenshot('phase3-about-update')
    await click('[data-testid="about-release-link"]', 'release link')
    await waitFor(`function () { return true }`, 'external action queued')
    check(
        'release URL forwarded',
        report.calls.some(
            (call) =>
                call.name === 'openExternal' && call.args[0] === 'https://example.invalid/release'
        )
    )
    await closeUpdate()
    setScenario('update-throw')
    await click('[data-testid="about-check-updates"]', 'update failure')
    await waitFor(
        `function () { return document.querySelector('[data-testid="about-update-dialog"][open]')?.textContent.includes('Synthetic update failure') }`,
        'update failure visible'
    )
    setScenario('update-current')
    await click('[data-testid="about-retry-update"]', 'retry update')
    await waitFor(
        `function () { return document.querySelector('[data-testid="about-update-dialog"]')?.textContent.includes('最新') }`,
        'up to date'
    )
    await closeUpdate()
    check(
        'about group entry removed',
        await run(`function () {
        return !document.querySelector('[data-testid="about-open-group"], [data-testid="about-group-dialog"]')
    }`)
    )

    await navigate('webhooks')
    check(
        'webhook empty state',
        await run(
            `function () { return document.querySelector('[data-testid="page-webhooks"]').textContent.includes('尚未配置') }`
        )
    )
    await click('[data-testid="webhook-add"]', 'add webhook')
    check(
        'webhook default controls checked',
        await run(`function () {
        return document.querySelector('[data-testid="webhook-enabled"]').checked &&
            document.querySelector('[data-testid="webhook-event-batch-completed"]').checked &&
            document.querySelector('[data-testid="webhook-event-risk-warning"]').checked &&
            document.querySelector('[data-testid="webhook-event-account-banned"]').checked
    }`)
    )
    await input('[data-testid="webhook-kind"]', 'custom', 'change')
    await input('[data-testid="webhook-label"]', 'Offline hook')
    await input('[data-testid="webhook-url"]', 'https://example.invalid/hook')
    await input('[data-testid="webhook-template"]', '{"text":"{{message}}"}')
    await screenshot('phase3-webhook-editor-light-zh')
    await click('[data-testid="webhook-save"]', 'save webhook')
    await waitFor(
        `function () { return !document.querySelector('.ui-dialog[open]') && JSON.parse(localStorage.getItem('kiro-webhooks') || '[]').length === 1 }`,
        'webhook saved'
    )
    let stored = await run(
        `function () { return JSON.parse(localStorage.getItem('kiro-webhooks')) }`
    )
    const id = stored[0].id
    check(
        'webhook original document contract',
        stored[0].kind === 'custom' &&
            stored[0].customTemplate === '{"text":"{{message}}"}' &&
            stored[0].events.join(',') === 'batch-completed,risk-warning,account-banned' &&
            stored[0].enabled
    )
    await click(`[data-testid="webhook-toggle-${id}"]`, 'disable webhook')
    check(
        'webhook disabled persisted',
        await run(
            `function () { return !JSON.parse(localStorage.getItem('kiro-webhooks'))[0].enabled }`
        )
    )
    await click(`[data-testid="webhook-edit-${id}"]`, 'edit webhook')
    await input('[data-testid="webhook-label"]', 'Edited offline hook')
    await click('[data-testid="webhook-save"]', 'update webhook')
    await waitFor(
        `function () { return !document.querySelector('.ui-dialog[open]') }`,
        'editor closed'
    )
    stored = await run(`function () { return JSON.parse(localStorage.getItem('kiro-webhooks')) }`)
    check(
        'webhook edit preserves identity',
        stored[0].id === id && stored[0].label === 'Edited offline hook'
    )
    await run(`function () {
        window.__hookCalls = []
        window.fetch = async (url, options) => {
            window.__hookCalls.push({ url, body: options.body })
            await new Promise((resolve) => setTimeout(resolve, 150))
            return { ok: true, status: 200 }
        }
    }`)
    await click(`[data-testid="webhook-test-${id}"]`, 'test synthetic webhook')
    await click(`[data-testid="webhook-test-${id}"]`, 'duplicate webhook test')
    await waitFor(
        `function () { return document.querySelector('[data-testid="page-webhooks"]').textContent.includes('测试成功') }`,
        'webhook result'
    )
    check(
        'webhook test lock and payload',
        await run(
            `function () { return window.__hookCalls.length === 1 && window.__hookCalls[0].url === 'https://example.invalid/hook' && typeof JSON.parse(window.__hookCalls[0].body).text === 'string' }`
        )
    )
    await screenshot('phase3-webhooks-light-zh')
    await click(`[data-testid="webhook-delete-${id}"]`, 'delete webhook confirmation')
    await waitFor(
        `function () { return Boolean(document.querySelector('.ui-confirm[open], .ui-confirm-dialog[open], .ui-dialog[open]')) }`,
        'delete confirm'
    )
    await run(
        `function () { const buttons = [...document.querySelectorAll('dialog[open] button')]; buttons.find((button) => button.textContent.includes('取消')).click() }`
    )
    await waitFor(
        `function () { return !document.querySelector('dialog[open]') }`,
        'delete cancelled'
    )
    check(
        'cancel delete keeps webhook',
        await run(
            `function () { return JSON.parse(localStorage.getItem('kiro-webhooks')).length === 1 }`
        )
    )

    await navigate('logs')
    await waitFor(
        `function () { return document.querySelectorAll('[data-testid="log-row"]').length > 0 }`,
        'virtual log rows'
    )
    check(
        'logs list is virtual',
        await run(
            `function () { const count = document.querySelectorAll('[data-testid="log-row"]').length; return count > 0 && count < 180 }`
        )
    )
    await run(
        `function () { const element = document.querySelector('[data-testid="log-scroll"]'); element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); }`
    )
    await waitFor(
        `function () { const element = document.querySelector('[data-testid="log-scroll"]'); return element.scrollTop < 50 && document.querySelector('.kam-logs-follow-status')?.textContent.includes('暂停') }`,
        'reading position registered'
    )
    appendLogs()
    await waitFor(
        `function () { return document.querySelector('.kam-logs-follow')?.textContent.includes('1') }`,
        'new log indication'
    )
    check(
        'poll respects reading position',
        await run(
            `function () { return document.querySelector('[data-testid="log-scroll"]').scrollTop < 50 }`
        )
    )
    await click('.kam-logs-follow', 'follow newest log')
    await waitFor(
        `function () { const element = document.querySelector('[data-testid="log-scroll"]'); return element.scrollHeight - element.scrollTop - element.clientHeight < 40 }`,
        'bottom follow'
    )
    await input('[aria-label="搜索日志"]', 'Synthetic log 17')
    await waitFor(
        `function () { return [...document.querySelectorAll('.kam-logs-message')].every((element) => element.textContent.includes('Synthetic log 17')) && document.querySelectorAll('.kam-logs-message').length > 0 }`,
        'log text filter'
    )
    await navigate('about')
    await navigate('logs')
    check(
        'log filter survives navigation',
        await run(
            `function () { return document.querySelector('[aria-label="搜索日志"]').value === 'Synthetic log 17' }`
        )
    )
    await input('[aria-label="显示条数"]', 'all', 'change')
    check(
        'display limit storage',
        await run(
            `function () { return localStorage.getItem('systemLogs_displayLimit') === 'all' }`
        )
    )
    await screenshot('phase3-logs-light-zh')
    await run(`function () {
        window.__exports = []
        URL.createObjectURL = (blob) => { window.__exportBlob = blob; return 'blob:synthetic' }
        URL.revokeObjectURL = () => {}
        HTMLAnchorElement.prototype.click = function () { window.__exports.push(this.download) }
    }`)
    await click('[data-testid="page-logs"] button[aria-label="导出"]', 'export filtered logs')
    check(
        'original log export format',
        await run(
            `async function () { const text = await window.__exportBlob.text(); return window.__exports[0].endsWith('.log') && text.includes('[gateway] Synthetic log 17') && text.split('\\n').length === 11 }`
        )
    )
    await input('[aria-label="搜索日志"]', '')
    await chooseMenu(0, 1)
    await chooseMenu(1, 2)
    for (const page of ['about', 'webhooks', 'logs']) {
        await navigate(page)
        await screenshot(`phase3-${page}-dark-en`)
        check(
            `${page} English content`,
            await run(
                `function () { return document.querySelector('[data-testid="page-${page}"] h1').textContent.match(/[A-Za-z]/) }`
            )
        )
    }
    await click('[data-testid="page-logs"] button[aria-label="Clear all"]', 'clear synthetic logs')
    await waitFor(
        `function () { return document.querySelectorAll('[data-testid="log-row"]').length === 0 }`,
        'logs clear'
    )
    check(
        'clear invokes IPC',
        report.calls.some((call) => call.name === 'proxyClearLogs')
    )
    await navigate('home')
    await chooseMenu(1, 1)
}

module.exports = { verifySmallPages }
