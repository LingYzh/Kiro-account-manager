/* Electron test fixture uses CommonJS and small event callbacks. */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const { app, BrowserWindow, ipcMain, session } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const artifactDir = process.env.KAM_SHELL_ARTIFACT_DIR
const mode = process.env.KAM_SHELL_MODE
const url = process.env.KAM_SHELL_URL
const pageSuites = [
    ['home', './vue-phase3-home.cjs', 'verifyHome'],
    ['account-add', './vue-phase3-account-add.cjs', 'verifyAccountAdd'],
    ['accounts', './vue-phase3-accounts.cjs', 'verifyAccounts'],
    ['account-details', './vue-phase3-account-details.cjs', 'verifyAccountDetails'],
    ['proxy-pool', './vue-phase3-proxy-pool.cjs', 'verifyProxyPool'],
    ['proxy', './vue-phase3-proxy.cjs', 'verifyProxy'],
    ['subscription', './vue-phase3-subscription.cjs', 'verifySubscription'],
    ['register', './vue-phase3-register.cjs', 'verifyRegistration'],
    ['settings', './vue-phase3-settings.cjs', 'verifySettings'],
    ['update-export', './vue-phase3-update-export.cjs', 'verifyUpdateExport'],
    ['small', './vue-phase3-checks.cjs', 'verifySmallPages'],
    ['machine', './vue-phase3-machine.cjs', 'verifyMachineId'],
    ['config', './vue-phase3-config.cjs', 'verifyConfigSync'],
    ['diagnose', './vue-phase3-diagnose.cjs', 'verifyDiagnose'],
    ['kiro', './vue-phase3-kiro.cjs', 'verifyKiro'],
    ['kproxy', './vue-phase3-kproxy.cjs', 'verifyKProxy']
]
const pageGroups = process.env.KAM_SHELL_PAGE_GROUPS
    ? process.env.KAM_SHELL_PAGE_GROUPS.split(',')
    : pageSuites.map(([name]) => name)
assert.ok(
    pageGroups.every((name) => pageSuites.some(([known]) => known === name)),
    'Unknown page group'
)
const report = {
    mode,
    url,
    candidate: process.env.KAM_SHELL_CANDIDATE ? JSON.parse(process.env.KAM_SHELL_CANDIDATE) : null,
    devPrewarmed: process.env.KAM_SHELL_DEV_PREWARMED === '1',
    pageGroups,
    checks: [],
    errors: [],
    expectedDiagnostics: [],
    calls: [],
    screenshots: []
}
let window
let reloading = false
let consoleProbeSeen = false
let pageScenario = 'update-available'
let mockLogs = Array.from({ length: 180 }, (_, index) => ({
    timestamp: new Date(Date.now() - (180 - index) * 1000).toISOString(),
    level: ['DEBUG', 'INFO', 'WARN', 'ERROR'][index % 4],
    category: index % 2 ? 'gateway' : 'system',
    message: `Synthetic log ${index}`,
    ...(index % 5 === 0 ? { data: { index, synthetic: true } } : {})
}))

