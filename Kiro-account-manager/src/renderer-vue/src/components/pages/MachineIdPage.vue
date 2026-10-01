<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
    UiBadge,
    UiButton,
    UiCard,
    UiCopyButton,
    UiDialog,
    UiField,
    UiInput,
    UiSwitch
} from '@lingyzh/ui'
import {
    AlertTriangle,
    Download,
    Fingerprint,
    History,
    Monitor,
    RefreshCw,
    RotateCcw,
    Shield,
    Shuffle,
    Trash2,
    Upload,
    Users
} from 'lucide-vue-next'
import { useAccountsStore } from '../../stores/accounts'
import { useMachineIdStore } from '../../stores/machineId'
import { usePersistenceStore } from '../../stores/persistence'
import { useTranslation } from '../../composables/useTranslation'
import { toIpcData } from '../../lib/ipcData'

const accounts = useAccountsStore()
const machine = useMachineIdStore()
const persistence = usePersistenceStore()
const { t } = useTranslation()
const isEn = computed(() => t('common.unknown') === 'Unknown')
const hasAdmin = ref(null)
const osType = ref('unknown')
const operation = ref('')
const error = ref('')
const customMachineId = ref('')
const bindingsOpen = ref(false)
const historyOpen = ref(false)
const accountSearch = ref('')
const editingAccountId = ref(null)
const editingMachineId = ref('')
let active = true

const accountList = computed(() => Array.from(accounts.accounts.values()))
const boundCount = computed(() => Object.keys(machine.accountMachineIds).length)
const filteredAccounts = computed(() => {
    const query = accountSearch.value.trim().toLowerCase()
    if (!query) return accountList.value
    return accountList.value.filter(
        (account) =>
            account.email?.toLowerCase().includes(query) ||
            account.nickname?.toLowerCase().includes(query) ||
            machine.accountMachineIds[account.id]?.toLowerCase().includes(query)
    )
})
const historyNewestFirst = computed(() => [...machine.machineIdHistory].reverse())
const osName = computed(
    () =>
        ({ windows: 'Windows', macos: 'macOS', linux: 'Linux' })[osType.value] ||
        (isEn.value ? 'Unknown' : '未知')
)

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString('zh-CN')
}

function setError(message) {
    if (active) error.value = message
}

function failureMessage(action) {
    return isEn.value
        ? `${action} failed. Check system permissions and try again.`
        : `${action}失败，请检查系统权限后重试。`
}

function runOperation(name, task) {
    if (operation.value) return
    operation.value = name
    error.value = ''
    Promise.resolve()
        .then(task)
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => {
            if (active) operation.value = ''
        })
}

function initialize() {
    runOperation('initialize', async () => {
        const os = await window.api.machineIdGetOSType()
        if (!active) return
        osType.value = os
        const admin = await window.api.machineIdCheckAdmin()
        if (!active) return
        hasAdmin.value = admin
        await machine.refreshCurrentMachineId()
    })
}

function refreshCurrent() {
    runOperation('refresh', () => machine.refreshCurrentMachineId())
}

function randomChange() {
    runOperation('random', async () => {
        const changed = await machine.changeMachineId()
        if (!active) return
        if (!changed) {
            setError(failureMessage(isEn.value ? 'Change machine ID' : '更改机器码'))
            return
        }
        await machine.refreshCurrentMachineId()
    })
}

function customChange() {
    const value = customMachineId.value.trim()
    if (!value) return
    runOperation('custom', async () => {
        const changed = await machine.changeMachineId(value)
        if (!active) return
        if (!changed) {
            setError(failureMessage(isEn.value ? 'Change machine ID' : '更改机器码'))
            return
        }
        await machine.refreshCurrentMachineId()
        if (active) customMachineId.value = ''
    })
}

function restoreOriginal() {
    if (!machine.originalMachineId || machine.currentMachineId === machine.originalMachineId) return
    runOperation('restore', async () => {
        const restored = await machine.restoreOriginalMachineId()
        if (!active) return
        if (!restored) {
            setError(failureMessage(isEn.value ? 'Restore machine ID' : '恢复机器码'))
            return
        }
        await machine.refreshCurrentMachineId()
    })
}

