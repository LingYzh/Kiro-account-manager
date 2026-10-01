/* Synthetic update and account-export Electron checks. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

async function mockUpdateExport(name, args, scenario) {
    if (name === 'downloadUpdate') {
        if (scenario === 'update-download-fail')
            return { success: false, error: 'Synthetic download failure' }
        if (scenario === 'update-download-slow')
            await new Promise((resolve) => setTimeout(resolve, 250))
        return { success: true }
    }
    if (name === 'installUpdate') {
        if (scenario === 'update-install-fail') throw new Error('Synthetic install failure')
        return null
    }
    if (name === 'exportToFile') {
        if (scenario === 'export-cancel') return false
        if (scenario === 'export-fail') throw new Error('Synthetic export failure')
        if (scenario === 'export-slow') await new Promise((resolve) => setTimeout(resolve, 250))
        return true
    }
    if (name === 'openExternal') return { success: true }
    return undefined
}

async function verifyUpdateExport(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario, emitEvent } =
        harness
    const calls = (name) => report.calls.filter((entry) => entry.name === name)
    const updateDialog = '[data-testid="update-dialog"][open]'
    const exportDialog = 'dialog[open] [data-testid="account-export-dialog"]'
    const exportSelector = (testId) => `dialog[open] [data-testid="${testId}"]`
    const exportClick = (testId, label) => click(exportSelector(testId), label)
    const updateInfo = {
        version: '9.9.9',
        releaseNotes:
            '# Synthetic release\n\n[Safe link](https://example.invalid/release)\n\n<script>window.__unsafeUpdate = true</script>\n\n[Unsafe link](javascript:alert(1))'
    }

    async function waitForCall(name, count, label) {
        const deadline = Date.now() + 3000
        while (calls(name).length < count && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        check(label, calls(name).length === count)
    }

    check(
        'six update listeners mounted once',
        await run(`function () {
            const counts = window.api.__testListenerCounts()
            return ['mock-update-checking', 'mock-update-available', 'mock-update-not-available',
                'mock-update-progress', 'mock-update-downloaded', 'mock-update-error']
                .every((name) => counts[name] === 1)
        }`)
    )
    check('no automatic update check', calls('checkForUpdatesManual').length === 0)
    emitEvent('mock-update-checking')
    emitEvent('mock-update-not-available', { version: '1.7.9' })
    check(
        'checking and no-update do not open dialog',
        !(await run(
            `function () { return Boolean(document.querySelector(${JSON.stringify(updateDialog)})) }`
        ))
    )

    emitEvent('mock-update-available', updateInfo)
    await waitFor(
        `function () { return Boolean(document.querySelector(${JSON.stringify(updateDialog)})) }`,
        'update available dialog'
    )
    check(
        'release notes render without script or javascript link',
        await run(`function () {
            const dialog = document.querySelector(${JSON.stringify(updateDialog)})
            return dialog?.textContent.includes('Synthetic release') &&
                !dialog.querySelector('script') &&
                !dialog.querySelector('a[href^="javascript:"]') &&
                !window.__unsafeUpdate
        }`)
    )
    await screenshot('phase3-update-available-light-zh')
    const beforeExternal = calls('openExternal').length
    await run(
        `function () { document.querySelector(${JSON.stringify(updateDialog)})?.querySelector('a[href="https://example.invalid/release"]')?.click() }`
    )
    await waitForCall('openExternal', beforeExternal + 1, 'release link dispatched')
    check(
        'safe release link opens externally',
        calls('openExternal').length === beforeExternal + 1 &&
            calls('openExternal').at(-1).args[0] === 'https://example.invalid/release'
    )

    setScenario('update-download-fail')
    await click('[data-testid="update-download"]', 'download update failure')
    await waitFor(
        `function () { return document.querySelector('[data-testid="update-error"]')?.textContent.includes('Synthetic download failure') }`,
        'download failure'
    )
    check('download failure invokes once', calls('downloadUpdate').length === 1)
    emitEvent('mock-update-available', updateInfo)
    setScenario('update-download-slow')
    const beforeDownload = calls('downloadUpdate').length
    await click('[data-testid="update-download"]', 'download update')
    await run(`function () { document.querySelector('[data-testid="update-download"]')?.click() }`)
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="update-progress"]')) }`,
        'downloading state'
    )
    emitEvent('mock-update-progress', {
        percent: 42.5,
        bytesPerSecond: 1024,
        transferred: 2048,
        total: 4096
    })
    await waitFor(
        `function () { return document.querySelector(${JSON.stringify(updateDialog)})?.textContent.includes('42.5%') }`,
        'update progress'
    )
    check('download repeated click locked', calls('downloadUpdate').length === beforeDownload + 1)
    check(
        'downloading hides close button',
        !(await run(
            `function () { return Boolean(document.querySelector('[data-testid="update-close"]')) }`
        ))
    )
    await run(`function () {
        const dialog = document.querySelector(${JSON.stringify(updateDialog)})
        dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        dialog?.dispatchEvent(new Event('cancel', { cancelable: true }))
    }`)
    check(
        'Escape cannot close downloading dialog',
        await run(
            `function () { return Boolean(document.querySelector(${JSON.stringify(updateDialog)})) }`
        )
    )
    await screenshot('phase3-update-downloading-light-zh')

    emitEvent('mock-update-downloaded', updateInfo)
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="update-install"]')) }`,
        'update downloaded'
    )
    setScenario('update-install-fail')
    await click('[data-testid="update-install"]', 'install update failure')
    await waitFor(
        `function () { return document.querySelector('[data-testid="update-error"]')?.textContent.includes('Synthetic install failure') }`,
        'install failure'
    )
    check('install failure invokes once', calls('installUpdate').length === 1)
    emitEvent('mock-update-downloaded', updateInfo)
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="update-install"]')) }`,
        'retry install available'
    )
    setScenario('update-install-slow')
    const beforeInstall = calls('installUpdate').length
    await click('[data-testid="update-install"]', 'install update')
    await run(`function () { document.querySelector('[data-testid="update-install"]')?.click() }`)
    await waitForCall('installUpdate', beforeInstall + 1, 'install action dispatched')
    check('install repeated click locked', calls('installUpdate').length === beforeInstall + 1)
    emitEvent('mock-update-error', 'Synthetic updater event error')
    await waitFor(
        `function () { return document.querySelector('[data-testid="update-error"]')?.textContent.includes('Synthetic updater event error') }`,
        'updater event error'
    )
    await click('[data-testid="update-close"]', 'close update dialog')
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(updateDialog)}) }`,
        'update closed'
    )
    emitEvent('mock-update-available', updateInfo)
    await waitFor(
        `function () { return Boolean(document.querySelector(${JSON.stringify(updateDialog)})) }`,
        'later available reopens'
    )
    await click('[data-testid="update-close"]', 'close reopened update dialog')
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(updateDialog)}) }`,
        'reopened update closed'
    )

    await click('#kam-navigation-tab-settings', 'settings export page')
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="page-settings"]')) }`,
        'settings page'
    )
    await click('[data-testid="settings-export"]', 'open account export')
    await waitFor(
        `function () { return Boolean(document.querySelector(${JSON.stringify(exportDialog)})) }`,
        'account export dialog'
    )
    check(
        'all six synthetic accounts counted',
        await run(
            `function () { return document.querySelector('dialog[open]')?.textContent.includes('全部 6 个') }`
        )
    )
    await screenshot('phase3-export-light-zh')

    setScenario('export-cancel')
    await exportClick('export-submit', 'cancel JSON file picker')
    check(
        'file picker cancel keeps dialog',
        await run(
            `function () { return Boolean(document.querySelector(${JSON.stringify(exportDialog)})) }`
        )
    )
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(exportSelector('export-submit'))})?.disabled }`,
        'cancelled file picker released export lock'
    )
    setScenario('export-fail')
    await exportClick('export-submit', 'failed JSON export')
    await waitFor(
        `function () { return document.querySelector(${JSON.stringify(exportSelector('account-export-error'))})?.textContent.includes('Synthetic export failure') }`,
        'export error'
    )
    setScenario('export-slow')
    const beforeJson = calls('exportToFile').length
    await exportClick('export-submit', 'save JSON export')
    await run(
        `function () { document.querySelector(${JSON.stringify(exportSelector('export-submit'))})?.click() }`
    )
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(exportDialog)}) }`,
        'JSON export closed'
    )
    check('file export repeated click locked', calls('exportToFile').length === beforeJson + 1)
    const jsonCall = calls('exportToFile').at(-1).args
    const jsonData = JSON.parse(jsonCall[0])
    check(
        'JSON export retains six accounts and import metadata',
        jsonData.accounts.length === 6 &&
            Array.isArray(jsonData.groups) &&
            Array.isArray(jsonData.tags)
    )
    check(
        'JSON filename follows original pattern',
        /^kiro-accounts-\d{4}-\d{2}-\d{2}\.json$/.test(jsonCall[1])
    )

    setScenario('export-normal')
    await click('[data-testid="settings-export"]', 'reopen export for credentials')
    await exportClick('export-include-credentials', 'exclude credentials')
    await exportClick('export-submit', 'save masked JSON')
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(exportDialog)}) }`,
        'masked JSON closed'
    )
    const masked = JSON.parse(calls('exportToFile').at(-1).args[0])
    check(
        'JSON masks only three original credential fields',
        masked.accounts.length === 6 &&
            masked.accounts.every(
                (account) =>
                    account.credentials.accessToken === '' &&
                    account.credentials.refreshToken === '' &&
                    account.credentials.csrfToken === '' &&
                    account.credentials.provider === 'Google'
            )
    )

    async function exportFormat(format, extension) {
        await click('[data-testid="settings-export"]', `open ${format} export`)
        await exportClick(`export-format-${format}`, `choose ${format}`)
        await exportClick('export-submit', `save ${format}`)
        await waitFor(
            `function () { return !document.querySelector(${JSON.stringify(exportDialog)}) }`,
            `${format} export closed`
        )
        const args = calls('exportToFile').at(-1).args
        check(`${format} filename`, args[1].endsWith(`.${extension}`))
        return args[0]
    }
    const oidc = JSON.parse(await exportFormat('oidc', 'json'))
    check(
        'OIDC credentials independent of checkbox',
        oidc.length === 6 &&
            oidc[0].refreshToken === 'synthetic-refresh' &&
            oidc[0].provider === 'Google'
    )
    const txt = await exportFormat('txt', 'txt')
    check(
        'TXT follows persisted credentials choice',
        txt.includes('邮箱: offline-0@example.invalid') && !txt.includes('synthetic-refresh')
    )
    const csv = await exportFormat('csv', 'csv')
    check(
        'CSV BOM and persisted credentials choice',
        csv.startsWith('\ufeff"邮箱","昵称","登录方式","订阅类型"') &&
            !csv.includes('synthetic-refresh')
    )
    const kami = await exportFormat('kami', 'txt')
    check(
        'card key credentials independent of checkbox',
        kami.includes('offline-0@example.invalid----no_password----synthetic-refresh') &&
            kami.split('\n').length === 6
    )

    await run(`function () {
        window.__exportClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (value) => { window.__exportCopied = value } }
        })
    }`)
    await click('[data-testid="settings-export"]', 'open clipboard export')
    await exportClick('export-format-clipboard', 'choose clipboard')
    await exportClick('export-submit', 'copy account summary')
    await waitFor(
        `function () { return typeof window.__exportCopied === 'string' }`,
        'clipboard copied'
    )
    check(
        'clipboard summary respects persisted checkbox',
        await run(
            `function () { return window.__exportCopied.includes('offline-0@example.invalid (Synthetic 0) - KIRO FREE') && !window.__exportCopied.includes('synthetic-refresh') }`
        )
    )
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(exportDialog)}) }`,
        'clipboard delayed close',
        4000
    )
    await run(`function () {
        if (window.__exportClipboardDescriptor) Object.defineProperty(navigator, 'clipboard', window.__exportClipboardDescriptor)
        else delete navigator.clipboard
        delete window.__exportClipboardDescriptor
        delete window.__exportCopied
    }`)
    await chooseMenu(0, 1)
    await chooseMenu(1, 2)
    emitEvent('mock-update-available', updateInfo)
    await waitFor(
        `function () { return Boolean(document.querySelector(${JSON.stringify(updateDialog)})) }`,
        'dark English update dialog'
    )
    await screenshot('phase3-update-dark-en')
    await click('[data-testid="update-close"]', 'close English update dialog')
    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    await click('#kam-navigation-tab-home', 'return home after export')
    check('no automatic update check after export', calls('checkForUpdatesManual').length === 0)
}

module.exports = { mockUpdateExport, verifyUpdateExport }