async function mockPageCall(name, ...args) {
    report.calls.push({ name, args })
    const subscriptionResult = await require('./vue-phase3-subscription.cjs').mockSubscription(
        name,
        args,
        pageScenario
    )
    if (subscriptionResult !== undefined) return subscriptionResult
    const registrationResult = await require('./vue-phase3-register.cjs').mockRegistration(
        name,
        args,
        pageScenario,
        (event, payload) => window.webContents.send(event, payload)
    )
    if (registrationResult !== undefined) return registrationResult
    const poolResult = await require('./vue-phase3-proxy-pool.cjs').mockProxyPool(
        name,
        args,
        pageScenario
    )
    if (poolResult !== undefined) return poolResult
    if (pageScenario.startsWith('account-detail') || pageScenario.startsWith('account-edit')) {
        const detailResult = await require('./vue-phase3-account-details.cjs').mockAccountDetails(
            name,
            args,
            pageScenario
        )
        if (detailResult !== undefined) return detailResult
    }
    const proxyResult = await require('./vue-phase3-proxy.cjs').mockProxy(name, args, pageScenario)
    if (proxyResult !== undefined) return proxyResult
    const addResult = await require('./vue-phase3-account-add.cjs').mockAccountAdd(
        name,
        args,
        pageScenario
    )
    if (addResult !== undefined) return addResult
    const accountsResult = await require('./vue-phase3-accounts.cjs').mockAccounts(
        name,
        args,
        pageScenario
    )
    if (accountsResult !== undefined) return accountsResult
    const updateExportResult = await require('./vue-phase3-update-export.cjs').mockUpdateExport(
        name,
        args,
        pageScenario
    )
    if (updateExportResult !== undefined) return updateExportResult
    const settingsResult = await require('./vue-phase3-settings.cjs').mockSettings(
        name,
        args,
        pageScenario
    )
    if (settingsResult !== undefined) return settingsResult
    const kiroResult = await require('./vue-phase3-kiro.cjs').mockKiro(name, args, pageScenario)
    if (kiroResult !== undefined) return kiroResult
    const kproxyResult = await require('./vue-phase3-kproxy.cjs').mockKProxy(
        name,
        args,
        pageScenario
    )
    if (kproxyResult !== undefined) return kproxyResult
    const machineResult = await require('./vue-phase3-machine.cjs').mockMachineId(
        name,
        args,
        pageScenario
    )
    if (machineResult !== undefined) return machineResult
    const diagnoseResult = await require('./vue-phase3-diagnose.cjs').mockDiagnose(
        name,
        args,
        pageScenario
    )
    if (diagnoseResult !== undefined) return diagnoseResult
    if (name === 'checkForUpdatesManual') {
        await new Promise((resolve) => setTimeout(resolve, 150))
        if (pageScenario === 'update-throw') throw new Error('Synthetic update failure')
        if (pageScenario === 'update-current') return { hasUpdate: false, currentVersion: '1.7.9' }
        return {
            hasUpdate: true,
            currentVersion: '1.7.9',
            latestVersion: '9.0.0',
            releaseName: 'Synthetic release',
            releaseNotes: 'Offline release notes',
            releaseUrl: 'https://example.invalid/release',
            publishedAt: '2026-10-01T00:00:00Z',
            assets: Array.from({ length: 8 }, (_, index) => ({
                name: `artifact-${index}.zip`,
                size: 2048,
                downloadUrl: 'https://example.invalid/download'
            }))
        }
    }
    if (name === 'proxyGetLogs') return args[0] ? mockLogs.slice(-args[0]) : mockLogs
    if (name === 'proxyGetLogsCount') return mockLogs.length
    if (name === 'proxyClearLogs') {
        mockLogs = []
        return { success: true }
    }
    if (name === 'openExternal') return undefined
    throw new Error(`Missing offline page mock: ${name}`)
}

function check(name, condition, detail) {
    assert.ok(condition, `${name}: ${JSON.stringify(detail)}`)
    report.checks.push(name)
}

async function run(script) {
    return window.webContents.executeJavaScript(`(${script})()`, true)
}

async function waitFor(script, name, timeout = 8000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
        const result = await run(script)
        if (result) return result
        // A hidden Windows window may stop compositor frames during a timer-driven close.
        // Request a real frame so the library's native dialog animation can finish.
        const closing = await run(
            "function () { return !!document.querySelector('dialog[open][data-state=closing]') }"
        )
        if (closing) await window.webContents.capturePage(undefined, { stayHidden: true })
        await new Promise((resolve) => setTimeout(resolve, 80))
    }
    throw new Error(`Timed out: ${name}`)
}

