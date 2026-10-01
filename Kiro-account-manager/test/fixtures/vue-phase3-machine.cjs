/* Offline Machine ID checks drive the mounted Vue page with synthetic IPC responses. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
const initialId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const generatedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const importedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let currentId = initialId

async function mockMachineId(name, args, scenario) {
    if (name === 'machineIdGetOSType') return 'windows'
    if (name === 'machineIdCheckAdmin') return scenario === 'machine-admin-available'
    if (name === 'machineIdGetCurrent') return { success: true, machineId: currentId }
    if (name === 'machineIdGenerateRandom') return generatedId
    if (name === 'machineIdSet') {
        await new Promise((resolve) => setTimeout(resolve, 160))
        if (scenario === 'machine-set-fail')
            return { success: false, error: 'Synthetic set failure' }
        currentId = args[0]
        return { success: true, machineId: currentId }
    }
    if (name === 'machineIdBackupToFile') return scenario !== 'machine-export-fail'
    if (name === 'machineIdRestoreFromFile') {
        if (scenario === 'machine-import-success') return { success: true, machineId: importedId }
        return { success: false }
    }
    if (name === 'machineIdRequestAdminRestart') return scenario !== 'machine-admin-fail'
    return undefined
}

async function verifyMachineId(harness) {
    const { run, waitFor, click, check, screenshot, chooseMenu, report, setScenario } = harness
    const page = '[data-testid="page-machineId"]'
    const calls = (name) => report.calls.filter((call) => call.name === name)

    async function input(selector, value) {
        await run(`function () {
            const root = document.querySelector(${JSON.stringify(selector)})
            const control = root?.matches('input') ? root : root?.querySelector('input')
            if (!control) throw new Error('Missing input: ' + ${JSON.stringify(selector)})
            control.value = ${JSON.stringify(value)}
            control.dispatchEvent(new Event('input', { bubbles: true }))
        }`)
    }

    async function closeDialog() {
        await run(`function () {
            const dialog = [...document.querySelectorAll('dialog[open]')].at(-1)
            const button = [...(dialog?.querySelectorAll('button') || [])].find((item) => item.textContent.includes('关闭') || item.textContent.includes('Close'))
            if (!button) throw new Error('Missing dialog close button')
            button.click()
        }`)
        await waitFor(
            `function () { return !document.querySelector('dialog[open]') }`,
            'machine dialog closed'
        )
    }

    await chooseMenu(0, 0)
    await chooseMenu(1, 1)
    setScenario('machine-admin-required')
    await click('#kam-navigation-tab-machineId', 'machine ID page')
    await waitFor(
        `function () { return document.querySelector(${JSON.stringify(page)})?.textContent.includes(${JSON.stringify(initialId)}) }`,
        'synthetic current machine ID'
    )
    check(
        'machine init OS and admin',
        calls('machineIdGetOSType').length >= 1 &&
            calls('machineIdCheckAdmin').length >= 1 &&
            calls('machineIdGetCurrent').length >= 1
    )
    check(
        'machine original backup shown',
        await run(
            `function () { return document.querySelector(${JSON.stringify(page)}).textContent.includes('已备份') }`
        )
    )
    await screenshot('phase3-machine-light-zh')

    setScenario('machine-admin-fail')
    await click('[data-testid="machineId-request-admin"]', 'synthetic admin restart failure')
    await waitFor(
        `function () { return document.querySelector('[data-testid="machineId-error"]')?.textContent.includes('失败') }`,
        'admin failure visible'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="machineId-random"]').disabled }`,
        'admin request settled'
    )
    check('admin restart called once', calls('machineIdRequestAdminRestart').length === 1)

    setScenario('machine-normal')
    const beforeRandom = calls('machineIdSet').length
    await click('[data-testid="machineId-random"]', 'random machine ID')
    await click('[data-testid="machineId-random"]', 'duplicate random machine ID')
    await waitFor(
        `function () { return document.querySelector(${JSON.stringify(page)} + ' .machine-code')?.textContent.trim() === ${JSON.stringify(generatedId)} }`,
        'random machine ID applied'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="machineId-random"]').disabled }`,
        'random change settled'
    )
    check(
        'random operation lock and value',
        calls('machineIdGenerateRandom').length === 1 &&
            calls('machineIdSet').length === beforeRandom + 1 &&
            calls('machineIdSet').at(-1).args[0] === generatedId
    )

    await input('[data-testid="machineId-custom"]', '  custom-offline-id  ')
    await click('[data-testid="machineId-apply-custom"]', 'trimmed custom machine ID')
    await waitFor(
        `function () { return document.querySelector(${JSON.stringify(page)} + ' .machine-code')?.textContent.trim() === 'custom-offline-id' }`,
        'custom machine ID applied'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="machineId-random"]').disabled }`,
        'custom change settled'
    )
    check(
        'custom value trimmed for IPC',
        calls('machineIdSet').at(-1).args[0] === 'custom-offline-id'
    )
    check(
        'custom draft cleared after success',
        await run(
            `function () { return document.querySelector('[data-testid="machineId-custom"]').value === '' }`
        )
    )

    setScenario('machine-set-fail')
    await input('[data-testid="machineId-custom"]', 'failed-offline-id')
    const beforeFailureRefresh = calls('machineIdGetCurrent').length
    await click('[data-testid="machineId-apply-custom"]', 'failed machine ID change')
    await waitFor(
        `function () { return document.querySelector('[data-testid="machineId-error"]')?.textContent.includes('失败') }`,
        'set failure visible'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="machineId-apply-custom"]').disabled }`,
        'failed change settled'
    )
    check(
        'failed change keeps draft and skips refresh',
        calls('machineIdGetCurrent').length === beforeFailureRefresh &&
            (await run(
                `function () { return document.querySelector('[data-testid="machineId-custom"]').value === 'failed-offline-id' }`
            ))
    )
    await input('[data-testid="machineId-custom"]', '')

    setScenario('machine-normal')
    await click('[data-testid="machineId-export"]', 'export synthetic machine ID')
    await waitFor(
        `function () { return !document.querySelector('[data-testid="machineId-export"]').disabled }`,
        'export settled'
    )
    check(
        'file backup receives current ID',
        calls('machineIdBackupToFile').at(-1).args[0] === 'custom-offline-id'
    )
    const beforeCancelSet = calls('machineIdSet').length
    await click('[data-testid="machineId-import"]', 'cancel synthetic file import')
    await waitFor(
        `function () { return !document.querySelector('[data-testid="machineId-import"]').disabled }`,
        'import cancel settled'
    )
    check('cancelled import does not change ID', calls('machineIdSet').length === beforeCancelSet)
    setScenario('machine-import-success')
    await click('[data-testid="machineId-import"]', 'import synthetic file')
    await waitFor(
        `function () { return document.querySelector(${JSON.stringify(page)} + ' .machine-code')?.textContent.trim() === ${JSON.stringify(importedId)} }`,
        'imported ID applied'
    )
    await waitFor(
        `function () { return !document.querySelector('[data-testid="machineId-random"]').disabled }`,
        'file import settled'
    )
    check('file import applies returned ID', calls('machineIdSet').at(-1).args[0] === importedId)

    await click('[data-testid="machineId-restore"]', 'restore original synthetic ID')
    await waitFor(
        `function () { return document.querySelector(${JSON.stringify(page)} + ' .machine-code')?.textContent.trim() === ${JSON.stringify(initialId)} && document.querySelector('[data-testid="machineId-restore"]').disabled }`,
        'original restored'
    )
    check('restore uses original ID', calls('machineIdSet').at(-1).args[0] === initialId)

    await click('[data-testid="machineId-auto-switch"]', 'enable auto switch')
    await click('[data-testid="machineId-bind-enabled"]', 'enable account binding')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="machineId-use-bound"]') }`,
        'bound ID option visible'
    )
    await click('[data-testid="machineId-use-bound"]', 'disable bound ID choice')
    await waitFor(
        `function () { return document.querySelector('[data-testid="machineId-use-bound"]')?.checked === false }`,
        'machine config applied'
    )
    await new Promise((resolve) => setTimeout(resolve, 650))
    check(
        'machine config persisted',
        calls('save-accounts').some((call) => {
            const config = call.args[0]?.machineIdConfig
            return (
                config?.autoSwitchOnAccountChange === true &&
                config?.bindMachineIdToAccount === true &&
                config?.useBindedMachineId === false
            )
        })
    )

    await click('[data-testid="machineId-open-bindings"]', 'open account bindings')
    await waitFor(
        `function () { return !!document.querySelector('[data-testid="machineId-account-synthetic-0"]') }`,
        'seeded account shown'
    )
    check(
        'six synthetic accounts',
        await run(
            `function () { return document.querySelectorAll('[data-testid^="machineId-account-synthetic-"]').length === 6 }`
        )
    )
    await click('[data-testid="machineId-edit-binding-synthetic-0"]', 'edit account binding')
    await input('[data-testid="machineId-binding-input-synthetic-0"]', '  draft-cancel  ')
    await click('[data-testid="machineId-cancel-binding-synthetic-0"]', 'cancel account binding')
    check(
        'cancel binding does not persist',
        !calls('save-accounts').some(
            (call) => call.args[0]?.accountMachineIds?.['synthetic-0'] === 'draft-cancel'
        )
    )
    await click('[data-testid="machineId-edit-binding-synthetic-0"]', 'edit binding again')
    await input('[data-testid="machineId-binding-input-synthetic-0"]', '  bound-offline-id  ')
    await click('[data-testid="machineId-save-binding-synthetic-0"]', 'save trimmed binding')
    await waitFor(
        `function () { return document.querySelector('[data-testid="machineId-account-synthetic-0"]')?.textContent.includes('bound-offline-id') }`,
        'binding shown'
    )
    await new Promise((resolve) => setTimeout(resolve, 650))
    check(
        'trimmed binding persisted',
        calls('save-accounts').some(
            (call) => call.args[0]?.accountMachineIds?.['synthetic-0'] === 'bound-offline-id'
        )
    )
    await click('[data-testid="machineId-random-binding-synthetic-1"]', 'random account binding')
    await waitFor(
        `function () { return document.querySelector('[data-testid="machineId-account-synthetic-1"]')?.textContent.includes('已绑定') }`,
        'random binding shown'
    )
    await input('[data-testid="machineId-account-search"]', 'bound-offline-id')
    check(
        'search bound ID',
        await run(
            `function () { return document.querySelectorAll('[data-testid^="machineId-account-synthetic-"]').length === 1 }`
        )
    )
    await input('[data-testid="machineId-account-search"]', '')
    await click('[data-testid="machineId-remove-binding-synthetic-0"]', 'remove account binding')
    await waitFor(
        `function () { return document.querySelector('[data-testid="machineId-account-synthetic-0"]')?.textContent.includes('未绑定') }`,
        'binding removed'
    )
    await new Promise((resolve) => setTimeout(resolve, 650))
    check(
        'binding removal persisted as replacement',
        calls('save-accounts').at(-1)?.args[0]?.accountMachineIds?.['synthetic-0'] === undefined
    )
    await closeDialog()

    await click('[data-testid="machineId-open-history"]', 'open machine ID history')
    check(
        'history records actions',
        await run(
            `function () { const text = document.querySelector('dialog[open]')?.textContent || ''; return ['初始', '手动', '恢复', '绑定'].every((part) => text.includes(part)) }`
        )
    )
    await screenshot('phase3-machine-history-light-zh')
    await click('[data-testid="machineId-clear-history"]', 'clear synthetic history')
    await waitFor(
        `function () { return document.querySelector('dialog[open]')?.textContent.includes('暂无变更记录') }`,
        'history cleared'
    )
    await closeDialog()

    await chooseMenu(0, 1)
    await chooseMenu(1, 2)
    await screenshot('phase3-machine-dark-en')
    check(
        'machine English content',
        await run(
            `function () { return document.querySelector(${JSON.stringify(page)}).querySelector('h1').textContent.includes('Machine ID') }`
        )
    )
    await click('#kam-navigation-tab-home', 'leave machine ID page')
    await chooseMenu(1, 1)
}

module.exports = { mockMachineId, verifyMachineId }
