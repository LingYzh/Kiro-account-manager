<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiDialog,
    UiInput,
    UiProgress,
    UiSelect,
    UiSwitch
} from '@lingyzh/ui'
import { useTranslation } from '../../composables/useTranslation'
import { useProxyService } from '../../composables/useProxyService'
import { useAccountsStore } from '../../stores/accounts'
import { isBannedError } from '@shared/lib/accountHelpers'
import ModelsDialog from './ModelsDialog.vue'
import ModelMappingDialog from './ModelMappingDialog.vue'
import ProxyLogsDialog from './ProxyLogsDialog.vue'
import ProxyDetailedLogsDialog from './ProxyDetailedLogsDialog.vue'
import ClientConfigDialog from './ClientConfigDialog.vue'
import ApiKeyManager from './ApiKeyManager.vue'
import ProxySecurityPanel from './ProxySecurityPanel.vue'

const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const text = (zh, en) => (isEn.value ? en : zh)
const accounts = useAccountsStore()
const isAccountBanned = (account) => isBannedError(account.lastError)
const service = useProxyService()
const {
    running,
    initialized,
    loading,
    config,
    stats,
    sessionStats,
    accountCount,
    availableCount,
    logs,
    error,
    operating,
    syncing,
    refreshingModels,
    uptime
} = service
const showKey = ref(false)
const keyFormat = ref('sk')
const copied = ref('')
const accountOpen = ref(false)
const accountSearch = ref('')
const modelsOpen = ref(false)
const mappingOpen = ref(false)
const logsOpen = ref(false)
const detailedOpen = ref(false)
const clientOpen = ref(false)
const keysOpen = ref(false)
let active = true
let copiedTimer
const address = computed(
    () =>
        `http://${config.value.host === '0.0.0.0' ? 'localhost' : config.value.host}:${config.value.port}`
)
const lanAddressHint = computed(
    () =>
        text('局域网设备请使用 http://<本机IP>:', 'LAN devices use http://<this-machine-IP>:') +
        config.value.port
)
const eligible = computed(() =>
    Array.from(accounts.accounts.values()).filter(
        (a) => a.status === 'active' && a.credentials?.accessToken
    )
)
const groups = computed(() =>
    [
        { id: '__ungrouped__', name: text('未分组', 'Ungrouped') },
        ...Array.from(accounts.groups.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    ].map((g) => ({
        ...g,
        count: eligible.value.filter((a) => (a.groupId || '__ungrouped__') === g.id).length
    }))
)
const selectedTotal = computed(() =>
    (config.value.multiAccountSelectionMode || 'all') === 'all'
        ? eligible.value.length
        : eligible.value.filter((a) =>
              (config.value.multiAccountGroupIds || []).includes(a.groupId || '__ungrouped__')
          ).length
)
const choices = computed(() => {
    const query = accountSearch.value.trim().toLowerCase()
    return Array.from(accounts.accounts.values()).filter(
        (a) =>
            !query ||
            [a.email, a.id, a.subscription?.title].some((v) => v?.toLowerCase().includes(query))
    )
})
const chosen = computed(() => accounts.accounts.get(config.value.selectedAccountId))
const toggles = computed(() => [
    ['autoStart', text('随软件启动', 'Auto start'), false],
    ['enableMultiAccount', text('多账号轮询', 'Multi-account'), true],
    ['logRequests', text('记录日志', 'Log requests'), false],
    ['logStreamEvents', text('流式日志', 'Stream events'), false]
])
const numbers = computed(() => [
    {
        key: 'maxRetries',
        label: text('最大重试次数', 'Max retries'),
        fallback: 3,
        min: 0,
        max: 10,
        step: 1
    },
    {
        key: 'payloadSizeLimitKB',
        label: 'Payload (KB)',
        fallback: 153600,
        min: 256,
        max: 204800,
        step: 1024
    }
])
const endpoints = computed(() => [
    { value: '', label: text('自动选择', 'Auto select') },
    { value: 'codewhisperer', label: 'CodeWhisperer' },
    { value: 'amazonq', label: 'AmazonQ' },
    { value: 'amazonq-cli', label: 'AmazonQ CLI' }
])
const firstStats = computed(() => [
    [text('账号池', 'Pool'), `${availableCount.value}/${accountCount.value}`],
    [text('总请求', 'Total requests'), stats.value?.totalRequests || 0],
    [
        text('总计成功 / 失败', 'Total success / failure'),
        `${stats.value?.successRequests || 0} / ${stats.value?.failedRequests || 0}`
    ],
    [text('本次请求', 'Session requests'), sessionStats.value?.totalRequests || 0],
    [
        text('本次成功 / 失败', 'Session success / failure'),
        `${sessionStats.value?.successRequests || 0} / ${sessionStats.value?.failedRequests || 0}`
    ],
    [
        text('运行时间', 'Uptime'),
        `${Math.floor(uptime.value / 3600)}h ${Math.floor((uptime.value % 3600) / 60)}m ${uptime.value % 60}s`
    ]
])
function compact(value) {
    const n = value || 0
    return n >= 1e6
        ? `${(n / 1e6).toFixed(1)}M`
        : n >= 1000
          ? `${(n / 1000).toFixed(1)}K`
          : String(n)
}
const tokenStats = computed(() => {
    const s = stats.value || {}
    const cache = (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0)
    return [
        ['Total Tokens', compact((s.inputTokens || 0) + (s.outputTokens || 0))],
        [
            text('输入 / 输出', 'Input / output'),
            `${compact(s.inputTokens)} / ${compact(s.outputTokens)}`
        ],
        [
            text('缓存读取 / 写入', 'Cache read / write'),
            `${compact(s.cacheReadTokens)} / ${compact(s.cacheWriteTokens)}${cache ? ` (${(((s.cacheReadTokens || 0) / cache) * 100).toFixed(0)}%)` : ''}`
        ],
        [text('推理 Tokens', 'Reasoning'), compact(s.reasoningTokens)],
        [
            text('成功率', 'Success rate'),
            s.totalRequests > 0
                ? `${((s.successRequests / s.totalRequests) * 100).toFixed(1)}%`
                : '-'
        ],
        ['Credits', (s.totalCredits || 0).toFixed(4)]
    ]
})
const routes = [
    ['POST', '/v1/chat/completions', 'OpenAI'],
    ['POST', '/v1/responses', 'OpenAI Responses'],
    ['POST', '/v1/messages', 'Claude'],
    ['POST', '/anthropic/v1/messages', 'Claude Code'],
    ['POST', '/v1/messages/count_tokens', 'Token count'],
    ['GET', '/v1/models', 'Models'],
    ['POST', '/v1beta/models/*:generateContent', 'Gemini'],
    ['GET', '/v1beta/models', 'Gemini models'],
    ['GET', '/health', 'Health'],
    ['GET', '/admin/stats', 'Admin · API Key'],
    ['GET', '/admin/accounts', 'Admin · API Key'],
    ['GET', '/admin/logs', 'Admin · API Key']
]
function change(key, value) {
    return service.updateConfig({ [key]: value })
}
function numberChange(field, value) {
    void change(field.key, parseInt(String(value)) || field.fallback)
}
async function copy(value, kind) {
    try {
        await navigator.clipboard.writeText(value)
        if (!active) return
        copied.value = kind
        clearTimeout(copiedTimer)
        copiedTimer = setTimeout(() => {
            copied.value = ''
        }, 2000)
    } catch (cause) {
        if (active) error.value = String(cause)
    }
}
function generateKey() {
    if (running.value) return
    const random = (n) =>
        Array.from(
            { length: n },
            () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]
        ).join('')
    void change(
        'apiKey',
        keyFormat.value === 'simple'
            ? `PROXY_KEY_${random(32).toUpperCase()}`
            : keyFormat.value === 'token'
              ? `PROXY_KEY:${random(32)}`
              : `sk-${random(48)}`
    )
    showKey.value = true
}
async function scopeChange(mode, groupIds = config.value.multiAccountGroupIds || []) {
    try {
        await service.updateConfig({
            multiAccountSelectionMode: mode,
            multiAccountGroupIds: groupIds
        })
        if (active) await service.syncAccounts({ mode, groupIds })
    } catch (cause) {
        if (active) error.value = String(cause)
    }
}
function toggleGroup(id) {
    const next = new Set(config.value.multiAccountGroupIds || [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    void scopeChange('groups', Array.from(next))
}
async function selectAccount(id) {
    try {
        await service.updateConfig({ selectedAccountId: id, selectedAccountIds: id ? [id] : [] })
        if (active) accountOpen.value = false
    } catch (cause) {
        if (active) error.value = String(cause)
    }
}
function sync() {
    void service.syncAccounts().catch(() => undefined)
}
async function openMappings() {
    try {
        await service.loadModels()
    } catch (cause) {
        if (active) error.value = String(cause)
        return
    }
    if (!active) return
    modelsOpen.value = false
    mappingOpen.value = true
}
function mappingEnabledChange(enabled) {
    return change('claudeModelIdMappingEnabled', enabled)
}
function mappingsChange(mappings) {
    return change('modelMappings', mappings)
}
function resetCredits() {
    return service.reset('credits')
}
function resetTokens() {
    return service.reset('tokens')
}
function resetRequests() {
    void service.reset('requests').catch((cause) => {
        if (active) error.value = String(cause)
    })
}
onBeforeUnmount(() => {
    active = false
    clearTimeout(copiedTimer)
})
</script>

<template>
    <div class="proxy-panel" data-testid="proxy-panel">
        <UiAlert v-if="error" tone="error" :title="error" data-testid="proxy-error" />
        <UiCard>
            <template #header
                ><div class="kam-page-header">
                    <h2 class="ui-card-title">{{ text('API 反代服务', 'API proxy service') }}</h2>
                    <UiBadge :tone="running ? 'success' : 'neutral'">{{
                        running ? text('运行中', 'Running') : text('已停止', 'Stopped')
                    }}</UiBadge>
                </div></template
            >
            <div class="kam-actions">
                <UiButton
                    :disabled="!initialized || operating || loading"
                    :loading="operating"
                    data-testid="proxy-toggle"
                    @click="service.operate(running ? 'stop' : 'start')"
                    >{{
                        running ? text('停止服务', 'Stop server') : text('启动服务', 'Start server')
                    }}</UiButton
                >
                <UiButton
                    variant="secondary"
                    :loading="syncing"
                    :disabled="syncing || !initialized"
                    @click="sync"
                    >{{ text('同步账号', 'Sync accounts') }}</UiButton
                >
                <UiButton
                    variant="secondary"
                    :loading="refreshingModels"
                    :disabled="refreshingModels"
                    @click="service.refreshModels"
                    >{{ text('刷新模型', 'Refresh models') }}</UiButton
                >
                <UiButton variant="secondary" @click="modelsOpen = true">{{
                    text('模型列表', 'Models')
                }}</UiButton>
                <UiButton variant="secondary" @click="clientOpen = true">{{
                    text('客户端配置', 'Client configuration')
                }}</UiButton>
                <UiButton
                    v-if="!initialized && !loading"
                    variant="secondary"
                    @click="service.initialize"
                    >{{ text('重试加载', 'Retry loading') }}</UiButton
                >
            </div>
            <div v-if="running" class="proxy-address">
                <code>{{ address }}</code
                ><UiButton variant="secondary" dense @click="copy(address, 'address')">{{
                    copied === 'address'
                        ? text('已复制', 'Copied')
                        : text('复制地址', 'Copy address')
                }}</UiButton>
            </div>
            <p v-if="running && config.host === '0.0.0.0'" class="kam-muted">
                {{ lanAddressHint }}
            </p>
            <div class="proxy-fields">
                <label
                    >{{ text('端口', 'Port')
                    }}<UiInput
                        :model-value="config.port"
                        type="number"
                        :disabled="running"
                        data-testid="proxy-port"
                        @update:model-value="change('port', parseInt(String($event)) || 5580)"
                /></label>
                <label
                    >{{ text('监听地址', 'Host')
                    }}<UiInput
                        :model-value="config.host"
                        :disabled="running"
                        @update:model-value="change('host', $event)"
                /></label>
                <label class="proxy-toggle"
                    ><UiSwitch
                        :model-value="config.host === '0.0.0.0'"
                        :disabled="operating || !initialized"
                        @update:model-value="service.operate('public', $event)"
                    />{{ text('外网访问', 'Public access') }}</label
                >
                <div class="proxy-key">
                    <label
                        >API Key<UiInput
                            :model-value="config.apiKey || ''"
                            :type="showKey ? 'text' : 'password'"
                            :disabled="running"
                            :placeholder="
                                text('留空则不验证', 'Leave empty to skip authentication')
                            "
                            @update:model-value="change('apiKey', $event || undefined)"
                    /></label>
                    <div class="kam-actions">
                        <UiSelect
                            v-model="keyFormat"
                            :items="[
                                { value: 'sk', label: 'sk-xxx' },
                                { value: 'simple', label: 'PROXY_KEY' },
                                { value: 'token', label: 'KEY:TOKEN' }
                            ]"
                        /><UiButton
                            variant="secondary"
                            dense
                            :disabled="running"
                            @click="generateKey"
                            >{{ text('随机生成', 'Generate') }}</UiButton
                        ><UiButton variant="ghost" dense @click="showKey = !showKey">{{
                            showKey ? text('隐藏', 'Hide') : text('显示', 'Show')
                        }}</UiButton
                        ><UiButton
                            v-if="config.apiKey"
                            variant="ghost"
                            dense
                            @click="copy(config.apiKey, 'key')"
                            >{{
                                copied === 'key' ? text('已复制', 'Copied') : text('复制', 'Copy')
                            }}</UiButton
                        ><UiButton variant="ghost" dense @click="keysOpen = true">{{
                            text('管理多个 Key', 'Manage keys')
                        }}</UiButton>
                    </div>
                </div>
            </div>
            <div class="proxy-fields">
                <label v-for="[key, label, lock] in toggles" :key="key" class="proxy-toggle"
                    ><UiSwitch
                        :model-value="!!config[key]"
                        :disabled="lock && running"
                        @update:model-value="change(key, $event)"
                    />{{ label }}</label
                >
                <template v-if="config.enableMultiAccount">
                    <label
                        >{{ text('选择策略', 'Strategy')
                        }}<UiSelect
                            :model-value="config.accountSelectionStrategy || 'round-robin'"
                            :disabled="running"
                            :items="[
                                { value: 'round-robin', label: text('轮询', 'Round-robin') },
                                { value: 'sticky', label: text('粘滞', 'Sticky') }
                            ]"
                            @update:model-value="change('accountSelectionStrategy', $event)"
                    /></label>
                    <label
                        >{{ text('轮询范围', 'Scope')
                        }}<UiSelect
                            :model-value="config.multiAccountSelectionMode || 'all'"
                            :disabled="running"
                            :items="[
                                { value: 'all', label: text('全部账号', 'All accounts') },
                                { value: 'groups', label: text('指定分组', 'Specific groups') }
                            ]"
                            @update:model-value="scopeChange($event)"
                    /></label>
                    <div class="proxy-wide">
                        <p class="kam-muted">
                            {{ selectedTotal }} {{ text('个活跃账号', 'active accounts') }}
                        </p>
                        <div
                            v-if="config.multiAccountSelectionMode === 'groups'"
                            class="kam-actions"
                        >
                            <UiButton
                                v-for="group in groups"
                                :key="group.id"
                                dense
                                :variant="
                                    (config.multiAccountGroupIds || []).includes(group.id)
                                        ? 'primary'
                                        : 'secondary'
                                "
                                :disabled="running"
                                @click="toggleGroup(group.id)"
                                >{{ group.name }} ({{ group.count }})</UiButton
                            >
                        </div>
                    </div>
                </template>
                <template v-else
                    ><UiButton
                        variant="secondary"
                        :disabled="running"
                        @click="accountOpen = true"
                        >{{
                            chosen?.email || text('第一个可用账号', 'First available account')
                        }}</UiButton
                    ><label class="proxy-toggle"
                        ><UiSwitch
                            :model-value="!!config.autoSwitchOnQuotaExhausted"
                            :disabled="running"
                            @update:model-value="change('autoSwitchOnQuotaExhausted', $event)"
                        />{{ text('额度耗尽自动切换', 'Switch on quota exhausted') }}</label
                    ></template
                >
            </div>
            <h3>{{ text('高级配置', 'Advanced settings') }}</h3>
            <div class="proxy-fields">
                <label
                    >{{ text('首选端点', 'Preferred endpoint')
                    }}<UiSelect
                        :model-value="config.preferredEndpoint || ''"
                        :items="endpoints"
                        @update:model-value="change('preferredEndpoint', $event || undefined)"
                /></label>
                <label v-for="field in numbers" :key="field.key"
                    >{{ field.label
                    }}<UiInput
                        :model-value="config[field.key] || field.fallback"
                        type="number"
                        :min="field.min"
                        :max="field.max"
                        :step="field.step"
                        :disabled="running"
                        @update:model-value="numberChange(field, $event)"
                /></label>
                <label class="proxy-toggle"
                    ><UiSwitch
                        :model-value="config.clientDrivenToolExecution !== false"
                        :disabled="running"
                        @update:model-value="change('clientDrivenToolExecution', $event)"
                    />{{ text('客户端驱动工具执行', 'Client-driven tool execution') }}</label
                >
                <label class="proxy-toggle"
                    ><UiSwitch
                        :model-value="!!config.disableTools"
                        :disabled="running"
                        @update:model-value="change('disableTools', $event)"
                    />{{ text('禁用工具调用', 'Disable tools') }}</label
                >
                <label class="proxy-toggle"
                    ><UiSwitch
                        :model-value="!!config.enableTokenBufferReserve"
                        :disabled="running"
                        @update:model-value="change('enableTokenBufferReserve', $event)"
                    />{{ text('启用代理裁剪', 'Enable proxy trimming') }}</label
                >
                <label
                    >{{ text('预留 token', 'Reserved tokens')
                    }}<UiInput
                        :model-value="config.tokenBufferReserve || 20000"
                        type="number"
                        :min="5000"
                        :max="150000"
                        :step="1000"
                        :disabled="running || !config.enableTokenBufferReserve"
                        @update:model-value="
                            change('tokenBufferReserve', parseInt(String($event)) || 20000)
                        "
                /></label>
                <label
                    >Agent {{ text('模式', 'mode')
                    }}<UiSelect
                        :model-value="config.agentMode || 'vibe'"
                        :items="[
                            { value: 'vibe', label: 'Vibe' },
                            { value: 'spec', label: 'Spec' }
                        ]"
                        @update:model-value="change('agentMode', $event)"
                /></label>
                <label
                    >{{ text('工作区路径 (Steering)', 'Workspace path (Steering)')
                    }}<UiInput
                        :model-value="config.workspacePath || ''"
                        @update:model-value="config.workspacePath = $event || undefined"
                        @blur="change('workspacePath', config.workspacePath || undefined)"
                /></label>
            </div>
            <p class="kam-muted">
                {{
                    text(
                        '代理裁剪默认关闭，保留历史和工具结果。开启后可能删除旧轮次并截短旧工具结果；含中途 system 消息的请求始终保留。Payload 为 UTF-8 字节上限，超限返回错误。',
                        'Proxy trimming is off by default to preserve history and tool results. Enabling it may remove older turns and shorten tool results; requests with mid-conversation system messages are preserved. Payload limits apply to UTF-8 bytes; oversized requests return an error.'
                    )
                }}
            </p>
        </UiCard>
        <ProxySecurityPanel
            :config="config"
            :running="running"
            :is-en="isEn"
            :on-update-config="service.updateConfig"
        />
        <div v-if="running" class="proxy-stats">
            <UiCard v-for="[label, value] in firstStats" :key="label" density="compact"
                ><p class="kam-muted">{{ label }}</p>
                <strong>{{ value }}</strong
                ><UiButton
                    v-if="label === text('总请求', 'Total requests')"
                    variant="ghost"
                    dense
                    @click="resetRequests"
                    >{{ text('重置', 'Reset') }}</UiButton
                ></UiCard
            >
        </div>
        <div v-if="running && stats" class="proxy-stats">
            <UiCard v-for="[label, value] in tokenStats" :key="label" density="compact"
                ><p class="kam-muted">{{ label }}</p>
                <strong>{{ value }}</strong></UiCard
            >
        </div>
        <UiCard :title="text('API 端点', 'API endpoints')"
            ><div v-for="[method, path, label] in routes" :key="path" class="proxy-route">
                <UiBadge>{{ method }}</UiBadge
                ><code>{{ path }}</code
                ><span class="kam-muted">{{ label }}</span>
            </div></UiCard
        >
        <UiCard v-if="logs.length" :title="text('最近请求', 'Recent requests')"
            ><div class="kam-actions">
                <UiBadge>{{ logs.length }}</UiBadge
                ><UiButton variant="secondary" dense @click="logsOpen = true">{{
                    text('查看全部', 'View all')
                }}</UiButton
                ><UiButton variant="secondary" dense @click="detailedOpen = true">{{
                    text('详细日志', 'Detailed logs')
                }}</UiButton>
            </div>
            <div class="proxy-log-list">
                <div v-for="(log, index) in logs.slice(0, 5)" :key="index" class="proxy-log">
                    <time>{{ log.time }}</time
                    ><code :title="log.path">{{ log.path }}</code
                    ><span :title="log.model">{{
                        log.model?.replace('anthropic.', '').replace('-v1:0', '') || '-'
                    }}</span
                    ><UiBadge :tone="log.status >= 400 ? 'error' : 'success'">{{
                        log.status
                    }}</UiBadge
                    ><span
                        >{{ log.inputTokens?.toLocaleString() || '-' }} /
                        {{ log.outputTokens?.toLocaleString() || '-' }}</span
                    ><span>{{ log.cacheReadTokens?.toLocaleString() || '-' }}</span
                    ><span>{{ log.credits ? log.credits.toFixed(4) : '-' }}</span
                    ><span>{{
                        log.responseTime ? `${(log.responseTime / 1000).toFixed(1)}s` : '-'
                    }}</span>
                </div>
            </div></UiCard
        >
        <UiCard :title="text('支持的功能', 'Supported features')"
            ><p>
                {{
                    text(
                        'Token 自动刷新 · 请求重试 · 多账号轮询 · IDC/Social 认证 · Agentic 模式检测 · Thinking 模式 · 图像处理 · 使用量统计',
                        'Token refresh · Request retry · Multi-account rotation · IDC/Social authentication · Agentic mode detection · Thinking · Image processing · Usage statistics'
                    )
                }}
            </p></UiCard
        >
        <UiDialog
            v-model:open="accountOpen"
            :aria-label="text('选择账号', 'Select account')"
            scrollable
            size="lg"
            ><template #header
                ><h2 class="ui-card-title">{{ text('选择账号', 'Select account') }}</h2></template
            ><template #footer
                ><UiButton variant="secondary" @click="accountOpen = false">{{
                    text('关闭', 'Close')
                }}</UiButton></template
            >
            <div class="kam-dialog-content">
                <UiInput
                    v-model="accountSearch"
                    :placeholder="text('搜索邮箱、ID 或订阅', 'Search email, ID or subscription')"
                /><UiButton variant="secondary" @click="selectAccount(undefined)">{{
                    text('第一个可用账号', 'First available account')
                }}</UiButton
                ><UiCard v-for="account in choices" :key="account.id" density="compact"
                    ><div class="kam-page-header">
                        <div>
                            <strong>{{ account.email || account.id }}</strong>
                            <p class="kam-muted">
                                {{ account.subscription?.title || '-' }} · {{ account.idp }}
                            </p>
                            <UiBadge
                                v-if="isAccountBanned(account) || account.status !== 'active'"
                                tone="error"
                                >{{
                                    isAccountBanned(account)
                                        ? text('已封禁', 'Banned')
                                        : account.status
                                }}</UiBadge
                            >
                        </div>
                        <UiButton
                            :variant="
                                config.selectedAccountId === account.id ? 'primary' : 'secondary'
                            "
                            dense
                            @click="selectAccount(account.id)"
                            >{{ text('选择', 'Select') }}</UiButton
                        >
                    </div>
                    <UiProgress
                        :value="
                            account.usage.limit > 0
                                ? Math.min(100, (account.usage.current / account.usage.limit) * 100)
                                : account.usage.percentUsed || 0
                        "
                    />
                    <p class="kam-muted">
                        {{ account.usage.current.toFixed(1) }} / {{ account.usage.limit }}
                    </p></UiCard
                >
            </div></UiDialog
        >
        <ModelsDialog
            v-model:open="modelsOpen"
            :is-en="isEn"
            :mapping-enabled="config.claudeModelIdMappingEnabled !== false"
            :mapping-count="config.modelMappings?.length || 0"
            :on-mapping-enabled-change="mappingEnabledChange"
            @open-model-mapping="openMappings"
        />
        <ModelMappingDialog
            v-model:open="mappingOpen"
            :is-en="isEn"
            :mappings="config.modelMappings || []"
            :available-models="service.models.value"
            :api-keys="(config.apiKeys || []).map((k) => ({ id: k.id, name: k.name }))"
            :on-mappings-change="mappingsChange"
        />
        <ProxyLogsDialog
            v-model:open="logsOpen"
            :is-en="isEn"
            :logs="logs"
            :total-credits="stats?.totalCredits || 0"
            :total-tokens="(stats?.inputTokens || 0) + (stats?.outputTokens || 0)"
            :on-clear="service.clearLogs"
            :on-reset-credits="resetCredits"
            :on-reset-tokens="resetTokens"
        />
        <ProxyDetailedLogsDialog v-model:open="detailedOpen" />
        <ClientConfigDialog v-model:open="clientOpen" :is-en="isEn" />
        <ApiKeyManager v-model:open="keysOpen" :is-en="isEn" />
    </div>
</template>

<style scoped>
.proxy-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
}
.proxy-panel :deep(.ui-card-content) {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.proxy-fields {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
}
.proxy-fields label {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.proxy-fields .proxy-toggle {
    flex-direction: row;
    align-items: center;
}
.proxy-key,
.proxy-wide {
    grid-column: 1 / -1;
}
.proxy-key {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.proxy-address {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.proxy-stats {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 12px;
}
.proxy-stats strong {
    font-size: 20px;
    overflow-wrap: anywhere;
}
.proxy-route {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
}
.proxy-route code {
    flex: 1;
    overflow-wrap: anywhere;
}
.proxy-log-list {
    overflow: auto;
    max-height: 180px;
}
.proxy-log {
    min-width: 850px;
    display: grid;
    grid-template-columns: 180px 1fr 1fr 50px 100px 70px 70px 50px;
    gap: 8px;
    font-size: 12px;
    align-items: center;
    padding: 6px 0;
}
.proxy-log code,
.proxy-log span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
@media (max-width: 1050px) {
    .proxy-stats {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
@media (max-width: 760px) {
    .proxy-fields {
        grid-template-columns: 1fr;
    }
    .proxy-stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