function backupToFile() {
    if (!machine.currentMachineId) return
    runOperation('export', async () => {
        const saved = await window.api.machineIdBackupToFile(toIpcData(machine.currentMachineId))
        if (active && !saved) setError(failureMessage(isEn.value ? 'Export' : '导出'))
    })
}

function restoreFromFile() {
    runOperation('import', async () => {
        const result = await window.api.machineIdRestoreFromFile()
        if (!active) return
        if (!result.success || !result.machineId) {
            if (result.error) setError(result.error)
            return
        }
        const changed = await machine.changeMachineId(result.machineId)
        if (!active) return
        if (!changed) {
            setError(failureMessage(isEn.value ? 'Import' : '导入'))
            return
        }
        await machine.refreshCurrentMachineId()
    })
}

function requestAdmin() {
    runOperation('admin', async () => {
        const requested = await window.api.machineIdRequestAdminRestart()
        if (active && !requested)
            setError(failureMessage(isEn.value ? 'Restart as admin' : '以管理员重启'))
    })
}

function updateConfig(key, value) {
    machine.setMachineIdConfig({ [key]: value })
}

function openBindings() {
    accountSearch.value = ''
    cancelAccountEdit()
    bindingsOpen.value = true
}

function closeBindings() {
    cancelAccountEdit()
    bindingsOpen.value = false
}

function startAccountEdit(id) {
    editingAccountId.value = id
    editingMachineId.value = machine.accountMachineIds[id] || ''
}

function cancelAccountEdit() {
    editingAccountId.value = null
    editingMachineId.value = ''
}

function saveAccountEdit(id) {
    if (editingAccountId.value !== id) return
    const value = editingMachineId.value.trim()
    if (value) machine.bindMachineIdToAccount(id, value)
    cancelAccountEdit()
}

function randomizeAccount(id) {
    if (!accounts.accounts.has(id)) return
    const value = crypto.randomUUID()
    machine.bindMachineIdToAccount(id, value)
    if (editingAccountId.value === id) editingMachineId.value = value
}

function removeAccountBinding(id) {
    if (!machine.accountMachineIds[id]) return
    machine.$patch((state) => {
        const next = { ...state.accountMachineIds }
        delete next[id]
        state.accountMachineIds = next
    })
    void persistence.saveToStorage()
    if (editingAccountId.value === id) cancelAccountEdit()
}

function clearHistory() {
    machine.clearMachineIdHistory()
}

function historyAction(action) {
    const labels = {
        initial: isEn.value ? 'Init' : '初始',
        manual: isEn.value ? 'Manual' : '手动',
        auto_switch: isEn.value ? 'Auto' : '自动',
        restore: isEn.value ? 'Restore' : '恢复',
        bind: isEn.value ? 'Bind' : '绑定'
    }
    return labels[action] || action
}

function historyAccount(entry) {
    const account = accounts.accounts.get(entry.accountId)
    return account?.nickname || account?.email || entry.accountEmail || entry.accountId
}

onMounted(initialize)
onBeforeUnmount(() => {
    active = false
})
</script>

