<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiCollapse,
    UiField,
    UiInput,
    UiSelect,
    UiSwitch,
    confirmDialog
} from '@lingyzh/ui'
import {
    ChevronDown,
    ChevronUp,
    ExternalLink,
    FileText,
    FolderOpen,
    Plus,
    RefreshCw,
    Save,
    Settings2,
    Shield,
    Sparkles,
    Terminal,
    Trash2,
    Zap
} from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { toIpcData } from '../../lib/ipcData'
import McpServerEditor from '../kiro/McpServerEditor.vue'
import SteeringEditor from '../kiro/SteeringEditor.vue'

const defaultDenyCommands = [
    'rm -rf *',
    'rm -rf /',
    'rm -rf ~',
    'del /f /s /q *',
    'format',
    'mkfs',
    'dd if=',
    ':(){:|:&};:',
    'chmod -R 777 /',
    'chown -R',
    '> /dev/sda',
    'wget * | sh',
    'curl * | sh',
    'shutdown',
    'reboot',
    'init 0',
    'init 6'
]
const defaults = {
    agentAutonomy: 'Autopilot',
    modelSelection: 'auto',
    enableDebugLogs: false,
    enableTabAutocomplete: false,
    enableCodebaseIndexing: false,
    usageSummary: true,
    codeReferences: false,
    configureMCP: 'Enabled',
    trustedCommands: [],
    trustedTools: {},
    commandDenylist: [],
    ignoreFiles: [],
    mcpApprovedEnvVars: [],
    notificationsActionRequired: true,
    notificationsFailure: false,
    notificationsSuccess: false,
    notificationsBilling: true
}
const { t } = useTranslation()
const isEn = computed(() => t('common.unknown') === 'Unknown')
const settings = ref({ ...defaults })
const mcpConfig = ref({ mcpServers: {} })
const steeringFiles = ref([])
const availableModels = ref([])
const loading = ref(false)
const loadingModels = ref(false)
const operation = ref('')
const confirmingDelete = ref(false)
const error = ref('')
const success = ref('')
const expanded = ref({ agent: true, mcp: true, steering: true, commands: false })
const newTrustedCommand = ref('')
const newTrustedToolName = ref('')
const newDenyCommand = ref('')
const editingFile = ref(null)
const editingMcp = ref(null)
let active = true
let settingsGeneration = 0
let modelsGeneration = 0

const mcpServers = computed(() => Object.entries(mcpConfig.value?.mcpServers || {}))
const booleanOptions = [
    { key: 'enableTabAutocomplete', zh: 'Tab 自动补全', en: 'Enable Tab Autocomplete' },
    { key: 'usageSummary', zh: '使用统计', en: 'Usage Summary' },
    { key: 'codeReferences', zh: '代码引用追踪', en: 'Code References: Reference Tracker' },
    { key: 'enableCodebaseIndexing', zh: '代码库索引', en: 'Enable Codebase Indexing' },
    { key: 'enableDebugLogs', zh: '调试日志', en: 'Enable Debug Logs' },
    { key: 'notificationsActionRequired', zh: 'Agent: 需要操作', en: 'Agent: Action Required' },
    { key: 'notificationsFailure', zh: 'Agent: 失败', en: 'Agent: Failure' },
    { key: 'notificationsSuccess', zh: 'Agent: 成功', en: 'Agent: Success' },
    { key: 'notificationsBilling', zh: '账单', en: 'Billing' }
]

function showError(value, fallback) {
    if (!active) return
    error.value = value || fallback
    success.value = ''
}

function clearFeedback() {
    error.value = ''
    success.value = ''
}

function loadSettings(preserveFeedback = false) {
    if (!active || loading.value || operation.value) return Promise.resolve()
    const generation = ++settingsGeneration
    loading.value = true
    if (!preserveFeedback) clearFeedback()
    return Promise.resolve()
        .then(() => {
            if (!active || generation !== settingsGeneration) return null
            return window.api.getKiroSettings()
        })
        .then((result) => {
            if (!active || generation !== settingsGeneration) return
            if (result.error) {
                showError(
                    result.error,
                    isEn.value ? 'Failed to load Kiro settings' : '加载 Kiro 设置失败'
                )
                return
            }
            const loaded = Object.fromEntries(
                Object.entries(result.settings || {}).filter(([, value]) => value !== undefined)
            )
            settings.value = { ...defaults, ...loaded }
            mcpConfig.value = result.mcpConfig || { mcpServers: {} }
            steeringFiles.value = result.steeringFiles || []
        })
        .catch((cause) => {
            if (active && generation === settingsGeneration)
                showError(
                    cause instanceof Error ? cause.message : String(cause),
                    isEn.value ? 'Failed to load Kiro settings' : '加载 Kiro 设置失败'
                )
        })
        .finally(() => {
            if (active && generation === settingsGeneration) loading.value = false
        })
}