async function screenshot(name) {
    await waitFor(
        `function () {
        const sidebar = document.querySelector('.kam-sidebar')
        if (!sidebar) return false
        const expected = sidebar.classList.contains('is-collapsed') ? 64 : 224
        return Math.abs(sidebar.getBoundingClientRect().width - expected) < 2 &&
            !document.querySelector('.ui-menu-surface:popover-open')
    }`,
        `settled layout for ${name}`
    )
    if (name.startsWith('dark-')) {
        await waitFor(
            `function () {
            const selected = document.querySelector('.kam-navigation [role="tab"][aria-selected="true"]')
            const other = document.querySelector('.kam-navigation [role="tab"][aria-selected="false"]')
            const footer = document.querySelector('.kam-sidebar-footer > button')
            if (!selected || !other || !footer) return false
            return getComputedStyle(selected).backgroundColor === 'rgb(73, 54, 44)' &&
                getComputedStyle(selected).color === 'rgb(230, 160, 134)' &&
                getComputedStyle(other).color === 'rgb(178, 175, 163)' &&
                getComputedStyle(footer).color === 'rgb(241, 240, 233)'
        }`,
            `settled dark component colors for ${name}`
        )
    }
    await window.webContents.executeJavaScript(
        `(async () => {
        const animations = document.getAnimations({ subtree: true }).filter((animation) =>
            animation.effect?.getTiming().iterations !== Infinity)
        await Promise.race([
            Promise.all(animations.map((animation) => animation.finished.catch(() => {}))),
            new Promise((resolve) => setTimeout(resolve, 1500))
        ])
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })()`,
        true
    )
    // Wake the hidden window compositor before retaining the final frame.
    await window.capturePage(undefined, { stayHidden: true })
    await new Promise((resolve) => setTimeout(resolve, 180))
    const themeAtCapture = await run(`function () {
        const panel = document.querySelector('.kam-content [role="tabpanel"].is-active')
        const card = panel?.querySelector('.ui-card')
        const rect = card?.getBoundingClientRect()
        const style = card && getComputedStyle(card)
        const panelStyle = panel && getComputedStyle(panel)
        const ancestry = []
        for (let node = card; node && ancestry.length < 8; node = node.parentElement) {
            const computed = getComputedStyle(node)
            ancestry.push({ tag: node.tagName, className: String(node.className), opacity: computed.opacity, filter: computed.filter })
        }
        return {
            theme: document.documentElement.dataset.theme,
            viewport: { width: innerWidth, height: innerHeight },
            background: getComputedStyle(document.querySelector('.kam-shell')).backgroundColor,
            selectedTabBackground: getComputedStyle(document.querySelector('.kam-navigation [role="tab"][aria-selected="true"]')).backgroundColor,
            selectedTabColor: getComputedStyle(document.querySelector('.kam-navigation [role="tab"][aria-selected="true"]')).color,
            otherTabColor: getComputedStyle(document.querySelector('.kam-navigation [role="tab"][aria-selected="false"]')).color,
            footerButtonColor: getComputedStyle(document.querySelector('.kam-sidebar-footer > button')).color,
            logo: (() => {
                const image = document.querySelector('.kam-logo')
                return image && {
                    src: image.currentSrc || image.src,
                    complete: image.complete,
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                    filter: getComputedStyle(image).filter
                }
            })(),
            activePanel: panel && { id: panel.id, display: panelStyle.display, opacity: panelStyle.opacity, filter: panelStyle.filter },
            card: card && {
                background: style.backgroundColor, border: style.borderTopColor,
                opacity: style.opacity, filter: style.filter,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            },
            ancestry
        }
    }`)
    report[`${name}CaptureState`] = themeAtCapture
    check(
        `${name} logo loaded without filter`,
        themeAtCapture.logo?.complete &&
            themeAtCapture.logo.naturalWidth > 0 &&
            themeAtCapture.logo.naturalHeight > 0 &&
            themeAtCapture.logo.filter === 'none',
        themeAtCapture.logo
    )
    if (name.startsWith('dark-')) {
        check(
            `${name} capture uses dark theme`,
            themeAtCapture.theme === 'dark' &&
                themeAtCapture.background === 'rgb(38, 38, 36)' &&
                themeAtCapture.selectedTabBackground === 'rgb(73, 54, 44)' &&
                themeAtCapture.selectedTabColor === 'rgb(230, 160, 134)' &&
                themeAtCapture.otherTabColor === 'rgb(178, 175, 163)' &&
                themeAtCapture.footerButtonColor === 'rgb(241, 240, 233)',
            themeAtCapture
        )
    }
    const path = join(artifactDir, `${mode}-${name}.png`)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const capture = await window.capturePage(undefined, { stayHidden: true })
    const bitmap = capture.toBitmap()
    const imageSize = capture.getSize()
    const sample = (x, y) => {
        const pixelX = Math.round((x * imageSize.width) / themeAtCapture.viewport.width)
        const pixelY = Math.round((y * imageSize.height) / themeAtCapture.viewport.height)
        const offset = (pixelY * imageSize.width + pixelX) * 4
        return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]]
    }
    if (themeAtCapture.card) {
        const rect = themeAtCapture.card.rect
        themeAtCapture.cardPixels = {
            inside: sample(rect.x + 12, rect.y + 12),
            outside: sample(rect.x + 30, rect.y - 12),
            leftBorder: sample(rect.x, rect.y + Math.min(55, rect.height / 2))
        }
        if (name.startsWith('dark-')) {
            check(
                `${name} card pixels match dark surface`,
                themeAtCapture.cardPixels.inside.join(',') === '48,48,45' &&
                    themeAtCapture.cardPixels.outside.join(',') === '38,38,36' &&
                    themeAtCapture.card.background === 'rgb(48, 48, 45)' &&
                    themeAtCapture.card.border === 'rgb(72, 71, 63)' &&
                    themeAtCapture.activePanel.opacity === '1' &&
                    themeAtCapture.ancestry.every(
                        (item) => item.opacity === '1' && item.filter === 'none'
                    ),
                themeAtCapture
            )
        }
    }
    await writeFile(path, capture.toPNG())
    report.screenshots.push(path)
}

async function click(selector, name) {
    const result = await window.webContents.executeJavaScript(
        `(() => {
        const element = document.querySelector(${JSON.stringify(selector)})
        if (!element) return false
        element.click()
        return true
    })()`,
        true
    )
    check(`click ${name}`, result, selector)
}