<template>
    <section class="kam-page" data-testid="page-machineId">
        <header class="kam-page-header">
            <div>
                <h1 class="machine-heading">
                    <Fingerprint :size="24" aria-hidden="true" />
                    {{ isEn ? 'Machine ID' : '机器码管理' }}
                </h1>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Manage device identifiers and account bindings.'
                            : '管理设备标识符与账户绑定。'
                    }}
                </p>
            </div>
            <div class="kam-actions">
                <UiBadge variant="outline"
                    ><Monitor :size="14" aria-hidden="true" /> {{ osName }}</UiBadge
                >
            </div>
        </header>

        <p v-if="error" class="machine-error" role="alert" data-testid="machineId-error">
            <AlertTriangle :size="16" aria-hidden="true" /> {{ error }}
        </p>

        <UiCard v-if="hasAdmin === false" density="compact" class="machine-admin">
            <div class="machine-split">
                <div>
                    <strong>{{ isEn ? 'Admin Required' : '需要管理员权限' }}</strong>
                    <p class="kam-muted">
                        {{
                            isEn
                                ? 'Run as administrator to modify machine ID.'
                                : '修改机器码需要以管理员身份运行应用。'
                        }}
                    </p>
                </div>
                <div class="kam-actions">
                    <UiButton
                        :disabled="Boolean(operation)"
                        :loading="operation === 'admin'"
                        data-testid="machineId-request-admin"
                        @click="requestAdmin"
                        ><Shield :size="16" />
                        {{ isEn ? 'Restart as Admin' : '以管理员重启' }}</UiButton
                    >
                </div>
            </div>
        </UiCard>

        <div class="kam-grid">
            <UiCard density="compact">
                <template #header
                    ><h2 class="ui-card-title">
                        {{ isEn ? 'Current Machine ID' : '当前机器码' }}
                        <UiBadge
                            v-if="
                                machine.currentMachineId &&
                                machine.currentMachineId !== machine.originalMachineId
                            "
                            dense
                            tone="accent"
                            >{{ isEn ? 'Modified' : '已修改' }}</UiBadge
                        >
                    </h2></template
                >
                <div class="machine-card-body">
                    <code class="machine-code kam-mono">{{
                        operation === 'initialize'
                            ? isEn
                                ? 'Loading...'
                                : '加载中...'
                            : machine.currentMachineId || (isEn ? 'Unable to get' : '无法获取')
                    }}</code>
                    <p v-if="machine.machineIdHistory.length" class="kam-muted">
                        {{ isEn ? 'Last modified:' : '最后修改：' }}
                        {{
                            formatTime(
                                machine.machineIdHistory[machine.machineIdHistory.length - 1]
                                    .timestamp
                            )
                        }}
                    </p>
                    <div class="kam-actions">
                        <UiCopyButton
                            :text="machine.currentMachineId"
                            :label="isEn ? 'Copy current ID' : '复制当前机器码'"
                            :disabled="!machine.currentMachineId"
                            data-testid="machineId-copy-current"
                        />
                        <UiButton
                            :disabled="Boolean(operation)"
                            :loading="operation === 'refresh'"
                            data-testid="machineId-refresh"
                            @click="refreshCurrent"
                            ><RefreshCw :size="16" /> {{ isEn ? 'Refresh' : '刷新' }}</UiButton
                        >
                    </div>
                </div>
            </UiCard>
            <UiCard density="compact">
                <template #header
                    ><h2 class="ui-card-title">
                        {{ isEn ? 'Original Machine ID Backup' : '原始机器码备份' }}
                        <UiBadge v-if="machine.originalMachineId" dense tone="success">{{
                            isEn ? 'Backed Up' : '已备份'
                        }}</UiBadge>
                    </h2></template
                >
                <div class="machine-card-body">
                    <template v-if="machine.originalMachineId">
                        <code class="machine-code kam-mono">{{ machine.originalMachineId }}</code>
                        <p class="kam-muted">
                            {{ isEn ? 'Backup time:' : '备份时间：' }}
                            {{
                                machine.originalBackupTime
                                    ? formatTime(machine.originalBackupTime)
                                    : isEn
                                      ? 'Unknown'
                                      : '未知'
                            }}
                        </p>
                        <div class="kam-actions">
                            <UiCopyButton
                                :text="machine.originalMachineId"
                                :label="isEn ? 'Copy original ID' : '复制原始机器码'"
                                data-testid="machineId-copy-original"
                            />
                            <UiButton
                                :disabled="
                                    Boolean(operation) ||
                                    machine.currentMachineId === machine.originalMachineId
                                "
                                :loading="operation === 'restore'"
                                data-testid="machineId-restore"
                                @click="restoreOriginal"
                                ><RotateCcw :size="16" />
                                {{ isEn ? 'Restore' : '恢复原始' }}</UiButton
                            >
                        </div>
                    </template>
                    <p v-else class="kam-muted machine-empty">
                        {{
                            isEn
                                ? 'Original ID will be backed up on first change.'
                                : '首次修改机器码时将自动备份原始值。'
                        }}
                    </p>
                </div>
            </UiCard>
        </div>

        <UiCard density="compact">
            <template #header
                ><h2 class="ui-card-title">{{ isEn ? 'Operations' : '机器码操作' }}</h2></template
            >
            <div class="kam-grid machine-operations">
                <div class="machine-operation">
                    <strong
                        ><Shuffle :size="17" /> {{ isEn ? 'Random Generate' : '随机生成' }}</strong
                    >
                    <p class="kam-muted">
                        {{
                            isEn
                                ? 'Generate a UUID format machine ID.'
                                : '一键生成 UUID 格式机器码。'
                        }}
                    </p>
                    <div class="kam-actions">
                        <UiButton
                            variant="primary"
                            :disabled="Boolean(operation)"
                            :loading="operation === 'random'"
                            data-testid="machineId-random"
                            @click="randomChange"
                            >{{ isEn ? 'Generate & Apply' : '随机生成并应用' }}</UiButton
                        >
                    </div>
                </div>
                <div class="machine-operation">
                    <strong>{{ isEn ? 'Custom Input' : '自定义输入' }}</strong>
                    <div class="machine-field">
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="isEn ? 'Machine ID' : '机器码'"
                            for="machineId-custom"
                            ><UiInput
                                v-model="customMachineId"
                                v-bind="controlAttrs"
                                class="kam-mono"
                                :placeholder="
                                    isEn
                                        ? 'Enter UUID format machine ID...'
                                        : '输入 UUID 格式机器码...'
                                "
                                data-testid="machineId-custom"
                        /></UiField>
                    </div>
                    <div class="kam-actions">
                        <UiButton
                            :disabled="Boolean(operation) || !customMachineId.trim()"
                            :loading="operation === 'custom'"
                            data-testid="machineId-apply-custom"
                            @click="customChange"
                            >{{ isEn ? 'Apply Custom ID' : '应用自定义机器码' }}</UiButton
                        >
                    </div>
                </div>
            </div>
            <div class="kam-actions machine-file-actions">
                <UiButton
                    :disabled="Boolean(operation) || !machine.currentMachineId"
                    :loading="operation === 'export'"
                    data-testid="machineId-export"
                    @click="backupToFile"
                    ><Download :size="16" /> {{ isEn ? 'Export to File' : '导出到文件' }}</UiButton
                >
                <UiButton
                    :disabled="Boolean(operation)"
                    :loading="operation === 'import'"
                    data-testid="machineId-import"
                    @click="restoreFromFile"
                    ><Upload :size="16" /> {{ isEn ? 'Import from File' : '从文件导入' }}</UiButton
                >
            </div>
        </UiCard>

        <UiCard density="compact">
            <template #header
                ><h2 class="ui-card-title">{{ isEn ? 'Automation' : '自动化设置' }}</h2></template
            >
            <div class="machine-settings">
                <div class="machine-split">
                    <div>
                        <strong>{{
                            isEn ? 'Auto Change on Switch' : '切换账号时自动更换机器码'
                        }}</strong>
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? 'Auto generate new ID when switching accounts.'
                                    : '每次切换账号时自动生成并应用新的机器码。'
                            }}
                        </p>
                    </div>
                    <UiSwitch
                        :model-value="machine.machineIdConfig.autoSwitchOnAccountChange"
                        :aria-label="isEn ? 'Auto Change on Switch' : '切换账号时自动更换机器码'"
                        data-testid="machineId-auto-switch"
                        @update:model-value="updateConfig('autoSwitchOnAccountChange', $event)"
                    />
                </div>
                <div class="machine-split">
                    <div>
                        <strong>{{ isEn ? 'Account ID Binding' : '账户机器码绑定' }}</strong>
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? 'Assign a unique ID per account, applied on switch.'
                                    : '为每个账户分配唯一的机器码，切换时自动使用。'
                            }}
                        </p>
                    </div>
                    <UiSwitch
                        :model-value="machine.machineIdConfig.bindMachineIdToAccount"
                        :aria-label="isEn ? 'Account ID Binding' : '账户机器码绑定'"
                        data-testid="machineId-bind-enabled"
                        @update:model-value="updateConfig('bindMachineIdToAccount', $event)"
                    />
                </div>
                <div v-if="machine.machineIdConfig.bindMachineIdToAccount" class="machine-split">
                    <div>
                        <strong>{{
                            isEn ? 'Use bound machine ID' : '使用绑定的唯一机器码'
                        }}</strong>
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? 'When off, generates a new ID on each switch.'
                                    : '关闭时每次切换将随机生成新机器码。'
                            }}
                        </p>
                    </div>
                    <UiSwitch
                        :model-value="machine.machineIdConfig.useBindedMachineId"
                        :aria-label="isEn ? 'Use bound machine ID' : '使用绑定的唯一机器码'"
                        data-testid="machineId-use-bound"
                        @update:model-value="updateConfig('useBindedMachineId', $event)"
                    />
                </div>
            </div>
        </UiCard>

        <div class="kam-grid">
            <UiCard density="compact"
                ><div class="machine-split">
                    <div>
                        <strong
                            ><Users :size="17" />
                            {{ isEn ? 'Account Machine ID' : '账户机器码管理' }}</strong
                        >
                        <p class="kam-muted">
                            {{
                                isEn ? `${boundCount} bound accounts` : `${boundCount} 个已绑定账户`
                            }}
                        </p>
                    </div>
                    <UiButton data-testid="machineId-open-bindings" @click="openBindings">{{
                        isEn ? 'Manage' : '管理'
                    }}</UiButton>
                </div></UiCard
            >
            <UiCard density="compact"
                ><div class="machine-split">
                    <div>
                        <strong
                            ><History :size="17" />
                            {{ isEn ? 'Change History' : '变更历史记录' }}</strong
                        >
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? `${machine.machineIdHistory.length} records`
                                    : `共 ${machine.machineIdHistory.length} 条历史记录`
                            }}
                        </p>
                    </div>
                    <UiButton data-testid="machineId-open-history" @click="historyOpen = true">{{
                        isEn ? 'View' : '查看'
                    }}</UiButton>
                </div></UiCard
            >
        </div>

        <UiCard density="compact">
            <template #header
                ><h2 class="ui-card-title">{{ isEn ? 'Platform Notes' : '平台说明' }}</h2></template
            >
            <div class="machine-platforms">
                <p>
                    <strong>Windows</strong> —
                    {{
                        isEn
                            ? 'Modifies registry MachineGuid; requires admin.'
                            : '修改注册表 MachineGuid，需要管理员权限。'
                    }}
                </p>
                <p>
                    <strong>macOS</strong> —
                    {{
                        isEn
                            ? 'App-level override; hardware UUID unchanged.'
                            : '应用层覆盖方式，原生硬件 UUID 无法修改。'
                    }}
                </p>
                <p>
                    <strong>Linux</strong> —
                    {{
                        isEn
                            ? 'Modifies /etc/machine-id; requires root.'
                            : '修改 /etc/machine-id，需要 root 权限。'
                    }}
                </p>
            </div>
            <p class="kam-muted machine-caution">
                <AlertTriangle :size="16" />
                {{
                    isEn
                        ? 'Changing machine ID may affect some software licenses.'
                        : '修改机器码可能影响部分软件的授权，请谨慎操作。'
                }}
            </p>
        </UiCard>

        <UiDialog
            :open="bindingsOpen"
            size="lg"
            scrollable
            :aria-label="isEn ? 'Account Machine ID' : '账户机器码管理'"
            :content-label="isEn ? 'Account bindings' : '账户绑定列表'"
            @update:open="closeBindings"
        >
            <template #header
                ><h2 class="ui-card-title">
                    {{ isEn ? 'Account Machine ID' : '账户机器码管理' }}
                    <UiBadge dense>{{ accountList.length }}</UiBadge>
                </h2></template
            >
            <div class="kam-dialog-content">
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="isEn ? 'Search accounts' : '搜索账户'"
                    for="machineId-account-search"
                    ><UiInput
                        v-model="accountSearch"
                        v-bind="controlAttrs"
                        :placeholder="
                            isEn ? 'Email, nickname, or machine ID' : '邮箱、昵称或机器码'
                        "
                        data-testid="machineId-account-search"
                /></UiField>
                <p v-if="!accountList.length" class="kam-muted machine-empty">
                    {{
                        isEn
                            ? 'No accounts. Please add accounts first.'
                            : '暂无账户，请先添加账户。'
                    }}
                </p>
                <p v-else-if="!filteredAccounts.length" class="kam-muted machine-empty">
                    {{ isEn ? 'No matches found.' : '未找到匹配的账户。' }}
                </p>
                <div v-else class="machine-account-list">
                    <div
                        v-for="account in filteredAccounts"
                        :key="account.id"
                        class="machine-account"
                        :data-testid="`machineId-account-${account.id}`"
                    >
                        <div class="machine-split">
                            <div class="machine-account-name">
                                <strong>{{ account.nickname || account.email }}</strong
                                ><span v-if="account.nickname && account.email" class="kam-muted">{{
                                    account.email
                                }}</span
                                ><UiBadge
                                    v-if="machine.accountMachineIds[account.id]"
                                    dense
                                    tone="success"
                                    >{{ isEn ? 'Bound' : '已绑定' }}</UiBadge
                                >
                            </div>
                            <div class="kam-actions">
                                <template v-if="editingAccountId === account.id"
                                    ><UiButton
                                        size="sm"
                                        variant="primary"
                                        :data-testid="`machineId-save-binding-${account.id}`"
                                        @click="saveAccountEdit(account.id)"
                                        >{{ isEn ? 'Save' : '保存' }}</UiButton
                                    ><UiButton
                                        size="sm"
                                        :data-testid="`machineId-cancel-binding-${account.id}`"
                                        @click="cancelAccountEdit"
                                        >{{ isEn ? 'Cancel' : '取消' }}</UiButton
                                    ></template
                                ><UiButton
                                    v-else
                                    size="sm"
                                    :data-testid="`machineId-edit-binding-${account.id}`"
                                    @click="startAccountEdit(account.id)"
                                    >{{ isEn ? 'Edit' : '编辑' }}</UiButton
                                ><UiButton
                                    size="sm"
                                    :data-testid="`machineId-random-binding-${account.id}`"
                                    @click="randomizeAccount(account.id)"
                                    ><Shuffle :size="14" /> {{ isEn ? 'Random' : '随机' }}</UiButton
                                ><UiCopyButton
                                    v-if="machine.accountMachineIds[account.id]"
                                    :text="machine.accountMachineIds[account.id]"
                                    :label="isEn ? 'Copy binding' : '复制绑定机器码'"
                                    :data-testid="`machineId-copy-binding-${account.id}`"
                                /><UiButton
                                    v-if="machine.accountMachineIds[account.id]"
                                    icon
                                    size="sm"
                                    variant="danger"
                                    :aria-label="isEn ? 'Remove binding' : '删除绑定'"
                                    :data-testid="`machineId-remove-binding-${account.id}`"
                                    @click="removeAccountBinding(account.id)"
                                    ><Trash2 :size="14"
                                /></UiButton>
                            </div>
                        </div>
                        <UiField
                            v-if="editingAccountId === account.id"
                            v-slot="{ controlAttrs }"
                            :label="isEn ? 'Bound machine ID' : '绑定机器码'"
                            :for="`machineId-binding-input-${account.id}`"
                            ><UiInput
                                v-model="editingMachineId"
                                v-bind="controlAttrs"
                                class="kam-mono"
                                :placeholder="
                                    isEn ? 'Enter UUID format machine ID' : '输入 UUID 格式机器码'
                                "
                                :data-testid="`machineId-binding-input-${account.id}`"
                        /></UiField>
                        <code
                            v-else-if="machine.accountMachineIds[account.id]"
                            class="machine-code kam-mono"
                            >{{ machine.accountMachineIds[account.id] }}</code
                        >
                        <p v-else class="kam-muted">{{ isEn ? 'Not bound' : '未绑定' }}</p>
                    </div>
                </div>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'After binding, switching to this account can apply its machine ID when enabled above.'
                            : '启用上述绑定设置后，切换到账户时可自动应用其机器码。'
                    }}
                </p>
            </div>
            <template #footer
                ><UiButton @click="closeBindings">{{ isEn ? 'Close' : '关闭' }}</UiButton></template
            >
        </UiDialog>

        <UiDialog
            :open="historyOpen"
            size="md"
            scrollable
            :aria-label="isEn ? 'Change History' : '变更历史'"
            :content-label="isEn ? 'Machine ID history' : '机器码变更历史'"
            @update:open="historyOpen = false"
        >
            <template #header
                ><h2 class="ui-card-title">
                    {{ isEn ? 'Change History' : '变更历史' }}
                    <UiBadge dense>{{ machine.machineIdHistory.length }}</UiBadge>
                </h2></template
            >
            <div class="kam-dialog-content">
                <p v-if="!historyNewestFirst.length" class="kam-muted machine-empty">
                    {{
                        isEn
                            ? 'No change records. Changes will be recorded automatically.'
                            : '暂无变更记录，机器码变更后将自动记录。'
                    }}
                </p>
                <div v-else class="machine-history-list">
                    <div
                        v-for="(entry, index) in historyNewestFirst"
                        :key="entry.id"
                        class="machine-history-entry"
                    >
                        <div class="machine-split">
                            <div class="kam-actions">
                                <span class="kam-muted"
                                    >#{{ machine.machineIdHistory.length - index }}</span
                                ><UiBadge dense tone="accent">{{
                                    historyAction(entry.action)
                                }}</UiBadge>
                            </div>
                            <time class="kam-muted">{{ formatTime(entry.timestamp) }}</time>
                        </div>
                        <div class="machine-split">
                            <code class="kam-mono">{{ entry.machineId }}</code
                            ><UiCopyButton
                                :text="entry.machineId"
                                :label="isEn ? 'Copy history ID' : '复制历史机器码'"
                                :data-testid="`machineId-copy-history-${entry.id}`"
                            />
                        </div>
                        <p v-if="entry.accountId" class="kam-muted">
                            {{ isEn ? 'Account:' : '关联账户：' }} {{ historyAccount(entry) }}
                        </p>
                    </div>
                </div>
            </div>
            <template #footer
                ><UiButton
                    v-if="machine.machineIdHistory.length"
                    variant="danger"
                    data-testid="machineId-clear-history"
                    @click="clearHistory"
                    ><Trash2 :size="16" /> {{ isEn ? 'Clear' : '清空' }}</UiButton
                ><UiButton @click="historyOpen = false">{{
                    isEn ? 'Close' : '关闭'
                }}</UiButton></template
            >
        </UiDialog>
    </section>
