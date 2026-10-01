/* Offline Config Sync checks drive the mounted Vue page with synthetic files and stores. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

const page = '[data-testid="page-configSync"]'

async function verifyConfigSync(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report } = harness

    async function navigate() {
        await click('#kam-navigation-tab-configSync', 'config sync page')
        await waitFor(
            `function () { return document.querySelector(${JSON.stringify(page)}) && document.querySelector('#kam-navigation-panel-configSync')?.classList.contains('is-active') }`,
            'config sync mounted'
        )
    }

    async function input(selector, value) {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(selector)})
            const control = root?.matches('input') ? root : root?.querySelector('input')
            if (!control) throw new Error('Missing input: ' + ${JSON.stringify(selector)})
            control.value = ${JSON.stringify(value)}
            control.dispatchEvent(new Event('input', { bubbles: true }))
        }`)
    }

    async function importFile(content, filename) {
        await run(`function () {
            const file = new File([${JSON.stringify(content)}], ${JSON.stringify(filename)}, { type: 'application/json' })
            const transfer = new DataTransfer()
            transfer.items.add(file)
            const input = document.querySelector('[data-testid="config-import"]')
            input.files = transfer.files
            input.dispatchEvent(new Event('change', { bubbles: true }))
        }`)
    }

    async function importExported(index, filename) {
        await run(`async function () {
            const content = await window.__configExports[${index}].blob.text()
            const file = new File([content], ${JSON.stringify(filename)}, { type: 'application/octet-stream' })
            const transfer = new DataTransfer()
            transfer.items.add(file)
            const input = document.querySelector('[data-testid="config-import"]')
            input.files = transfer.files
            input.dispatchEvent(new Event('change', { bubbles: true }))
        }`)
    }

    async function readExport(index) {
        return run(
            `async function () { return { name: window.__configExports[${index}].name, text: await window.__configExports[${index}].blob.text() } }`
        )
    }

    async function clickConfirm(confirmed) {
        await waitFor(
            `function () { return !!document.querySelector('.ui-confirm[open]') }`,
            'reset confirmation'
        )
        await click(
            `.ui-confirm[open] .ui-confirm-actions button:nth-child(${confirmed ? 2 : 1})`,
            confirmed ? 'confirm reset' : 'cancel reset'
        )
        await waitFor(
            `function () { return !document.querySelector('.ui-confirm[open]') }`,
            'reset confirmation closed'
        )
    }

    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    await navigate()
    check(
        'config default options and no credentials',
        await run(`function () {
        const names = ['proxyPool','webhooks','registerConfig','registerTemplates','registerSettings','appSettings']
        return names.every((name) => document.querySelector('[data-testid="config-option-' + name + '"]')?.checked) &&
            !document.querySelector('[data-testid="config-include-proxy-credentials"]')?.checked &&
            !document.querySelector('[data-testid="config-encrypt"]')?.checked
    }`)
    )
    await screenshot('phase3-config-light-zh')

    await run(`function () {
        window.__configExports = []
        window.__configBlob = null
        URL.createObjectURL = (blob) => { window.__configBlob = blob; return 'blob:synthetic-config' }
        URL.revokeObjectURL = () => {}
        HTMLAnchorElement.prototype.click = function () {
            window.__configExports.push({ name: this.download, blob: window.__configBlob })
        }
        localStorage.setItem('kiro-register-ratelimit-enabled', 'true')
        localStorage.setItem('kiro-register-email-blacklist', '["blocked@example.invalid"]')
        localStorage.setItem('kiro-register-mixed-sources', 'true')
    }`)

    const seed = {
        version: 1,
        app: 'kiro-account-manager',
        exportedAt: '2026-01-01T00:00:00.000Z',
        proxyPool: [
            {
                url: 'http://offline-user:offline-secret@proxy.example.invalid:8123',
                label: 'Offline proxy',
                tags: ['synthetic']
            }
        ],
        webhooks: [
            {
                kind: 'custom',
                url: 'https://example.invalid/config-hook',
                label: 'Config hook',
                enabled: true,
                events: ['batch-completed']
            }
        ],
        registerConfig: { syntheticConfig: true },
        registerTemplates: [{ name: 'Synthetic template' }],
        registerLocalStorage: {
            'kiro-register-ratelimit-max': '13',
            'unlisted-secret-key': 'must-not-write'
        }
    }
    const beforeSeedHooks = await run(
        `function () { return JSON.parse(localStorage.getItem('kiro-webhooks') || '[]').length }`
    )
    await importFile(JSON.stringify(seed), 'seed.json')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="config-import-success"]') }`,
        'plain import result'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="config-import"]')?.disabled }`,
        'plain import settled'
    )
    check(
        'plain import appends webhook and whitelists storage',
        await run(`function () {
        return JSON.parse(localStorage.getItem('kiro-webhooks') || '[]').length === ${beforeSeedHooks + 1} &&
            localStorage.getItem('kiro-register-ratelimit-max') === '13' &&
            localStorage.getItem('unlisted-secret-key') === null &&
            JSON.parse(localStorage.getItem('kiro-register-config')).syntheticConfig === true &&
            JSON.parse(localStorage.getItem('kiro-register-templates')).length === 1
    }`)
    )
    check(
        'plain import reports counts',
        await run(`function () {
        const text = document.querySelector('[data-testid="config-import-success"]')?.textContent || ''
        return ['代理池', 'Webhook', '注册配置', '注册模板', '注册偏好'].every((name) => text.includes(name))
    }`)
    )

    const masked = {
        version: 1,
        app: 'kiro-account-manager',
        proxyPool: [
            {
                url: 'http://offline-user:***@masked.example.invalid:8124',
                host: 'masked.example.invalid',
                port: 8124,
                protocol: 'http',
                label: 'Masked proxy'
            }
        ]
    }
    await importFile(JSON.stringify(masked), 'masked.json')
    await waitFor(
        `function () {
        const text = document.querySelector('[data-testid="config-import-success"]')?.textContent || ''
        return text.includes('代理池') && text.includes('1')
    }`,
        'masked proxy imported'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="config-import"]')?.disabled }`,
        'masked import settled'
    )

    await click('[data-testid="config-export"]', 'default config export')
    await waitFor(
        `function () { return window.__configExports.length === 1 }`,
        'default export created'
    )
    const defaultExport = await readExport(0)
    const defaultData = JSON.parse(defaultExport.text)
    check(
        'v1 export omits accounts and redacts proxy',
        defaultExport.name.endsWith('.json') &&
            defaultData.version === 1 &&
            defaultData.app === 'kiro-account-manager' &&
            typeof defaultData.exportedAt === 'string' &&
            !('accounts' in defaultData) &&
            !defaultExport.text.includes('synthetic-access-') &&
            !defaultExport.text.includes('synthetic-refresh') &&
            !defaultExport.text.includes('offline-secret') &&
            defaultData.proxyPool.length === 2 &&
            defaultData.proxyPool[0].password === undefined &&
            defaultData.proxyPool[0].url.includes(':***@') &&
            defaultData.proxyPool.some(
                (proxy) =>
                    proxy.host === 'masked.example.invalid' &&
                    proxy.source === 'import-config-masked'
            ) &&
            defaultData.webhooks.some((hook) => hook.url === 'https://example.invalid/config-hook')
    )
    check(
        'v1 export includes app settings and register whitelist',
        defaultData.appSettings?.language === 'zh' &&
            defaultData.appSettings?.darkMode === false &&
            defaultData.registerLocalStorage['kiro-register-ratelimit-max'] === '13' &&
            defaultData.registerLocalStorage['kiro-register-mixed-sources'] === 'true' &&
            !('unlisted-secret-key' in defaultData.registerLocalStorage)
    )

    await click(
        '[data-testid="config-include-proxy-credentials"]',
        'include synthetic proxy password'
    )
    await click('[data-testid="config-export"]', 'config export with proxy password')
    await waitFor(
        `function () { return window.__configExports.length === 2 }`,
        'credential export created'
    )
    const credentialExport = JSON.parse((await readExport(1)).text)
    check(
        'credential opt-in preserves proxy password',
        credentialExport.proxyPool[0].url.includes('offline-secret')
    )

    await click('[data-testid="config-encrypt"]', 'enable encrypted config export')
    await input('[data-testid="config-encrypt-password"]', 'offline-password')
    await click('[data-testid="config-export"]', 'encrypted config export')
    await waitFor(
        `function () { return window.__configExports.length === 3 }`,
        'encrypted export created'
    )
    const encrypted = await readExport(2)
    check(
        'encrypted export uses KCFG1 and kcfg',
        encrypted.name.endsWith('.kcfg') &&
            encrypted.text.startsWith('KCFG1:') &&
            !encrypted.text.includes('offline-secret')
    )
    await click('#kam-navigation-tab-home', 'leave config sync with export choices')
    await navigate()
    check(
        'config choices survive tab switch',
        await run(`function () {
        return document.querySelector('[data-testid="config-encrypt"]')?.checked &&
            document.querySelector('[data-testid="config-include-proxy-credentials"]')?.checked
    }`)
    )

    await new Promise((resolve) => setTimeout(resolve, 650))
    const beforeCancelSaves = report.calls.filter((call) => call.name === 'save-accounts').length
    const beforeCancel = await run(`function () { return {
        hooks: localStorage.getItem('kiro-webhooks'),
        config: localStorage.getItem('kiro-register-config'),
        templates: localStorage.getItem('kiro-register-templates')
    } }`)
    await importExported(2, 'cancel.kcfg')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="config-password-dialog"][open]') }`,
        'encrypted password prompt'
    )
    await screenshot('phase3-config-encrypted-prompt')
    await click('[data-testid="config-password-cancel"]', 'cancel encrypted config import')
    await waitFor(
        `function () { return !document.querySelector('[data-testid="config-password-dialog"][open]') }`,
        'encrypted prompt cancelled'
    )
    check(
        'encrypted cancel writes nothing',
        (await run(`function () {
        return localStorage.getItem('kiro-webhooks') === ${JSON.stringify(beforeCancel.hooks)} &&
        localStorage.getItem('kiro-register-config') === ${JSON.stringify(beforeCancel.config)} &&
        localStorage.getItem('kiro-register-templates') === ${JSON.stringify(beforeCancel.templates)}
    }`)) &&
            report.calls.filter((call) => call.name === 'save-accounts').length ===
                beforeCancelSaves
    )

    await importExported(2, 'wrong-password.kcfg')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="config-password-dialog"][open]') }`,
        'password prompt reopened'
    )
    await input('[data-testid="config-password"]', 'wrong-password')
    await click('[data-testid="config-password-submit"]', 'wrong config password')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="config-import-error"]') }`,
        'wrong password result'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="config-import"]')?.disabled }`,
        'wrong password settled'
    )
    check(
        'wrong password writes nothing',
        (await run(`function () {
        return localStorage.getItem('kiro-webhooks') === ${JSON.stringify(beforeCancel.hooks)} &&
            localStorage.getItem('kiro-register-config') === ${JSON.stringify(beforeCancel.config)}
    }`)) &&
            report.calls.filter((call) => call.name === 'save-accounts').length ===
                beforeCancelSaves
    )
    await importExported(2, 'retry.kcfg')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="config-password-dialog"][open]') }`,
        'password retry prompt'
    )
    await input('[data-testid="config-password"]', 'offline-password')
    await click('[data-testid="config-password-submit"]', 'correct config password')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="config-import-success"]') }`,
        'encrypted retry result'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="config-import"]')?.disabled }`,
        'encrypted retry settled'
    )
    check(
        'encrypted retry appends webhook and skips duplicate proxy',
        await run(`function () {
        const text = document.querySelector('[data-testid="config-import-success"]')?.textContent || ''
        const counts = [...document.querySelectorAll('[data-testid="config-import-success"] dl div')]
            .map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])
        return JSON.parse(localStorage.getItem('kiro-webhooks') || '[]').length === ${beforeSeedHooks + 1 + credentialExport.webhooks.length} &&
            counts.some(([name, count]) => name === '代理池' && count === '0') &&
            text.includes('Webhook')
    }`)
    )

    const darkImport = {
        version: 1,
        app: 'kiro-account-manager',
        appSettings: {
            theme: 'purple',
            darkMode: true,
            language: 'en',
            autoRefreshEnabled: false,
            autoRefreshInterval: 7,
            privacyMode: true,
            usagePrecision: true,
            switchTarget: 'cli'
        }
    }
    await importFile(JSON.stringify(darkImport), 'dark.json')
    await waitFor(
        `function () { return document.documentElement.dataset.theme === 'dark' && document.querySelector(${JSON.stringify(page)})?.querySelector('h1')?.textContent.includes('Config Sync') }`,
        'imported dark English settings'
    )
    await waitFor(
        `function () { return localStorage.getItem('kiro-vue-theme-mode') === 'dark' }`,
        'Vue theme preference persisted'
    )
    await new Promise((resolve) => setTimeout(resolve, 650))
    check(
        'old theme and darkMode saved with synthetic accounts',
        report.calls.some((call) => {
            const data = call.name === 'save-accounts' ? call.args[0] : null
            return (
                data?.theme === 'purple' &&
                data?.darkMode === true &&
                Object.keys(data.accounts || {}).length === 6
            )
        })
    )
    await screenshot('phase3-config-dark-en')

    const beforeReset = await run(`function () { return {
        config: localStorage.getItem('kiro-register-config'),
        templates: localStorage.getItem('kiro-register-templates'),
        blacklist: localStorage.getItem('kiro-register-email-blacklist'),
        ratelimit: localStorage.getItem('kiro-register-ratelimit-max')
    } }`)
    await click('[data-testid="config-reset"]', 'open reset confirmation')
    await clickConfirm(false)
    await waitFor(
        `function () { return !document.querySelector('[data-testid="config-reset"]')?.disabled }`,
        'reset cancellation settled'
    )
    check(
        'reset cancellation preserves settings',
        await run(`function () {
        return localStorage.getItem('kiro-register-templates') === ${JSON.stringify(beforeReset.templates)} &&
            localStorage.getItem('kiro-register-ratelimit-max') === ${JSON.stringify(beforeReset.ratelimit)}
    }`)
    )
    await click('[data-testid="config-reset"]', 'confirm reset preferences')
    await clickConfirm(true)
    await waitFor(
        `function () { return !!document.querySelector(${JSON.stringify(page)})?.textContent.includes('Done. Please reload') }`,
        'reset result'
    )
    check(
        'reset retains register config and accounts',
        (await run(`function () {
        return localStorage.getItem('kiro-register-config') === ${JSON.stringify(beforeReset.config)} &&
            localStorage.getItem('kiro-register-templates') === null &&
            localStorage.getItem('kiro-register-email-blacklist') === null &&
            localStorage.getItem('kiro-register-ratelimit-max') === null &&
            document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts').accounts.size === 6
    }`))
    )

    await click('#kam-navigation-tab-home', 'leave config sync page')
    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
}

module.exports = { verifyConfigSync }