async function inspectShell() {
    return run(`function () {
        const shell = document.querySelector('.kam-shell')
        const title = document.querySelector('.kam-titlebar')
        const sidebar = document.querySelector('.kam-sidebar')
        const main = document.querySelector('.kam-content')
        const nav = [...document.querySelectorAll('.kam-navigation [role="tab"]')]
        const bounds = (element) => element && {
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height
        }
        return {
            shell: bounds(shell), title: bounds(title), sidebar: bounds(sidebar), main: bounds(main),
            collapsed: sidebar?.classList.contains('is-collapsed'),
            nav: nav.map((element) => element.textContent.trim() || element.querySelector('svg')?.getAttribute('aria-label')),
            tabIds: nav.map((element) => element.id),
            controls: nav.map((element) => element.getAttribute('aria-controls')),
            selected: nav.findIndex((element) => element.getAttribute('aria-selected') === 'true'),
            orientation: document.querySelector('.kam-navigation [role="tablist"]')?.getAttribute('aria-orientation'),
            tooltipCount: document.querySelectorAll('.kam-navigation [role="tooltip"]').length,
            collapsedTitles: nav.map((element) => element.querySelector('.kam-tab-content')?.getAttribute('title')),
            theme: document.documentElement.dataset.theme,
            pages: [...document.querySelectorAll('.kam-content [role="tabpanel"]')].map((panel) => ({
                id: panel.id,
                labelledby: panel.getAttribute('aria-labelledby'),
                title: panel.querySelector('h1')?.textContent?.trim(),
                display: getComputedStyle(panel).display
            }))
        }
    }`)
}

async function chooseMenu(index, option) {
    await click(
        `.kam-sidebar-footer .ui-menu:nth-of-type(${index + 1}) [aria-haspopup="menu"]`,
        `menu ${index}`
    )
    await waitFor(
        `function () { return Boolean(document.querySelector('.kam-sidebar-footer .ui-menu:nth-of-type(${index + 1}) [role="menu"]:popover-open')) }`,
        'menu open'
    )
    await click(
        `.kam-sidebar-footer .ui-menu:nth-of-type(${index + 1}) [role="menuitemcheckbox"]:nth-child(${option + 1})`,
        `menu ${index} option ${option}`
    )
}

async function press(key) {
    await window.webContents.executeJavaScript(
        `(() => {
        const target = document.activeElement
        target.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
        target.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
    })()`,
        true
    )
}

async function rippleSnapshot(phase, exercise = false) {
    report.rippleDiagnostics ??= {}
    report.rippleDiagnostics[phase] = await run(`function () {
        return [...document.querySelectorAll('.kam-sidebar-footer button')]
            .filter((button) => !button.closest('[role="menu"]'))
            .map((button, index) => {
                if (${exercise}) {
                    const bounds = button.getBoundingClientRect()
                    button.dispatchEvent(new PointerEvent('pointerdown', {
                        bubbles: true, button: 0, isPrimary: true, pointerId: index + 90,
                        clientX: bounds.left + bounds.width / 2,
                        clientY: bounds.top + bounds.height / 2
                    }))
                }
                const layer = button.querySelector('.ui-ripple-layer')
                const details = {
                    index, label: button.getAttribute('aria-label'), className: button.className,
                    position: getComputedStyle(button).position,
                    offsetParent: button.offsetParent?.className ?? null,
                    layerPresent: Boolean(layer),
                    layerOffsetParentIsButton: layer?.offsetParent === button,
                    layerPosition: layer && getComputedStyle(layer).position
                }
                if (${exercise}) button.dispatchEvent(new Event('blur'))
                return details
            })
    }`)
}

async function verifyLogo(label, theme, collapsed) {
    report.logoStates ??= []
    const state = await run(`function () {
        const image = document.querySelector('.kam-logo')
        return {
            theme: document.documentElement.dataset.theme,
            collapsed: document.querySelector('.kam-sidebar')?.classList.contains('is-collapsed'),
            src: image?.currentSrc || image?.src,
            complete: image?.complete,
            naturalWidth: image?.naturalWidth,
            naturalHeight: image?.naturalHeight,
            filter: image && getComputedStyle(image).filter
        }
    }`)
    report.logoStates.push({ label, ...state })
    check(
        `${label} logo loaded without filter`,
        state.theme === theme &&
            state.collapsed === collapsed &&
            state.complete &&
            state.naturalWidth > 0 &&
            state.naturalHeight > 0 &&
            state.filter === 'none',
        state
    )
}

