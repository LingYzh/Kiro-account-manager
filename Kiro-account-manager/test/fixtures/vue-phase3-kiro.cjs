/* Offline Kiro settings and editor checks; all files and credentials are synthetic. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
const initialSteering = '# Synthetic rules\nKeep tests offline.\n'
let settings = {
    agentAutonomy: 'Supervised',
    modelSelection: 'synthetic-kiro-model',
    enableDebugLogs: undefined,
    trustedCommands: ['npm test'],
    trustedTools: { shell: false },
    commandDenylist: ['rm -rf *'],
    unknownFutureSetting: { nested: { keep: 'untouched' } }
}
let mcpServers = {
    existing: {
        command: 'npx',
        args: ['-y', 'synthetic-server'],
        env: { TOKEN: 'synthetic-token' },
        unknownServerExtra: { nested: true }
    }
}
let steering = { 'notes.md': initialSteering }

async function mockKiro(name, args, scenario) {
    if (name === 'getKiroSettings') {
        if (scenario === 'kiro-load-fail') throw new Error('Synthetic Kiro load failure')
        return {
            settings: { ...settings },
            mcpConfig: { mcpServers: { ...mcpServers } },
            steeringFiles: Object.keys(steering)
        }
    }
    if (name === 'saveKiroSettings') {
        if (scenario === 'kiro-save-slow-fail') {
            await new Promise((resolve) => setTimeout(resolve, 220))
            return { success: false, error: 'Synthetic Kiro save rejection' }
        }
        settings = args[0]
        return { success: true }
    }
    if (
        name === 'openKiroSettingsFile' ||
        name === 'openKiroMcpConfig' ||
        name === 'openKiroSteeringFolder' ||
        name === 'openKiroSteeringFile'
    ) {
        return { success: true }
    }
    if (name === 'createKiroDefaultRules') {
        steering['rules.md'] = '# Synthetic default rules\n'
        return { success: true }
    }
    if (name === 'readKiroSteeringFile') {
        if (scenario === 'kiro-steering-read-fail') {
            return { success: false, error: 'Synthetic steering read failure' }
        }
        return { success: true, content: steering[args[0]] }
    }
    if (name === 'saveKiroSteeringFile') {
        steering[args[0]] = args[1]
        return { success: true }
    }
    if (name === 'deleteKiroSteeringFile') {
        delete steering[args[0]]
        return { success: true }
    }
    if (name === 'saveMcpServer') {
        if (args[2] && args[2] !== args[0]) delete mcpServers[args[2]]
        mcpServers[args[0]] = args[1]
        return { success: true }
    }
    if (name === 'deleteMcpServer') {
        delete mcpServers[args[0]]
        return { success: true }
    }
    return undefined
}

async function verifyKiro(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario } = harness
    const calls = (name) => report.calls.filter((call) => call.name === name)
    const page = '[data-testid="page-kiroSettings"]'

    async function input(selector, value, event = 'input') {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(selector)})
            const control = root?.matches('input,select,textarea') ? root : root?.querySelector('input,select,textarea')
            if (!control) throw new Error('Missing Kiro control: ' + ${JSON.stringify(selector)})
            control.value = ${JSON.stringify(value)}
            control.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }))
        }`)
    }

    async function confirm(accept) {
        await waitFor(
            `function () { return Boolean(document.querySelector('dialog.ui-confirm[open]')) }`,
            'Kiro confirmation'
        )
        await run(`function () {
            const dialog = document.querySelector('dialog.ui-confirm[open]')
            const buttons = dialog.querySelectorAll('.ui-confirm-actions button')
            if (buttons.length !== 2) throw new Error('Missing confirm actions')
            buttons[${accept ? 1 : 0}].click()
        }`)
        await waitFor(
            `function () { return !document.querySelector('dialog.ui-confirm[open]') }`,
            'Kiro confirmation closed'
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
    }

    async function openAction(selector, label, callName) {
        const before = calls(callName).length
        await click(selector, label)
        const deadline = Date.now() + 3000
        while (calls(callName).length === before && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        check(`${label} calls IPC`, calls(callName).length === before + 1)
        await waitFor(
            `function () { return !document.querySelector(${JSON.stringify(selector)})?.disabled }`,
            `${label} settled`
        )
    }

    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    setScenario('kiro-load-fail')
    await click('#kam-navigation-tab-kiroSettings', 'Kiro settings page')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kiro-error"]')?.textContent.includes('Synthetic Kiro load failure') }`,
        'initial Kiro load error'
    )
    check('initial Kiro load attempted once', calls('getKiroSettings').length === 1)
    setScenario('kiro-normal')
    await click('[data-testid="kiro-refresh"]', 'retry Kiro settings')
    await waitFor(
        `function () { return document.querySelector(${JSON.stringify(page)})?.textContent.includes('existing') && !document.querySelector('[data-testid="kiro-loading"]') }`,
        'Kiro settings loaded'
    )
    check(
        'undefined known setting uses default',
        await run(`function () {
        return document.querySelector('[data-testid="kiro-setting-enableDebugLogs"]')?.checked === false
    }`)
    )
    await screenshot('phase3-kiro-light-zh')

    await input('[data-testid="kiro-autonomy"]', 'Autopilot', 'change')
    await input('[data-testid="kiro-model"]', 'synthetic-kiro-model', 'change')
    await click('[data-testid="kiro-setting-enableTabAutocomplete"]', 'enable tab completion')
    await click('[data-testid="kiro-section-commands"]', 'expand command rules')
    await input('[data-testid="kiro-new-trusted-command"]', '  npm run build  ')
    await click('[data-testid="kiro-add-trusted-command"]', 'add trusted command')
    await input('[data-testid="kiro-new-trusted-tool"]', '  synthetic_tool  ')
    await click('[data-testid="kiro-add-trusted-tool"]', 'add trusted tool')
    await input('[data-testid="kiro-new-deny-command"]', '  unsafe test command  ')
    await click('[data-testid="kiro-add-deny-command"]', 'add blocked command')
    await click('[data-testid="kiro-add-default-deny"]', 'add default blocked commands')
    await click('[data-testid="kiro-add-default-deny"]', 'repeat default blocked commands')
    setScenario('kiro-save-slow-fail')
    const beforeSave = calls('saveKiroSettings').length
    await click('[data-testid="kiro-save-settings"]', 'save Kiro settings failure')
    await click('[data-testid="kiro-save-settings"]', 'duplicate Kiro save')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kiro-error"]')?.textContent.includes('Synthetic Kiro save rejection') }`,
        'save false result visible'
    )
    check(
        'save false and duplicate click locked',
        calls('saveKiroSettings').length === beforeSave + 1
    )
    setScenario('kiro-normal')
    await click('[data-testid="kiro-save-settings"]', 'save Kiro settings')
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="kiro-success"]')) }`,
        'Kiro save success'
    )
    const savedSettings = calls('saveKiroSettings').at(-1).args[0]
    check(
        'settings document preserves unknown and defaults',
        savedSettings.agentAutonomy === 'Autopilot' &&
            savedSettings.modelSelection === 'synthetic-kiro-model' &&
            savedSettings.enableTabAutocomplete === true &&
            savedSettings.enableDebugLogs === false &&
            savedSettings.unknownFutureSetting?.nested?.keep === 'untouched' &&
            savedSettings.trustedCommands.includes('npm run build') &&
            savedSettings.trustedTools.synthetic_tool === true &&
            savedSettings.commandDenylist.filter((item) => item === 'rm -rf *').length === 1 &&
            savedSettings.commandDenylist.includes('unsafe test command') &&
            savedSettings.commandDenylist.length === 18
    )

    await openAction(
        '[data-testid="kiro-open-settings-file"]',
        'open Kiro settings file',
        'openKiroSettingsFile'
    )
    await openAction(
        '[data-testid="kiro-open-mcp-user"]',
        'open user MCP config',
        'openKiroMcpConfig'
    )
    await openAction(
        '[data-testid="kiro-open-mcp-workspace"]',
        'open workspace MCP config',
        'openKiroMcpConfig'
    )
    await openAction(
        '[data-testid="kiro-open-steering-folder"]',
        'open steering folder',
        'openKiroSteeringFolder'
    )
    await openAction(
        '[data-testid="kiro-open-steering-notes.md"]',
        'open steering file externally',
        'openKiroSteeringFile'
    )
    check(
        'open actions preserve exact IPC arguments',
        calls('openKiroSettingsFile').at(-1)?.args.length === 0 &&
            calls('openKiroMcpConfig')
                .slice(-2)
                .map((call) => call.args[0])
                .join(',') === 'user,workspace' &&
            calls('openKiroSteeringFolder').at(-1)?.args.length === 0 &&
            calls('openKiroSteeringFile').at(-1)?.args[0] === 'notes.md'
    )

    await click('[data-testid="kiro-add-mcp"]', 'add MCP server')
    await click('[data-testid="kiro-mcp-save"]', 'reject empty MCP server')
    check('empty MCP validation avoids IPC', calls('saveMcpServer').length === 0)
    await input('[data-testid="kiro-mcp-name"]', '  offline-new  ')
    await click('[data-testid="kiro-mcp-save"]', 'reject missing MCP command')
    check('missing command validation avoids IPC', calls('saveMcpServer').length === 0)
    await input('[data-testid="kiro-mcp-command"]', '  uvx  ')
    await input('[data-testid="kiro-mcp-new-arg"]', '  --safe  ')
    await click('[data-testid="kiro-mcp-add-arg"]', 'add MCP argument')
    await click('[data-testid="kiro-mcp-add-env"]', 'add MCP environment row')
    await input('[data-testid="kiro-mcp-env-key-0"]', '  TOKEN  ')
    await input('[data-testid="kiro-mcp-env-value-0"]', 'synthetic-value')
    await screenshot('phase3-kiro-mcp-editor-light-zh')
    await click('[data-testid="kiro-mcp-save"]', 'save new MCP server')
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="kiro-edit-mcp-offline-new"]')) && !document.querySelector('dialog[open]') }`,
        'new MCP saved'
    )
    const createdMcp = calls('saveMcpServer').at(-1).args
    check(
        'new MCP trims fields and sends no old name',
        createdMcp[0] === 'offline-new' &&
            createdMcp[1].command === 'uvx' &&
            createdMcp[1].args.join(',') === '--safe' &&
            createdMcp[1].env.TOKEN === 'synthetic-value' &&
            createdMcp[2] === undefined
    )
    await click('[data-testid="kiro-add-mcp"]', 'add bare MCP server')
    await input('[data-testid="kiro-mcp-name"]', 'bare')
    await input('[data-testid="kiro-mcp-command"]', 'node')
    await click('[data-testid="kiro-mcp-save"]', 'save bare MCP server')
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="kiro-edit-mcp-bare"]')) && !document.querySelector('dialog[open]') }`,
        'bare MCP saved'
    )
    check(
        'empty args and env omitted',
        Object.keys(calls('saveMcpServer').at(-1).args[1]).sort().join(',') === 'command'
    )

    await click('[data-testid="kiro-edit-mcp-existing"]', 'edit MCP server')
    check(
        'editing keeps MCP name fixed',
        await run(
            `function () { return document.querySelector('[data-testid="kiro-mcp-name"] input')?.disabled ?? document.querySelector('[data-testid="kiro-mcp-name"]')?.disabled }`
        )
    )
    await input('[data-testid="kiro-mcp-command"]', 'cancelled-command')
    const beforeCancelMcp = calls('saveMcpServer').length
    await click('[data-testid="kiro-mcp-cancel"]', 'cancel MCP edit')
    await waitFor(
        `function () { return !document.querySelector('dialog[open]') }`,
        'MCP edit cancelled'
    )
    check('cancel MCP does not save', calls('saveMcpServer').length === beforeCancelMcp)
    await click('[data-testid="kiro-edit-mcp-existing"]', 'edit MCP existing again')
    await input('[data-testid="kiro-mcp-command"]', '  edited-command  ')
    await click('[data-testid="kiro-mcp-save"]', 'save MCP edit')
    await waitFor(
        `function () { return !document.querySelector('dialog[open]') }`,
        'MCP edit saved'
    )
    const editedMcp = calls('saveMcpServer').at(-1).args
    check(
        'MCP edit preserves name and unknown server fields',
        editedMcp[0] === 'existing' &&
            editedMcp[2] === 'existing' &&
            editedMcp[1].command === 'edited-command' &&
            editedMcp[1].unknownServerExtra?.nested === true
    )
    await click('[data-testid="kiro-delete-mcp-bare"]', 'delete bare MCP confirmation')
    await confirm(false)
    check('cancel MCP delete avoids IPC', calls('deleteMcpServer').length === 0)
    await click('[data-testid="kiro-delete-mcp-bare"]', 'delete bare MCP confirmation again')
    await confirm(true)
    await waitFor(
        `function () { return !document.querySelector('[data-testid="kiro-edit-mcp-bare"]') }`,
        'bare MCP deleted'
    )
    check('MCP delete exact name', calls('deleteMcpServer').at(-1).args[0] === 'bare')

    setScenario('kiro-steering-read-fail')
    await click(
        '[data-testid="kiro-edit-steering-notes.md"]',
        'open Steering editor with read failure'
    )
    await waitFor(
        `function () { return document.querySelector('dialog[open]')?.textContent.includes('Synthetic steering read failure') }`,
        'Steering read error'
    )
    setScenario('kiro-normal')
    await click('[data-testid="kiro-steering-refresh"]', 'retry Steering read')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kiro-steering-content"] textarea')?.value === ${JSON.stringify(initialSteering)} || document.querySelector('[data-testid="kiro-steering-content"]')?.value === ${JSON.stringify(initialSteering)} }`,
        'exact Steering Markdown loaded'
    )
    const changedSteering = '# Synthetic rules\nKeep tests offline.\nAdd this exact line.\n'
    await input('[data-testid="kiro-steering-content"]', changedSteering)
    await click('[data-testid="kiro-steering-close"]', 'close dirty Steering editor')
    await confirm(false)
    check(
        'cancel dirty close keeps editor and skips write',
        (await run(
            `function () { return Boolean(document.querySelector('[data-testid="kiro-steering-content"]')) }`
        )) && calls('saveKiroSteeringFile').length === 0
    )
    await screenshot('phase3-kiro-steering-editor-light-zh')
    await click('[data-testid="kiro-steering-save"]', 'explicit Steering save')
    await waitFor(
        `function () { return document.querySelector('[data-testid="kiro-steering-save"]')?.disabled }`,
        'Steering saved and clean'
    )
    check(
        'Steering exact Markdown written once',
        calls('saveKiroSteeringFile').length === 1 &&
            calls('saveKiroSteeringFile')[0].args[0] === 'notes.md' &&
            calls('saveKiroSteeringFile')[0].args[1] === changedSteering
    )
    await input('[data-testid="kiro-steering-content"]', '# Unsaved change\n')
    await click('[data-testid="kiro-steering-close"]', 'discard dirty Steering edit')
    await confirm(true)
    await waitFor(
        `function () { return !document.querySelector('[data-testid="kiro-steering-content"]') }`,
        'Steering editor closed'
    )
    check('discard does not write', calls('saveKiroSteeringFile').length === 1)
    await click('[data-testid="kiro-create-rules"]', 'create default rules')
    await waitFor(
        `function () { return Boolean(document.querySelector('[data-testid="kiro-edit-steering-rules.md"]')) }`,
        'generated rules reloaded'
    )
    check(
        'default rules IPC and reload',
        calls('createKiroDefaultRules').length === 1 && calls('getKiroSettings').length > 2
    )
    await click('[data-testid="kiro-delete-steering-rules.md"]', 'cancel Steering delete')
    await confirm(false)
    check('cancel Steering delete avoids IPC', calls('deleteKiroSteeringFile').length === 0)
    await click('[data-testid="kiro-delete-steering-rules.md"]', 'confirm Steering delete')
    await confirm(true)
    await waitFor(
        `function () { return !document.querySelector('[data-testid="kiro-edit-steering-rules.md"]') }`,
        'Steering delete reloaded'
    )
    check(
        'Steering delete filename exact',
        calls('deleteKiroSteeringFile').at(-1).args[0] === 'rules.md'
    )

    await click('#kam-navigation-tab-home', 'leave Kiro settings')
    await click('#kam-navigation-tab-kiroSettings', 'revisit Kiro settings')
    check(
        'Kiro page retains settings and sections',
        await run(`function () {
        return document.querySelector('[data-testid="kiro-section-commands"]')?.getAttribute('aria-expanded') === 'true' &&
            document.querySelector('[data-testid="kiro-autonomy"]')?.value === 'Autopilot'
    }`)
    )
    await chooseMenu(0, 1)
    await chooseMenu(1, 2)
    await screenshot('phase3-kiro-dark-en')
    check(
        'English Kiro page shown',
        await run(
            `function () { return document.querySelector(${JSON.stringify(page)})?.textContent.includes('Kiro Settings') }`
        )
    )
    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    await click('#kam-navigation-tab-home', 'return home after Kiro checks')
}

module.exports = { mockKiro, verifyKiro }