function loadModels() {
    if (!active || loadingModels.value) return
    const generation = ++modelsGeneration
    loadingModels.value = true
    Promise.resolve()
        .then(() => {
            if (!active || generation !== modelsGeneration) return null
            return window.api.getKiroAvailableModels()
        })
        .then((result) => {
            if (!active || generation !== modelsGeneration) return
            if (result.error) {
                showError(result.error, isEn.value ? 'Failed to load models' : '加载模型失败')
                return
            }
            if (result.models?.length) availableModels.value = result.models
        })
        .catch((cause) => {
            if (active && generation === modelsGeneration)
                showError(
                    cause instanceof Error ? cause.message : String(cause),
                    isEn.value ? 'Failed to load models' : '加载模型失败'
                )
        })
        .finally(() => {
            if (active && generation === modelsGeneration) loadingModels.value = false
        })
}

function runAction(name, action, reload = false) {
    if (!active || operation.value || loading.value) return
    operation.value = name
    clearFeedback()
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return action()
        })
        .then(async (result) => {
            if (!active) return
            if (!result?.success) {
                showError(result?.error, isEn.value ? 'Operation failed' : '操作失败')
                return
            }
            success.value = isEn.value ? 'Completed' : '操作成功'
            if (reload && active) {
                operation.value = ''
                await loadSettings(true)
            }
        })
        .catch((cause) => {
            if (active)
                showError(
                    cause instanceof Error ? cause.message : String(cause),
                    isEn.value ? 'Operation failed' : '操作失败'
                )
        })
        .finally(() => {
            if (active) operation.value = ''
        })
}

function saveSettings() {
    runAction('save-settings', () => window.api.saveKiroSettings(toIpcData(settings.value)))
}

function openSettingsFile() {
    runAction('open-settings', () => window.api.openKiroSettingsFile())
}

function openMcpConfig(type) {
    runAction(`open-mcp-${type}`, () => window.api.openKiroMcpConfig(type))
}

function openSteeringFolder() {
    runAction('open-steering-folder', () => window.api.openKiroSteeringFolder())
}

function openSteeringFile(filename) {
    runAction(`open-steering-${filename}`, () => window.api.openKiroSteeringFile(filename))
}

function createRules() {
    runAction('create-rules', () => window.api.createKiroDefaultRules(), true)
}

function deleteSteering(filename) {
    if (operation.value || confirmingDelete.value) return
    confirmingDelete.value = true
    confirmDialog({
        title: isEn.value ? 'Delete Steering file' : '删除 Steering 文件',
        message: isEn.value
            ? `Delete "${filename}"? This cannot be undone.`
            : `确定要删除 "${filename}" 吗？此操作无法撤销。`,
        confirmText: isEn.value ? 'Delete' : '删除',
        tone: 'danger'
    })
        .then((confirmed) => {
            if (active && confirmed)
                runAction(
                    `delete-steering-${filename}`,
                    () => window.api.deleteKiroSteeringFile(filename),
                    true
                )
        })
        .finally(() => {
            if (active) confirmingDelete.value = false
        })
}

function deleteMcp(name) {
    if (operation.value || confirmingDelete.value) return
    confirmingDelete.value = true
    confirmDialog({
        title: isEn.value ? 'Delete MCP server' : '删除 MCP 服务器',
        message: isEn.value
            ? `Delete MCP server "${name}"?`
            : `确定要删除 MCP 服务器 "${name}" 吗？`,
        confirmText: isEn.value ? 'Delete' : '删除',
        tone: 'danger'
    })
        .then((confirmed) => {
            if (active && confirmed)
                runAction(`delete-mcp-${name}`, () => window.api.deleteMcpServer(name), true)
        })
        .finally(() => {
            if (active) confirmingDelete.value = false
        })
}

function updateSetting(key, value) {
    settings.value = { ...settings.value, [key]: value }
}