async function verifyDialog(action, remember) {
    const before = report.calls.filter((call) => call.name === 'close-response').length
    window.webContents.send('mock-close-confirm')
    await waitFor(
        `function () { return Boolean(document.querySelector('.ui-dialog--sm[data-state="open"]')) }`,
        'close dialog'
    )
    if (remember) {
        await click('.ui-dialog--sm input[type="checkbox"]', 'remember choice')
        check(
            'remember checkbox checked',
            await run(
                `function () { return document.querySelector('.ui-dialog--sm input[type="checkbox"]')?.checked }`
            )
        )
    }
    if (action === 'cancel') await click('.ui-dialog--sm .ui-dialog-footer button', 'cancel')
    else if (action === 'minimize')
        await click('.ui-dialog--sm .ui-dialog-body button:nth-of-type(1)', 'minimize to tray')
    else await click('.ui-dialog--sm .ui-dialog-body button:nth-of-type(2)', 'quit')
    await waitFor(
        `function () { return !document.querySelector('.ui-dialog--sm[open]') }`,
        'dialog closed'
    )
    const responses = report.calls.filter((call) => call.name === 'close-response')
    check(
        `${action} forwarded`,
        responses.length === before + 1 &&
            responses.at(-1).args[0] === action &&
            responses.at(-1).args[1] === remember,
        responses
    )
}