</template>

<style scoped>
.machine-heading,
.machine-split,
.machine-split strong,
.machine-operation strong,
.machine-caution,
.machine-error {
    display: flex;
    align-items: center;
    gap: 8px;
}
.machine-split {
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
}
.machine-card-body,
.machine-settings,
.machine-account-list,
.machine-history-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.machine-card-body {
    min-height: 146px;
}
.machine-code {
    display: block;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--soft);
    font-size: 12px;
}
.machine-empty {
    padding: 20px 0;
    text-align: center;
}
.machine-operation {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
}
.machine-field {
    width: 100%;
}
.machine-file-actions {
    padding-top: 14px;
    border-top: 1px solid var(--line);
}
.machine-settings > .machine-split + .machine-split {
    padding-top: 14px;
    border-top: 1px solid var(--line);
}
.machine-account,
.machine-history-entry {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
}
.machine-account-name {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
}
.machine-account-name span,
.machine-history-entry time {
    font-size: 12px;
}
.machine-history-entry code {
    min-width: 0;
    overflow-wrap: anywhere;
}
.machine-platforms {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
}
.machine-platforms p {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
}
.machine-caution {
    margin-top: 12px !important;
}
.machine-error {
    color: var(--red);
    padding: 10px 12px;
    border: 1px solid var(--red);
    border-radius: 8px;
    background: var(--red-background);
}
.machine-admin {
    border-color: var(--amber);
}
@media (max-width: 900px) {
    .machine-platforms {
        grid-template-columns: 1fr;
    }
}
</style>