function toggleSection(section) {
    expanded.value = { ...expanded.value, [section]: !expanded.value[section] }
}

function addTrustedCommand() {
    const value = newTrustedCommand.value.trim()
    if (!value) return
    updateSetting('trustedCommands', [...settings.value.trustedCommands, value])
    newTrustedCommand.value = ''
}

function removeTrustedCommand(index) {
    updateSetting(
        'trustedCommands',
        settings.value.trustedCommands.filter((_, position) => position !== index)
    )
}

function addTrustedTool() {
    const value = newTrustedToolName.value.trim()
    if (!value) return
    updateSetting('trustedTools', { ...settings.value.trustedTools, [value]: true })
    newTrustedToolName.value = ''
}

function removeTrustedTool(name) {
    const next = { ...settings.value.trustedTools }
    delete next[name]
    updateSetting('trustedTools', next)
}

function addDenyCommand() {
    const value = newDenyCommand.value.trim()
    if (!value) return
    updateSetting('commandDenylist', [...settings.value.commandDenylist, value])
    newDenyCommand.value = ''
}

function removeDenyCommand(index) {
    updateSetting(
        'commandDenylist',
        settings.value.commandDenylist.filter((_, position) => position !== index)
    )
}

function addDefaultDenyCommands() {
    const additions = defaultDenyCommands.filter(
        (command) => !settings.value.commandDenylist.includes(command)
    )
    updateSetting('commandDenylist', [...settings.value.commandDenylist, ...additions])
}

function onEditorSaved() {
    void loadSettings()
}

onMounted(() => {
    void loadSettings()
    loadModels()
})
onBeforeUnmount(() => {
    active = false
    settingsGeneration += 1
    modelsGeneration += 1
})
</script>