async function verify() {
    const initial = await waitFor(
        `function () { return Boolean(document.querySelector('.kam-shell .kam-titlebar') && document.querySelector('.kam-sidebar [role="tab"]') && document.querySelector('.kam-content [role="tabpanel"]')) }`,
        'App.vue mount'
    )
    check('App mounted', initial)
    await waitFor(
        `function () { return document.querySelector('.kam-titlebar')?.textContent?.includes('v1.7.9') }`,
        'title initialized'
    )
    const initializationStarted = Date.now()
    while (!report.calls.some((call) => call.name === 'tray-language')) {
        if (Date.now() - initializationStarted > 8000) throw new Error('Timed out: app initialized')
        await new Promise((resolve) => setTimeout(resolve, 80))
    }
    const shell = await inspectShell()
    check(
        'shell and regions have size',
        [shell.shell, shell.title, shell.sidebar, shell.main].every(
            (size) => size.width > 0 && size.height > 0
        ),
        shell
    )
    check(
        'sidebar initially collapsed',
        shell.collapsed && shell.sidebar.width >= 60 && shell.sidebar.width <= 70,
        shell
    )
    const expected = [
        '主页',
        '账户管理',
        '机器码',
        'Kiro 设置',
        'API 反代',
        'K-Proxy',
        '代理池',
        '注册',
        '批量订阅',
        'Webhook',
        '一键诊断',
        '配置同步',
        '系统日志',
        '设置',
        '关于'
    ]
    check(
        '15 navigation items in order',
        JSON.stringify(shell.nav) === JSON.stringify(expected),
        shell.nav
    )
    const ids = [
        'home',
        'accounts',
        'machineId',
        'kiroSettings',
        'proxy',
        'kproxy',
        'proxyPool',
        'register',
        'subscription',
        'webhooks',
        'diagnose',
        'configSync',
        'logs',
        'settings',
        'about'
    ]
    check(
        'vertical tablist and linked ids',
        shell.orientation === 'vertical' &&
            ids.every(
                (id, index) =>
                    shell.tabIds[index] === `kam-navigation-tab-${id}` &&
                    shell.controls[index] === `kam-navigation-panel-${id}`
            ),
        shell
    )
    check('no navigation tooltips', shell.tooltipCount === 0)
    check(
        'collapsed tabs have titles',
        JSON.stringify(shell.collapsedTitles) === JSON.stringify(expected),
        shell.collapsedTitles
    )
    check('home selected', shell.selected === 0 && shell.pages.length === 1, shell)
    check('initial light theme', shell.theme === 'light', shell)
    await verifyLogo('light collapsed', 'light', true)
    await rippleSnapshot('collapsed')
    check(
        'collapsed footer ripple hosts positioned',
        report.rippleDiagnostics.collapsed.length === 3 &&
            report.rippleDiagnostics.collapsed.every(
                (item) =>
                    item.className.includes('ui-ripple-target') && item.position === 'relative'
            ),
        report.rippleDiagnostics.collapsed
    )
    await screenshot('light-collapsed')

    await click('.kam-sidebar-footer > button', 'expand sidebar')
    await waitFor(
        `function () { return !document.querySelector('.kam-sidebar')?.classList.contains('is-collapsed') }`,
        'expanded sidebar'
    )
    check(
        'expanded tabs have no titles',
        (await inspectShell()).collapsedTitles.every((title) => title === null)
    )
    await verifyLogo('light expanded', 'light', false)
    await rippleSnapshot('expanded', true)
    check(
        'expanded footer ripple stays inside each button',
        report.rippleDiagnostics.expanded.length === 3 &&
            report.rippleDiagnostics.expanded.every(
                (item) =>
                    item.className.includes('ui-ripple-target') &&
                    item.position === 'relative' &&
                    item.layerPresent &&
                    item.layerOffsetParentIsButton
            ),
        report.rippleDiagnostics.expanded
    )
    await click('#kam-navigation-tab-accounts', 'accounts navigation')
    await waitFor(
        `function () { return document.querySelectorAll('.kam-content [role="tabpanel"]').length === 2 }`,
        'second page mounted'
    )
    const navigated = await inspectShell()
    check(
        'visited page remains mounted',
        navigated.selected === 1 &&
            navigated.pages[0].id === 'kam-navigation-panel-home' &&
            navigated.pages[0].display === 'none' &&
            navigated.pages[1].title === '账户管理' &&
            navigated.pages[1].display !== 'none' &&
            navigated.pages[1].labelledby === 'kam-navigation-tab-accounts',
        navigated
    )
    await run(`function () { document.querySelector('#kam-navigation-tab-accounts').focus() }`)
    await press('ArrowDown')
    await waitFor(
        `function () { return document.activeElement?.id === 'kam-navigation-tab-machineId' && document.querySelector('#kam-navigation-tab-machineId')?.getAttribute('aria-selected') === 'true' }`,
        'ArrowDown tab activation'
    )
    await press('ArrowUp')
    await waitFor(
        `function () { return document.activeElement?.id === 'kam-navigation-tab-accounts' && document.querySelector('#kam-navigation-tab-accounts')?.getAttribute('aria-selected') === 'true' }`,
        'ArrowUp tab activation'
    )
    await press('End')
    await waitFor(
        `function () { return document.activeElement?.id === 'kam-navigation-tab-about' && document.querySelector('#kam-navigation-tab-about')?.getAttribute('aria-selected') === 'true' }`,
        'End tab activation'
    )
    await press('Home')
    await waitFor(
        `function () { return document.activeElement?.id === 'kam-navigation-tab-home' && document.querySelector('#kam-navigation-tab-home')?.getAttribute('aria-selected') === 'true' }`,
        'Home tab activation'
    )

    await chooseMenu(0, 1)
    await waitFor(
        `function () { return document.documentElement.dataset.theme === 'dark' }`,
        'dark theme'
    )
    check(
        'dark theme persisted',
        await run(`function () { return localStorage.getItem('kiro-vue-theme-mode') === 'dark' }`)
    )
    report.darkColors = await run(`function () {
        const root = getComputedStyle(document.documentElement)
        const shell = getComputedStyle(document.querySelector('.kam-shell'))
        const sidebar = getComputedStyle(document.querySelector('.kam-sidebar'))
        const card = getComputedStyle(document.querySelector('.kam-page .ui-card'))
        return {
            tokens: Object.fromEntries(['--background', '--sidebar', '--surface', '--text', '--border', '--accent-text'].map((name) => [name, root.getPropertyValue(name).trim()])),
            shellBackground: shell.backgroundColor, shellText: shell.color,
            sidebarBackground: sidebar.backgroundColor, sidebarBorder: sidebar.borderRightColor,
            cardBackground: card.backgroundColor, cardBorder: card.borderTopColor
        }
    }`)
    const colors = report.darkColors
    check(
        'dark UI tokens and rendered colors',
        colors.tokens['--background'] === '#262624' &&
            colors.tokens['--sidebar'] === '#20201e' &&
            colors.tokens['--surface'] === '#30302d' &&
            colors.tokens['--text'] === '#f1f0e9' &&
            colors.tokens['--border'] === '#48473f' &&
            colors.tokens['--accent-text'] === '#e6a086' &&
            colors.shellBackground === 'rgb(38, 38, 36)' &&
            colors.shellText === 'rgb(241, 240, 233)' &&
            colors.sidebarBackground === 'rgb(32, 32, 30)' &&
            colors.sidebarBorder === 'rgb(72, 71, 63)' &&
            colors.cardBackground === 'rgb(48, 48, 45)' &&
            colors.cardBorder === 'rgb(72, 71, 63)',
        colors
    )
    report.darkFilters = await run(`function () {
        return Object.fromEntries([
            ['root', document.documentElement],
            ['body', document.body],
            ['app', document.querySelector('#app')],
            ['shell', document.querySelector('.kam-shell')],
            ['logo', document.querySelector('.kam-logo')]
        ].map(([name, element]) => [name, getComputedStyle(element).filter]))
    }`)
    check(
        'dark filters remain clear',
        Object.values(report.darkFilters).every((filter) => filter === 'none'),
        report.darkFilters
    )
    await verifyLogo('dark expanded', 'dark', false)
    await screenshot('dark-expanded')
    await click('.kam-sidebar-footer > button', 'collapse sidebar in dark theme')
    await waitFor(
        `function () { return document.querySelector('.kam-sidebar')?.classList.contains('is-collapsed') }`,
        'dark sidebar collapsed'
    )
    await verifyLogo('dark collapsed', 'dark', true)
    await click('.kam-sidebar-footer > button', 'expand sidebar in dark theme')
    await waitFor(
        `function () { return !document.querySelector('.kam-sidebar')?.classList.contains('is-collapsed') }`,
        'dark sidebar expanded'
    )
    await chooseMenu(0, 0)
    await waitFor(
        `function () { return document.documentElement.dataset.theme === 'light' }`,
        'light theme'
    )
    await chooseMenu(0, 1)
    await waitFor(
        `function () { return document.documentElement.dataset.theme === 'dark' }`,
        'dark theme again'
    )

    await chooseMenu(1, 2)
    await waitFor(
        `function () { return document.querySelector('#kam-navigation-tab-home')?.textContent?.trim() === 'Home' }`,
        'English locale'
    )
    check('English locale', (await inspectShell()).nav[1] === 'Accounts')
    check(
        'tabpanel linkage after keyboard',
        await run(`function () {
        const active = document.querySelector('[role="tab"][aria-selected="true"]')
        const panel = active && document.getElementById(active.getAttribute('aria-controls'))
        return Boolean(panel && panel.getAttribute('aria-labelledby') === active.id && panel.getBoundingClientRect().height > 0)
    }`)
    )
    await screenshot('dark-english')
    await chooseMenu(1, 1)
    await waitFor(
        `function () { return document.querySelector('#kam-navigation-tab-home')?.textContent?.trim() === '主页' }`,
        'Chinese locale'
    )
    check('Chinese locale restored', (await inspectShell()).nav[1] === '账户管理')
    await rippleSnapshot('afterThemeLanguage')
    check(
        'footer ripple host survives theme and language changes',
        report.rippleDiagnostics.afterThemeLanguage.length === 3 &&
            report.rippleDiagnostics.afterThemeLanguage.every(
                (item) =>
                    item.className.includes('ui-ripple-target') && item.position === 'relative'
            ),
        report.rippleDiagnostics.afterThemeLanguage
    )

    window.webContents.send('mock-close-confirm')
    await waitFor(
        `function () { return Boolean(document.querySelector('.ui-dialog--sm[data-state="open"]')) }`,
        'close dialog screenshot'
    )
    check(
        'remember choice has visible associated label',
        await run(`function () {
        const input = document.querySelector('.ui-dialog--sm input[type="checkbox"]')
        return Boolean(input && input.closest('label')?.textContent?.includes('记住我的选择'))
    }`)
    )
    await screenshot('close-dialog')
    await click('.ui-dialog--sm .ui-dialog-footer button', 'close screenshot dialog')
    await waitFor(
        `function () { return !document.querySelector('.ui-dialog--sm[open]') }`,
        'screenshot dialog closed'
    )
    await verifyDialog('cancel', false)
    await verifyDialog('minimize', true)
    await verifyDialog('quit', false)

    const pageHarness = {
        run,
        waitFor,
        click,
        check,
        screenshot,
        chooseMenu,
        report,
        setScenario(value) {
            pageScenario = value
        },
        emitEvent(name, payload) {
            window.webContents.send(name, payload)
        },
        appendLogs() {
            mockLogs.push({
                timestamp: new Date().toISOString(),
                level: 'INFO',
                category: 'gateway',
                message: 'Synthetic appended log'
            })
        }
    }
    for (const [name, path, method] of pageSuites) {
        if (pageGroups.includes(name)) {
            await chooseMenu(0, 0)
            await chooseMenu(1, 1)
            await require(path)[method](pageHarness)
        }
    }
    if (pageGroups.includes('machine'))
        check('synthetic machine failure logged once', report.expectedDiagnostics.length === 1)
    await chooseMenu(0, 1)

    for (const [index, name] of [
        ['3', 'window-minimize'],
        ['2', 'window-maximize'],
        ['1', 'window-close']
    ]) {
        const before = report.calls.filter((call) => call.name === name).length
        await click(`.kam-window-actions button:nth-last-of-type(${index})`, name)
        const deadline = Date.now() + 2000
        while (
            report.calls.filter((call) => call.name === name).length === before &&
            Date.now() < deadline
        ) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        check(
            `${name} forwarded`,
            report.calls.filter((call) => call.name === name).length === before + 1
        )
    }

    if (mode === 'dev') {
        reloading = true
        const loaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
        window.webContents.reload()
        await loaded
        reloading = false
        await waitFor(
            `function () { return Boolean(document.querySelector('.kam-shell')) && document.documentElement.dataset.theme === 'dark' }`,
            'theme after reload'
        )
        check(
            'theme survives reload',
            await run(
                `function () { return localStorage.getItem('kiro-vue-theme-mode') === 'dark' }`
            )
        )
    }
    check(
        'mounted listeners exist',
        await run(`function () {
        return Object.values(window.api.__testListenerCounts()).some((count) => count > 0)
    }`)
    )
    await run(`function () { document.querySelector('#app').__vue_app__.unmount() }`)
    await waitFor(
        `function () {
        return Object.values(window.api.__testListenerCounts()).every((count) => count === 0)
    }`,
        'all page and app listeners released'
    )
    check('all page and app listeners released', true)
}

