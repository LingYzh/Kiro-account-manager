/* Offline add-account flows use only synthetic credentials and accounts. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

let builderPolls = 0
let iamPolls = 0

async function mockAccountAdd(name, args, scenario) {
    if (!scenario?.startsWith('account-add-')) return undefined
    if (name === 'loadKiroCredentials') {
        return {
            success: true,
            data: {
                refreshToken: 'synthetic-local',
                clientId: 'synthetic-client',
                clientSecret: 'synthetic-secret',
                region: 'eu-west-1',
                authMethod: 'IdC',
                provider: 'BuilderId'
            }
        }
    }
    if (name === 'verifyAccountCredentials') {
        if (scenario === 'account-add-verify-late')
            await new Promise((resolve) => setTimeout(resolve, 300))
        const input = args[0]
        if (input.refreshToken === 'synthetic-batch-fail' && scenario !== 'account-add-retry') {
            return { success: false, error: 'Synthetic credential rejection' }
        }
        const duplicate =
            input.refreshToken === 'synthetic-duplicate-google' ||
            input.refreshToken === 'synthetic-batch-existing'
        const sameEmail = duplicate || input.refreshToken === 'synthetic-same-email-builder'
        const email = sameEmail
            ? 'offline-0@example.invalid'
            : `${input.refreshToken}@example.invalid`
        const userId = `uid-${input.refreshToken}`
        return {
            success: true,
            data: {
                email,
                userId,
                accessToken: `synthetic-access-${input.refreshToken}`,
                refreshToken: input.refreshToken,
                expiresIn: 3600,
                profileArn: 'arn:aws:synthetic:profile',
                subscriptionType: 'Pro',
                subscriptionTitle: 'SYNTHETIC PRO',
                subscription: { rawType: 'SYNTHETIC_RAW', managementTarget: 'synthetic-target' },
                usage: { current: 2, limit: 10, baseLimit: 8, baseCurrent: 2 }
            }
        }
    }
    if (name === 'startBuilderIdLogin') {
        if (scenario === 'account-add-builder-late')
            await new Promise((resolve) => setTimeout(resolve, 320))
        builderPolls = 0
        return {
            success: true,
            userCode: 'SYNTH-CODE',
            verificationUri: 'https://example.invalid/device',
            interval: 1,
            expiresIn: 600
        }
    }
    if (name === 'pollBuilderIdAuth') {
        builderPolls += 1
        if (scenario === 'account-add-builder-poll-late')
            await new Promise((resolve) => setTimeout(resolve, 320))
        if (
            scenario === 'account-add-builder-pending' ||
            scenario === 'account-add-builder-poll-late'
        )
            return { success: true, completed: false, status: 'pending' }
        if (scenario === 'account-add-builder-reject')
            return { success: false, error: 'Synthetic authorization rejection' }
        return {
            success: true,
            completed: true,
            refreshToken: 'synthetic-builder-login',
            accessToken: 'synthetic-builder-access',
            clientId: 'synthetic-client',
            clientSecret: 'synthetic-secret',
            region: 'eu-west-1'
        }
    }
    if (name === 'startIamSsoLogin') {
        iamPolls = 0
        return { success: true, authorizeUrl: 'https://example.invalid/iam', expiresIn: 600 }
    }
    if (name === 'pollIamSsoAuth') {
        iamPolls += 1
        if (scenario === 'account-add-iam-pending')
            return { success: true, completed: false, status: 'pending' }
        return {
            success: true,
            completed: true,
            refreshToken: 'synthetic-iam-login',
            accessToken: 'synthetic-iam-access',
            clientId: 'synthetic-client',
            clientSecret: 'synthetic-secret',
            region: 'ap-east-1'
        }
    }
    if (name === 'startSocialLogin') {
        return { success: true, state: `synthetic-state-${args[0]}` }
    }
    if (name === 'exchangeSocialToken') {
        if (scenario === 'account-add-social-late')
            await new Promise((resolve) => setTimeout(resolve, 320))
        return {
            success: true,
            refreshToken: 'synthetic-social-login',
            accessToken: 'synthetic-social-access',
            provider: 'Google'
        }
    }
    if (name === 'importFromSsoToken') {
        if (args[0] === 'synthetic-sso-fail' && scenario !== 'account-add-retry') {
            return { success: false, error: { message: 'Synthetic SSO rejection' } }
        }
        const existing = args[0] === 'synthetic-sso-existing'
        return {
            success: true,
            data: {
                email: existing ? 'offline-0@example.invalid' : `${args[0]}@example.invalid`,
                userId: existing ? 'synthetic-0' : `uid-${args[0]}`,
                accessToken: `synthetic-access-${args[0]}`,
                refreshToken: args[0],
                clientId: 'synthetic-client',
                clientSecret: 'synthetic-secret',
                region: 'eu-west-1',
                expiresIn: 3600,
                subscriptionType: 'Free',
                subscriptionTitle: 'SYNTHETIC FREE',
                usage: { current: 1, limit: 5 }
            }
        }
    }
    if (
        name === 'cancelBuilderIdLogin' ||
        name === 'cancelIamSsoLogin' ||
        name === 'cancelSocialLogin'
    ) {
        return { success: true }
    }
    return undefined
}

async function verifyAccountAdd(harness) {
    const { run, waitFor, click, check, screenshot, report, setScenario, emitEvent } = harness
    setScenario('account-add-normal')
    const calls = (name) => report.calls.filter((entry) => entry.name === name)
    const dialog = '[data-testid="account-add-dialog"][open]'

    async function input(selector, value, event = 'input') {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(selector)})
            const control = root?.matches('input,select,textarea') ? root : root?.querySelector('input,select,textarea')
            if (!control) throw new Error('Missing add account control: ' + ${JSON.stringify(selector)})
            control.value = ${JSON.stringify(value)}
            control.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }))
        }`)
    }

    async function openDialog() {
        await click('[data-testid="toolbar-add"]', 'open add account')
        await waitFor(
            `function () { return Boolean(document.querySelector(${JSON.stringify(dialog)})) }`,
            'add dialog open'
        )
    }

    async function closeDialog() {
        await click('[data-testid="add-close"]', 'close add account')
        await waitFor(
            `function () { return !document.querySelector(${JSON.stringify(dialog)}) }`,
            'add dialog closed'
        )
    }

    async function waitForCall(name, count, label) {
        const deadline = Date.now() + 5000
        while (calls(name).length < count && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 25))
        check(label, calls(name).length === count)
    }

    const snapshot = await run(`function () {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-settings')
        window.__addAccountSnapshot = {
            accounts: [...store.accounts.entries()].map(([id, account]) => [id, JSON.parse(JSON.stringify(account))]),
            groups: [...store.groups.entries()].map(([id, group]) => [id, JSON.parse(JSON.stringify(group))]),
            selectedIds: [...store.selectedIds], activeGroupTab: store.activeGroupTab,
            concurrency: settings.batchImportConcurrency, privateMode: settings.loginPrivateMode,
            savedGroupTab: localStorage.getItem('accounts_activeGroupTab')
        }
        const id = store.addGroup({ name: 'Synthetic add group' })
        store.setActiveGroupTab(id)
        settings.$patch({ batchImportConcurrency: 2, loginPrivateMode: true })
        return { groupId: id, initialCount: store.accounts.size }
    }`)
    await click('#kam-navigation-tab-accounts', 'accounts page for add dialog')
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="page-accounts"]')) }`,
        'accounts page'
    )
    await openDialog()
    check(
        'target group follows active group',
        await run(
            `function () { return document.querySelector('[data-testid="add-target-group"]')?.value === ${JSON.stringify(snapshot.groupId)} }`
        )
    )
    check(
        'private login follows settings',
        await run(
            `function () { return document.querySelector('[data-testid="add-private-mode"]')?.checked === true }`
        )
    )
    await screenshot('phase3-account-add-login-light-zh')

    await click('[data-testid="add-mode-oidc"]', 'OIDC mode')
    await click('[data-testid="add-oidc-submit"]', 'reject empty single OIDC')
    check('empty single OIDC avoids verify', calls('verifyAccountCredentials').length === 0)
    await click('[data-testid="add-import-local"]', 'read synthetic local credentials')
    await waitFor(
        `function () { return document.querySelector('[data-testid="add-refresh-token"]')?.value === 'synthetic-local' }`,
        'local credentials filled'
    )
    await click('[data-testid="add-oidc-submit"]', 'add local OIDC account')
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(dialog)}) }`,
        'single OIDC added'
    )
    check(
        'single OIDC omits profileArn',
        await run(`function () {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        const account = [...store.accounts.values()].find((item) => item.email === 'synthetic-local@example.invalid')
        return account?.groupId === ${JSON.stringify(snapshot.groupId)} &&
            !Object.hasOwn(account.credentials, 'profileArn') && account.subscription.rawType === undefined
    }`)
    )

    await openDialog()
    await click('[data-testid="add-mode-oidc"]', 'OIDC duplicate mode')
    await input('[data-testid="add-auth-method"]', 'social', 'change')
    await input('[data-testid="add-provider"]', 'Google', 'change')
    await input('[data-testid="add-refresh-token"]', 'synthetic-duplicate-google')
    await click('[data-testid="add-oidc-submit"]', 'provider-aware duplicate')
    await waitFor(
        `function () { return document.querySelector('[data-testid="add-error"]')?.textContent.includes('已存在') }`,
        'duplicate shown'
    )
    check(
        'same-email same-provider is skipped',
        await run(`function () {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        return store.accounts.size === ${snapshot.initialCount + 1}
    }`)
    )
    await input('[data-testid="add-auth-method"]', 'IdC', 'change')
    await input('[data-testid="add-provider"]', 'BuilderId', 'change')
    await input('[data-testid="add-client-id"]', 'synthetic-client')
    await input('[data-testid="add-client-secret"]', 'synthetic-secret')
    await input('[data-testid="add-refresh-token"]', 'synthetic-same-email-builder')
    await click('[data-testid="add-oidc-submit"]', 'same email different provider')
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(dialog)}) }`,
        'different provider added'
    )
    check(
        'same email different provider accepted',
        await run(`function () {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        return [...store.accounts.values()].some((account) => account.email === 'offline-0@example.invalid' && account.credentials.provider === 'BuilderId')
    }`)
    )

    await openDialog()
    await click('[data-testid="add-mode-oidc"]', 'OIDC batch mode')
    await click('[data-testid="add-oidc-batch"]', 'batch credentials')
    const batch = [
        {
            refreshToken: 'synthetic-batch-a',
            password: 'synthetic-password',
            clientId: 'synthetic-client',
            clientSecret: 'synthetic-secret',
            provider: 'BuilderId'
        },
        { refreshToken: 'synthetic-batch-fail', provider: 'Google' },
        { refreshToken: 'synthetic-batch-existing', provider: 'Google' },
        { refreshToken: 'synthetic-batch-b', provider: 'Google' }
    ]
    const beforeBatch = calls('verifyAccountCredentials').length
    await input('[data-testid="add-oidc-batch-data"]', JSON.stringify(batch))
    await click('[data-testid="add-oidc-batch-submit"]', 'batch OIDC import')
    await waitFor(
        `function () { return document.querySelector('[data-testid="add-oidc-result"]')?.textContent.includes('2 / 4') }`,
        'batch OIDC result'
    )
    check(
        'batch two-per-wave and duplicate excluded from failures',
        calls('verifyAccountCredentials').length === beforeBatch + 4 &&
            (await run(
                `function () { return document.querySelector('[data-testid="add-oidc-result"]')?.textContent.includes('失败 1') }`
            ))
    )
    check(
        'failed JSON input kept alone',
        await run(`function () {
        const value = document.querySelector('[data-testid="add-oidc-batch-data"]')?.value
        return JSON.parse(value).length === 1 && JSON.parse(value)[0].refreshToken === 'synthetic-batch-fail'
    }`)
    )
    check(
        'batch payload keeps password and profileArn',
        await run(`function () {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        const account = [...store.accounts.values()].find((item) => item.email === 'synthetic-batch-a@example.invalid')
        return account?.password === 'synthetic-password' && account.credentials.profileArn === 'arn:aws:synthetic:profile' && account.subscription.rawType === undefined
    }`)
    )
    setScenario('account-add-retry')
    await click('[data-testid="add-oidc-batch-submit"]', 'retry failed OIDC')
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(dialog)}) }`,
        'OIDC retry succeeded'
    )

    setScenario('account-add-normal')
    await openDialog()
    await click('[data-testid="add-mode-sso"]', 'SSO token mode')
    await input(
        '[data-testid="add-sso-tokens"]',
        'synthetic-sso-a\nsynthetic-sso-fail\nsynthetic-sso-existing'
    )
    await click('[data-testid="add-sso-submit"]', 'batch SSO import')
    await waitFor(
        `function () { return document.querySelector('[data-testid="add-sso-result"]')?.textContent.includes('1 / 3') }`,
        'SSO batch result'
    )
    check(
        'SSO failed token kept only',
        await run(
            `function () { return document.querySelector('[data-testid="add-sso-tokens"]')?.value === 'synthetic-sso-fail' }`
        )
    )
    check(
        'SSO source has no authMethod/provider/profileArn',
        await run(`function () {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        const account = [...store.accounts.values()].find((item) => item.email === 'synthetic-sso-a@example.invalid')
        return account && !Object.hasOwn(account.credentials, 'authMethod') &&
            !Object.hasOwn(account.credentials, 'provider') && !Object.hasOwn(account.credentials, 'profileArn')
    }`)
    )
    setScenario('account-add-retry')
    await click('[data-testid="add-sso-submit"]', 'retry failed SSO token')
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(dialog)}) }`,
        'SSO retry succeeded'
    )

    setScenario('account-add-builder-pending')
    await openDialog()
    await input('[data-testid="add-login-region"]', 'eu-west-1')
    await click('[data-testid="add-start-login"]', 'start Builder ID login')
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="add-user-code"]')) }`,
        'Builder ID user code'
    )
    check(
        'Builder ID start and private browser arguments',
        calls('startBuilderIdLogin').at(-1).args[0] === 'eu-west-1' &&
            calls('openExternal').at(-1).args[1] === true
    )
    const firstPoll = calls('pollBuilderIdAuth').length
    await waitForCall('pollBuilderIdAuth', firstPoll + 1, 'Builder ID pending poll')
    check('Builder ID poll issued once while pending', builderPolls === 1)
    setScenario('account-add-builder-complete')
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(dialog)}) }`,
        'Builder ID login completed',
        6000
    )
    check(
        'Builder ID login retains login-only rawType/profileArn',
        await run(`function () {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        const account = [...store.accounts.values()].find((item) => item.email === 'synthetic-builder-login@example.invalid')
        return account?.credentials.profileArn === 'arn:aws:synthetic:profile' && account.subscription.rawType === 'SYNTHETIC_RAW'
    }`)
    )

    setScenario('account-add-normal')
    await openDialog()
    await click('[data-testid="add-login-google"]', 'Google login source')
    await click('[data-testid="add-start-login"]', 'start Google login')
    await waitForCall('startSocialLogin', 1, 'social login started')
    const beforeExchange = calls('exchangeSocialToken').length
    emitEvent('mock-social-auth-callback', { code: 'synthetic-code', state: 'wrong-state' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    check('old social state ignored', calls('exchangeSocialToken').length === beforeExchange)
    emitEvent('mock-social-auth-callback', {
        code: 'synthetic-code',
        state: 'synthetic-state-Google'
    })
    emitEvent('mock-social-auth-callback', {
        code: 'synthetic-code',
        state: 'synthetic-state-Google'
    })
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(dialog)}) }`,
        'social callback account added'
    )
    check(
        'social callback exchanges once',
        calls('exchangeSocialToken').length === beforeExchange + 1
    )

    setScenario('account-add-normal')
    await openDialog()
    await click('[data-testid="add-login-iamsso"]', 'IAM SSO login source')
    await input('[data-testid="add-sso-start-url"]', 'https://example.invalid/start')
    await click('[data-testid="add-start-iam"]', 'start IAM login')
    await waitForCall('pollIamSsoAuth', 1, 'IAM SSO poll', 5000)
    check('IAM SSO poll issued', iamPolls === 1)
    await waitFor(
        `function () { return !document.querySelector(${JSON.stringify(dialog)}) }`,
        'IAM login completed',
        5000
    )
    check(
        'IAM login retains Start URL and provider',
        await run(`function () {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts')
        const account = [...store.accounts.values()].find((item) => item.email === 'synthetic-iam-login@example.invalid')
        return account?.credentials.startUrl === 'https://example.invalid/start' && account.credentials.provider === 'Enterprise'
    }`)
    )

    setScenario('account-add-builder-late')
    await openDialog()
    const beforeBrowser = calls('openExternal').length
    const beforeCancel = calls('cancelBuilderIdLogin').length
    await click('[data-testid="add-start-login"]', 'start Builder ID then close')
    await closeDialog()
    await new Promise((resolve) => setTimeout(resolve, 450))
    check(
        'late start cancelled without browser',
        calls('openExternal').length === beforeBrowser &&
            calls('cancelBuilderIdLogin').length >= beforeCancel + 1
    )

    setScenario('account-add-verify-late')
    await openDialog()
    await click('[data-testid="add-mode-oidc"]', 'late verify mode')
    await click('[data-testid="add-oidc-single"]', 'late verify single mode')
    await input('[data-testid="add-refresh-token"]', 'synthetic-verify-late')
    await input('[data-testid="add-client-id"]', 'synthetic-client')
    await input('[data-testid="add-client-secret"]', 'synthetic-secret')
    const beforeLateCount = await run(
        `function () { return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts').accounts.size }`
    )
    await click('[data-testid="add-oidc-submit"]', 'verify then close')
    await closeDialog()
    await new Promise((resolve) => setTimeout(resolve, 450))
    check(
        'late verify cannot add account',
        await run(
            `function () { return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts').accounts.size === ${beforeLateCount} }`
        )
    )

    setScenario('account-add-builder-poll-late')
    await openDialog()
    await click('[data-testid="add-mode-login"]', 'return to browser login')
    const beforeLatePoll = calls('pollBuilderIdAuth').length
    const beforePollCount = await run(
        `function () { return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts').accounts.size }`
    )
    await click('[data-testid="add-start-login"]', 'start Builder ID pending poll')
    await waitForCall('pollBuilderIdAuth', beforeLatePoll + 1, 'late poll dispatched')
    await closeDialog()
    await new Promise((resolve) => setTimeout(resolve, 450))
    check(
        'late poll does not add account or dispatch again',
        calls('pollBuilderIdAuth').length === beforeLatePoll + 1 &&
            (await run(
                `function () { return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts').accounts.size === ${beforePollCount} }`
            ))
    )

    await run(`function () {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        const store = pinia._s.get('kam-accounts')
        const settings = pinia._s.get('kam-settings')
        const original = window.__addAccountSnapshot
        store.$patch({
            accounts: new Map(original.accounts), groups: new Map(original.groups),
            selectedIds: new Set(original.selectedIds), activeGroupTab: original.activeGroupTab
        })
        settings.$patch({ batchImportConcurrency: original.concurrency, loginPrivateMode: original.privateMode })
        pinia._s.get('kam-persistence').saveToStorage()
        if (original.savedGroupTab === null) localStorage.removeItem('accounts_activeGroupTab')
        else localStorage.setItem('accounts_activeGroupTab', original.savedGroupTab)
        delete window.__addAccountSnapshot
    }`)
    check(
        'synthetic account state restored',
        await run(
            `function () { return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kam-accounts').accounts.size === ${snapshot.initialCount} }`
        )
    )
    await click('#kam-navigation-tab-home', 'return home after add account')
}

module.exports = { mockAccountAdd, verifyAccountAdd }