<template>
    <section class="kam-page" data-testid="page-kiroSettings">
        <header class="kam-page-header">
            <div>
                <h1 class="kiro-heading">
                    <Sparkles :size="24" /> {{ isEn ? 'Kiro Settings' : 'Kiro 设置' }}
                </h1>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Manage Kiro IDE config, MCP servers and user rules.'
                            : '管理 Kiro IDE 的配置、MCP 服务器和用户规则。'
                    }}
                </p>
            </div>
            <div class="kam-actions">
                <UiButton
                    :disabled="loading || Boolean(operation)"
                    data-testid="kiro-refresh"
                    @click="loadSettings()"
                    ><RefreshCw :size="16" /> {{ isEn ? 'Refresh' : '刷新' }}</UiButton
                ><UiButton
                    :disabled="loading || Boolean(operation)"
                    data-testid="kiro-open-settings-file"
                    @click="openSettingsFile"
                    ><ExternalLink :size="16" /> {{ isEn ? 'Open File' : '打开设置文件' }}</UiButton
                ><UiButton
                    variant="primary"
                    :loading="operation === 'save-settings'"
                    :disabled="loading || Boolean(operation)"
                    data-testid="kiro-save-settings"
                    @click="saveSettings"
                    ><Save :size="16" /> {{ isEn ? 'Save' : '保存设置' }}</UiButton
                >
            </div>
        </header>
        <UiAlert v-if="error" tone="error" dense data-testid="kiro-error">{{ error }}</UiAlert>
        <UiAlert v-if="success" tone="success" dense data-testid="kiro-success">{{
            success
        }}</UiAlert>
        <p v-if="loading" class="kam-muted" data-testid="kiro-loading">
            <RefreshCw :size="16" /> {{ isEn ? 'Loading...' : '加载中...' }}
        </p>
        <template v-else>
            <UiCard density="compact"
                ><template #header
                    ><UiButton
                        class="kiro-section-toggle"
                        variant="ghost"
                        :aria-expanded="expanded.agent"
                        data-testid="kiro-section-agent"
                        @click="toggleSection('agent')"
                    >
                        <span
                            ><Settings2 :size="17" />
                            {{ isEn ? 'Agent Settings' : 'Agent 设置' }}</span
                        ><ChevronUp v-if="expanded.agent" :size="17" /><ChevronDown
                            v-else
                            :size="17" /></UiButton></template
                ><UiCollapse :open="expanded.agent"
                    ><div class="kiro-section-body">
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="isEn ? 'Agent Autonomy' : 'Agent 自主模式'"
                            for="kiro-autonomy"
                            ><UiSelect
                                v-model="settings.agentAutonomy"
                                v-bind="controlAttrs"
                                data-testid="kiro-autonomy"
                                ><option
                                    v-if="
                                        !['Autopilot', 'Supervised'].includes(
                                            settings.agentAutonomy
                                        )
                                    "
                                    :value="settings.agentAutonomy"
                                >
                                    {{ settings.agentAutonomy }}
                                </option>
                                <option value="Autopilot">
                                    {{ isEn ? 'Autopilot (Auto)' : 'Autopilot (自动执行)' }}
                                </option>
                                <option value="Supervised">
                                    {{ isEn ? 'Supervised (Confirm)' : 'Supervised (需确认)' }}
                                </option></UiSelect
                            ></UiField
                        >
                        <div class="kiro-model-row">
                            <UiField
                                v-slot="{ controlAttrs }"
                                :label="isEn ? 'Model Selection' : '模型选择'"
                                for="kiro-model"
                                ><UiSelect
                                    v-if="availableModels.length"
                                    v-model="settings.modelSelection"
                                    v-bind="controlAttrs"
                                    data-testid="kiro-model"
                                    ><option
                                        v-if="
                                            !availableModels.some(
                                                (model) => model.id === settings.modelSelection
                                            )
                                        "
                                        :value="settings.modelSelection"
                                    >
                                        {{ settings.modelSelection }}
                                    </option>
                                    <option
                                        v-for="model in availableModels"
                                        :key="model.id"
                                        :value="model.id"
                                    >
                                        {{ model.name || model.id }}
                                    </option></UiSelect
                                ><UiInput
                                    v-else
                                    v-model="settings.modelSelection"
                                    v-bind="controlAttrs"
                                    placeholder="claude-haiku-4.5"
                                    data-testid="kiro-model" /></UiField
                            ><UiButton
                                icon
                                :disabled="loadingModels"
                                :loading="loadingModels"
                                :aria-label="isEn ? 'Refresh models' : '刷新模型列表'"
                                data-testid="kiro-refresh-models"
                                @click="loadModels"
                                ><RefreshCw :size="16"
                            /></UiButton>
                        </div>
                        <template v-for="option in booleanOptions" :key="option.key">
                            <h3 v-if="option.key === 'notificationsActionRequired'">
                                {{ isEn ? 'Notifications' : '通知设置' }}
                            </h3>
                            <div class="kiro-setting-row">
                                <span>{{ isEn ? option.en : option.zh }}</span
                                ><UiSwitch
                                    :model-value="settings[option.key]"
                                    :aria-label="isEn ? option.en : option.zh"
                                    :data-testid="`kiro-setting-${option.key}`"
                                    @update:model-value="updateSetting(option.key, $event)"
                                />
                            </div>
                        </template></div></UiCollapse
            ></UiCard>

            <UiCard density="compact"
                ><template #header
                    ><UiButton
                        class="kiro-section-toggle"
                        variant="ghost"
                        :aria-expanded="expanded.mcp"
                        data-testid="kiro-section-mcp"
                        @click="toggleSection('mcp')"
                    >
                        <span
                            ><Zap :size="17" /> {{ isEn ? 'MCP Servers' : 'MCP 服务器' }}
                            <UiBadge dense>{{ mcpServers.length }}</UiBadge></span
                        ><ChevronUp v-if="expanded.mcp" :size="17" /><ChevronDown
                            v-else
                            :size="17" /></UiButton></template
                ><UiCollapse :open="expanded.mcp"
                    ><div class="kiro-section-body">
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="isEn ? 'Enable MCP' : '启用 MCP'"
                            for="kiro-configure-mcp"
                            ><UiSelect
                                v-model="settings.configureMCP"
                                v-bind="controlAttrs"
                                data-testid="kiro-configure-mcp"
                                ><option
                                    v-if="!['Enabled', 'Disabled'].includes(settings.configureMCP)"
                                    :value="settings.configureMCP"
                                >
                                    {{ settings.configureMCP }}
                                </option>
                                <option value="Enabled">{{ isEn ? 'Enabled' : '启用' }}</option>
                                <option value="Disabled">
                                    {{ isEn ? 'Disabled' : '禁用' }}
                                </option></UiSelect
                            ></UiField
                        >
                        <h3>{{ isEn ? 'Configured MCP Servers' : '已配置的 MCP 服务器' }}</h3>
                        <p v-if="!mcpServers.length" class="kam-muted">
                            {{ isEn ? 'No MCP servers configured.' : '暂无配置的 MCP 服务器。' }}
                        </p>
                        <div v-else class="kiro-list">
                            <div
                                v-for="[name, server] in mcpServers"
                                :key="name"
                                class="kiro-list-row"
                            >
                                <div>
                                    <strong>{{ name }}</strong>
                                    <p class="kam-muted kam-mono">{{ server.command }}</p>
                                </div>
                                <div class="kam-actions">
                                    <UiButton
                                        size="sm"
                                        :disabled="Boolean(operation)"
                                        :data-testid="`kiro-edit-mcp-${name}`"
                                        @click="editingMcp = { name, server }"
                                        >{{ isEn ? 'Edit' : '编辑' }}</UiButton
                                    ><UiButton
                                        icon
                                        size="sm"
                                        variant="danger"
                                        :disabled="Boolean(operation)"
                                        :aria-label="isEn ? 'Delete server' : '删除服务器'"
                                        :data-testid="`kiro-delete-mcp-${name}`"
                                        @click="deleteMcp(name)"
                                        ><Trash2 :size="15"
                                    /></UiButton>
                                </div>
                            </div>
                        </div>
                        <div class="kam-actions">
                            <UiButton data-testid="kiro-add-mcp" @click="editingMcp = {}"
                                ><Plus :size="16" />
                                {{ isEn ? 'Add MCP Server' : '添加 MCP 服务器' }}</UiButton
                            ><UiButton
                                :disabled="Boolean(operation)"
                                data-testid="kiro-open-mcp-user"
                                @click="openMcpConfig('user')"
                                ><FolderOpen :size="16" />
                                {{ isEn ? 'User MCP Config' : '用户 MCP 配置' }}</UiButton
                            ><UiButton
                                :disabled="Boolean(operation)"
                                data-testid="kiro-open-mcp-workspace"
                                @click="openMcpConfig('workspace')"
                                ><FolderOpen :size="16" />
                                {{ isEn ? 'Workspace MCP Config' : '工作区 MCP 配置' }}</UiButton
                            >
                        </div>
                    </div></UiCollapse
                ></UiCard
            >

            <UiCard density="compact"
                ><template #header
                    ><UiButton
                        class="kiro-section-toggle"
                        variant="ghost"
                        :aria-expanded="expanded.steering"
                        data-testid="kiro-section-steering"
                        @click="toggleSection('steering')"
                    >
                        <span
                            ><FileText :size="17" />
                            {{ isEn ? 'User Rules (Steering)' : '用户规则 (Steering)' }}
                            <UiBadge dense>{{ steeringFiles.length }}</UiBadge></span
                        ><ChevronUp v-if="expanded.steering" :size="17" /><ChevronDown
                            v-else
                            :size="17" /></UiButton></template
                ><UiCollapse :open="expanded.steering"
                    ><div class="kiro-section-body">
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? 'Steering files define assistant behavior rules and context.'
                                    : 'Steering 文件用于定义助手的行为规则和上下文。'
                            }}
                        </p>
                        <p v-if="!steeringFiles.length" class="kam-muted">
                            {{ isEn ? 'No steering files.' : '暂无 Steering 文件。' }}
                        </p>
                        <div v-else class="kiro-list">
                            <div v-for="file in steeringFiles" :key="file" class="kiro-list-row">
                                <code class="kam-mono">{{ file }}</code>
                                <div class="kam-actions">
                                    <UiButton
                                        size="sm"
                                        :data-testid="`kiro-edit-steering-${file}`"
                                        @click="editingFile = file"
                                        >{{ isEn ? 'Edit' : '编辑' }}</UiButton
                                    ><UiButton
                                        icon
                                        size="sm"
                                        :disabled="Boolean(operation)"
                                        :aria-label="isEn ? 'Open externally' : '外部打开'"
                                        :data-testid="`kiro-open-steering-${file}`"
                                        @click="openSteeringFile(file)"
                                        ><ExternalLink :size="15" /></UiButton
                                    ><UiButton
                                        icon
                                        size="sm"
                                        variant="danger"
                                        :disabled="Boolean(operation)"
                                        :aria-label="isEn ? 'Delete file' : '删除文件'"
                                        :data-testid="`kiro-delete-steering-${file}`"
                                        @click="deleteSteering(file)"
                                        ><Trash2 :size="15"
                                    /></UiButton>
                                </div>
                            </div>
                        </div>
                        <div class="kam-actions">
                            <UiButton
                                :disabled="Boolean(operation)"
                                data-testid="kiro-create-rules"
                                @click="createRules"
                                ><Plus :size="16" />
                                {{ isEn ? 'Create Rules' : '创建规则文件' }}</UiButton
                            ><UiButton
                                :disabled="Boolean(operation)"
                                data-testid="kiro-open-steering-folder"
                                @click="openSteeringFolder"
                                ><FolderOpen :size="16" />
                                {{ isEn ? 'Open Steering Folder' : '打开 Steering 目录' }}</UiButton
                            >
                        </div>
                    </div></UiCollapse
                ></UiCard
            >

            <UiCard density="compact"
                ><template #header
                    ><UiButton
                        class="kiro-section-toggle"
                        variant="ghost"
                        :aria-expanded="expanded.commands"
                        data-testid="kiro-section-commands"
                        @click="toggleSection('commands')"
                    >
                        <span
                            ><Terminal :size="17" />
                            {{ isEn ? 'Command Config' : '命令配置' }}</span
                        ><ChevronUp v-if="expanded.commands" :size="17" /><ChevronDown
                            v-else
                            :size="17" /></UiButton></template
                ><UiCollapse :open="expanded.commands"
                    ><div class="kiro-section-body">
                        <div>
                            <h3>
                                <Shield :size="16" /> {{ isEn ? 'Trusted Commands' : '信任的命令' }}
                            </h3>
                            <p class="kam-muted">
                                {{
                                    isEn
                                        ? 'These commands auto-execute without confirmation.'
                                        : '这些命令将自动执行，无需确认。'
                                }}
                            </p>
                            <div class="kiro-list">
                                <div
                                    v-for="(command, index) in settings.trustedCommands"
                                    :key="index"
                                    class="kiro-list-row"
                                >
                                    <code class="kam-mono">{{ command }}</code
                                    ><UiButton
                                        icon
                                        size="sm"
                                        variant="danger"
                                        :aria-label="isEn ? 'Remove command' : '删除命令'"
                                        :data-testid="`kiro-remove-trusted-${index}`"
                                        @click="removeTrustedCommand(index)"
                                        ><Trash2 :size="15"
                                    /></UiButton>
                                </div>
                            </div>
                            <div class="kiro-entry">
                                <UiInput
                                    v-model="newTrustedCommand"
                                    :aria-label="isEn ? 'New trusted command' : '新信任命令'"
                                    :placeholder="isEn ? 'e.g. npm *' : '如：npm *'"
                                    data-testid="kiro-new-trusted-command"
                                    @keydown.enter="addTrustedCommand"
                                /><UiButton
                                    icon
                                    :aria-label="isEn ? 'Add trusted command' : '添加信任命令'"
                                    data-testid="kiro-add-trusted-command"
                                    @click="addTrustedCommand"
                                    ><Plus :size="16"
                                /></UiButton>
                            </div>
                        </div>
                        <div>
                            <h3><Zap :size="16" /> {{ isEn ? 'Trusted Tools' : '信任的工具' }}</h3>
                            <p class="kam-muted">
                                {{
                                    isEn
                                        ? 'Each tool name maps to whether it is trusted.'
                                        : '每个工具名称对应是否信任的布尔值。'
                                }}
                            </p>
                            <div class="kiro-list">
                                <div
                                    v-for="[name, trusted] in Object.entries(settings.trustedTools)"
                                    :key="name"
                                    class="kiro-list-row"
                                >
                                    <code class="kam-mono">{{ name }}</code
                                    ><UiSwitch
                                        :model-value="trusted"
                                        :aria-label="name"
                                        :data-testid="`kiro-trusted-tool-${name}`"
                                        @update:model-value="
                                            updateSetting('trustedTools', {
                                                ...settings.trustedTools,
                                                [name]: $event
                                            })
                                        "
                                    /><UiButton
                                        icon
                                        size="sm"
                                        variant="danger"
                                        :aria-label="isEn ? 'Remove tool' : '删除工具'"
                                        :data-testid="`kiro-remove-tool-${name}`"
                                        @click="removeTrustedTool(name)"
                                        ><Trash2 :size="15"
                                    /></UiButton>
                                </div>
                            </div>
                            <div class="kiro-entry">
                                <UiInput
                                    v-model="newTrustedToolName"
                                    :aria-label="isEn ? 'New trusted tool' : '新信任工具'"
                                    :placeholder="isEn ? 'Tool name' : '工具名称'"
                                    data-testid="kiro-new-trusted-tool"
                                    @keydown.enter="addTrustedTool"
                                /><UiButton
                                    icon
                                    :aria-label="isEn ? 'Add trusted tool' : '添加信任工具'"
                                    data-testid="kiro-add-trusted-tool"
                                    @click="addTrustedTool"
                                    ><Plus :size="16"
                                /></UiButton>
                            </div>
                        </div>
                        <div>
                            <h3>{{ isEn ? 'Blocked Commands' : '禁止的命令' }}</h3>
                            <p class="kam-muted">
                                {{
                                    isEn
                                        ? 'These commands always require manual confirmation.'
                                        : '这些命令总是需要手动确认。'
                                }}
                            </p>
                            <div class="kiro-list">
                                <div
                                    v-for="(command, index) in settings.commandDenylist"
                                    :key="index"
                                    class="kiro-list-row"
                                >
                                    <code class="kam-mono">{{ command }}</code
                                    ><UiButton
                                        icon
                                        size="sm"
                                        variant="danger"
                                        :aria-label="
                                            isEn ? 'Remove blocked command' : '删除禁止命令'
                                        "
                                        :data-testid="`kiro-remove-deny-${index}`"
                                        @click="removeDenyCommand(index)"
                                        ><Trash2 :size="15"
                                    /></UiButton>
                                </div>
                            </div>
                            <div class="kiro-entry">
                                <UiInput
                                    v-model="newDenyCommand"
                                    :aria-label="isEn ? 'New blocked command' : '新禁止命令'"
                                    :placeholder="isEn ? 'e.g. rm -rf *' : '如：rm -rf *'"
                                    data-testid="kiro-new-deny-command"
                                    @keydown.enter="addDenyCommand"
                                /><UiButton
                                    icon
                                    :aria-label="isEn ? 'Add blocked command' : '添加禁止命令'"
                                    data-testid="kiro-add-deny-command"
                                    @click="addDenyCommand"
                                    ><Plus :size="16"
                                /></UiButton>
                            </div>
                            <div class="kam-actions">
                                <UiButton
                                    data-testid="kiro-add-default-deny"
                                    @click="addDefaultDenyCommands"
                                    ><Plus :size="16" />
                                    {{
                                        isEn ? 'Add Default Blocked' : '添加默认禁止命令'
                                    }}</UiButton
                                >
                            </div>
                        </div>
                    </div></UiCollapse
                ></UiCard
            >
        </template>
        <SteeringEditor
            v-if="editingFile"
            :filename="editingFile"
            @close="editingFile = null"
            @saved="onEditorSaved"
        />
        <McpServerEditor
            v-if="editingMcp"
            :server-name="editingMcp.name"
            :server="editingMcp.server"
            @close="editingMcp = null"
            @saved="onEditorSaved"
        />
    </section>
</template>

<style scoped>
.kiro-heading,
.kiro-section-toggle > span,
.kiro-section-body h3 {
    display: flex;
    align-items: center;
    gap: 8px;
}
.kiro-section-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    text-align: left;
}
.kiro-section-body {
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.kiro-section-body h3 {
    margin: 0 0 6px;
    font-size: 14px;
}
.kiro-model-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
}
.kiro-model-row :deep(.ui-field) {
    flex: 1;
    min-width: 0;
}
.kiro-setting-row,
.kiro-list-row,
.kiro-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.kiro-setting-row {
    padding: 9px 0;
    border-top: 1px solid var(--line);
}
.kiro-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.kiro-list-row {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    min-width: 0;
}
.kiro-list-row > :first-child {
    min-width: 0;
    overflow-wrap: anywhere;
}
.kiro-entry {
    margin-top: 10px;
    justify-content: flex-start;
}
.kiro-entry :deep(.ui-input) {
    flex: 1;
    min-width: 0;
}
@media (max-width: 640px) {
    .kiro-list-row,
    .kiro-setting-row {
        flex-wrap: wrap;
    }
}
</style>