async function main() {
    report.phase = 'prepare user data'
    await mkdir(join(artifactDir, 'user-data'), { recursive: true })
    app.setPath('userData', join(artifactDir, 'user-data'))
    report.phase = 'Electron ready'
    await app.whenReady()
    const allowed = new URL(url)
    const fileRoot = allowed.protocol === 'file:' ? new URL('.', allowed).href : null
    const testSession = session.fromPartition(`vue-shell-${mode}`)
    testSession.webRequest.onBeforeRequest((details, callback) => {
        const target = new URL(details.url)
        const okay =
            target.protocol === 'data:' ||
            (allowed.protocol === 'file:'
                ? target.protocol === 'file:' && target.href.startsWith(fileRoot)
                : target.origin === allowed.origin ||
                  (target.protocol === 'ws:' && target.host === allowed.host))
        if (!okay) report.errors.push({ type: 'external request', url: details.url })
        callback({ cancel: !okay })
    })
    testSession.webRequest.onErrorOccurred((details) => {
        if (reloading && details.error === 'net::ERR_ABORTED') return
        report.errors.push({ type: 'resource failure', url: details.url, error: details.error })
    })
    for (const name of [
        'save-accounts',
        'tray-list',
        'tray-account',
        'tray-language',
        'close-response',
        'window-minimize',
        'window-maximize',
        'window-close'
    ]) {
        ipcMain.on(`mock-${name}`, (_event, ...args) => report.calls.push({ name, args }))
    }
    ipcMain.handle('mock-page-call', (_event, name, ...args) => mockPageCall(name, ...args))
    report.phase = 'create window'
    window = new BrowserWindow({
        width: 1200,
        height: 850,
        show: false,
        webPreferences: {
            preload: join(__dirname, 'vue-shell-preload.cjs'),
            partition: `vue-shell-${mode}`,
            sandbox: false,
            contextIsolation: true,
            backgroundThrottling: false
        }
    })
    window.webContents.on('console-message', (details) => {
        if (details.message === '__kam_vue_shell_console_probe__') {
            consoleProbeSeen = details.level === 'warning'
            return
        }
        if (
            pageScenario === 'machine-set-fail' &&
            details.message === '[MachineId] Failed to change: Synthetic set failure'
        ) {
            report.expectedDiagnostics.push(details.message)
            return
        }
        if (details.level === 'warning' || details.level === 'error' || details.level >= 2) {
            report.errors.push({
                type: 'console',
                level: details.level,
                message: details.message.replace(/data:font\/[^']+/g, '[data font omitted]'),
                line: details.lineNumber,
                source: details.sourceId
            })
        }
    })
    window.webContents.on('did-fail-load', (_event, code, description, resourceUrl) => {
        report.errors.push({ type: 'load', code, description, url: resourceUrl })
    })
    report.phase = 'attach debugger'
    window.webContents.debugger.attach('1.3')
    window.webContents.debugger.on('message', (_event, method, params) => {
        if (method === 'Runtime.exceptionThrown')
            report.errors.push({ type: 'exception', ...params.exceptionDetails })
    })
    void window.webContents.debugger.sendCommand('Runtime.enable').catch((error) => {
        report.errors.push({ type: 'debugger', message: error.stack || String(error) })
    })
    report.phase = 'load URL'
    await window.loadURL(url)
    await window.webContents.executeJavaScript(
        `console.warn('__kam_vue_shell_console_probe__')`,
        true
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    check('console warning listener active', consoleProbeSeen)
    report.phase = 'verify DOM'
    await verify()
    if (report.errors.length) throw new Error('Renderer or request errors captured')
    report.checks.push('no renderer or request errors')
}

const watchdog = setTimeout(() => {
    report.errors.push({ type: 'timeout', message: 'Electron mode exceeded 360 seconds' })
    void finish(1)
}, 360000)

let finished = false
async function finish(code) {
    if (finished) return
    finished = true
    clearTimeout(watchdog)
    try {
        await writeFile(join(artifactDir, `${mode}-report.json`), JSON.stringify(report, null, 2))
    } catch (error) {
        console.error(error)
        code = 1
    }
    if (code === 0) {
        process.exitCode = 0
        app.quit()
    } else {
        app.exit(code)
    }
}

main()
    .then(() => finish(0))
    .catch((error) => {
        report.errors.push({ type: 'assertion', message: error.stack || String(error) })
        void finish(1)
    })
