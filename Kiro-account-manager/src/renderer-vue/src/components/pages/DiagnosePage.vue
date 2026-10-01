<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiCheckbox,
    UiField,
    UiInput,
    UiProgress,
    UiSelect,
    UiTable,
    confirmDialog,
    snackbar
} from '@lingyzh/ui'
import { Download, Flag, Play, RefreshCw, RotateCcw, Square, Trash2 } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { useAccountsStore } from '../../stores/accounts'
import { useProxyPoolStore } from '../../stores/proxyPool'
import { toIpcData } from '../../lib/ipcData'

const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const accountsStore = useAccountsStore()
const proxyStore = useProxyPoolStore()
const pick = (value) => value[actualLanguage.value]

const DEFAULT_TARGETS = [
    {
        id: 'public-ip',
        label: { en: 'Public connectivity', zh: '公网连通性' },
        url: 'https://api.ipify.org?format=json',
        category: 'network',
        description: { en: 'Check basic internet access', zh: '检测能否访问互联网（基础连通性）' }
    },
    {
        id: 'cloudflare',
        label: { en: 'Cloudflare', zh: 'Cloudflare' },
        url: 'https://1.1.1.1',
        category: 'network',
        description: { en: 'Check international network reachability', zh: '检测国际网络是否通畅' }
    },
    {
        id: 'kiro-auth',
        label: { en: 'Kiro Auth Endpoint', zh: 'Kiro Auth Endpoint' },
        url: 'https://prod.us-east-1.auth.desktop.kiro.dev/.well-known/openid-configuration',
        category: 'kiro',
        description: { en: 'Social login token refresh endpoint', zh: '社交登录 Token 刷新端点' },
        expectStatus: [200, 401, 403, 404]
    },
    {
        id: 'kiro-oidc',
        label: { en: 'AWS OIDC', zh: 'AWS OIDC' },
        url: 'https://oidc.us-east-1.amazonaws.com/',
        category: 'kiro',
        description: { en: 'OIDC registration endpoint', zh: 'OIDC 注册端点' },
        expectStatus: [200, 400, 403, 405]
    },
    {
        id: 'kiro-codewhisperer',
        label: { en: 'CodeWhisperer API', zh: 'CodeWhisperer API' },
        url: 'https://q.us-east-1.amazonaws.com/',
        category: 'kiro',
        description: {
            en: 'Kiro main API endpoint (q.amazonaws.com)',
            zh: 'Kiro 主 API 端点（q.amazonaws.com）'
        },
        expectStatus: [200, 400, 403, 405]
    },
    {
        id: 'aws-signin',
        label: { en: 'AWS SignIn', zh: 'AWS SignIn' },
        url: 'https://us-east-1.signin.aws/',
        category: 'kiro',
        description: { en: 'Required endpoint for the signup flow', zh: '注册流程必经端点' },
        expectStatus: [200, 400, 403]
    },
    {
        id: 'tempmail-plus',
        label: { en: 'TempMail.Plus API', zh: 'TempMail.Plus API' },
        url: 'https://tempmail.plus/api/mails?email=test@mailto.plus',
        category: 'email',
        description: { en: 'TempMail.Plus mailbox service', zh: 'TempMail.Plus 邮箱服务' },
        expectStatus: [200, 400, 401, 403]
    },
    {
        id: 'outlook-login',
        label: { en: 'Outlook Login', zh: 'Outlook Login' },
        url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
        category: 'email',
        description: { en: 'Outlook token refresh endpoint', zh: 'Outlook Token 刷新端点' },
        expectStatus: [200, 400, 405]
    }
]
const CATEGORIES = [
    { id: 'network', label: { en: 'Network', zh: '网络' } },
    { id: 'kiro', label: { en: 'Kiro / AWS', zh: 'Kiro / AWS' } },
    { id: 'email', label: { en: 'Email', zh: '邮箱服务' } },
    { id: 'custom', label: { en: 'Custom', zh: '自定义' } }
]
const LIVENESS_MODELS = [
    'claude-sonnet-4.5',
    'claude-sonnet-4',
    'claude-haiku-4.5',
    'claude-opus-4.5',
    'claude-3.7-sonnet',
    'auto'
]
const slotEmail = 'item.email'
const slotResult = 'item.result'
const slotLatency = 'item.latency'
const slotAction = 'item.action'
const slotTarget = 'item.target'
const slotStatus = 'item.status'
const slotHttp = 'item.http'

function readProbeUrl() {
    try {
        const saved = localStorage.getItem('kiro-diagnose-probe-url')
        if (saved !== null) return saved
        const legacy = localStorage.getItem('kiro-diagnose-moemail') || ''
        if (legacy) {
            try {
                localStorage.setItem('kiro-diagnose-probe-url', legacy)
                localStorage.removeItem('kiro-diagnose-moemail')
            } catch {
                /* Keep the legacy value in memory. */
            }
        }
        return legacy
    } catch {
        return ''
    }
}

function readCachedModels() {
    try {
        const saved = JSON.parse(localStorage.getItem('kiro-liveness-models-cache') || '[]')
        return Array.isArray(saved) ? saved.filter((model) => typeof model === 'string') : []
    } catch {
        return []
    }
}

function readLivenessModel() {
    try {
        return localStorage.getItem('kiro-liveness-model') || LIVENESS_MODELS[0]
    } catch {
        return LIVENESS_MODELS[0]
    }
}

const customProbeUrl = ref(readProbeUrl())
const useProxy = ref(false)
const selectedProxyId = ref('')
const isRunning = ref(false)
const results = ref({})
const progress = ref({ done: 0, total: 0 })
const diagnoseError = ref('')
const availableProxies = computed(() =>
    [...proxyStore.proxyPool.values()].filter((proxy) => proxy.enabled && proxy.status !== 'dead')
)
const targets = computed(() => {
    const list = [...DEFAULT_TARGETS]
    const trimmed = customProbeUrl.value.trim()
    if (trimmed) {
        list.push({
            id: 'custom-probe',
            label: { en: 'Custom Probe URL', zh: '自定义探测 URL' },
            url: /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
            category: 'custom',
            description: {
                en: 'User-provided URL for connectivity test',
                zh: '用户填写的 URL 连通性测试'
            },
            expectStatus: [200, 201, 204, 301, 302, 400, 401, 403, 404, 405]
        })
    }
    return list
})
const targetGroups = computed(() =>
    CATEGORIES.map((category) => ({
        ...category,
        items: targets.value.filter((target) => target.category === category.id)
    })).filter((group) => group.items.length)
)
const stats = computed(() => {
    const values = Object.values(results.value)
    return {
        total: values.length,
        passed: values.filter((result) => result.success).length,
        failed: values.filter((result) => !result.success).length
    }
})
const targetHeaders = computed(() => [
    { key: 'target', title: isEn.value ? 'Target' : '目标' },
    { key: 'status', title: isEn.value ? 'Status' : '状态', width: '100px' },
    { key: 'http', title: 'HTTP', width: '80px' },
    { key: 'latency', title: isEn.value ? 'Latency' : '延迟', width: '90px' }
])
function targetRows(items) {
    return items.map((target) => ({
        ...target,
        target: pick(target.label),
        result: results.value[target.id]
    }))
}

let active = true
let diagnoseGeneration = 0
let livenessGeneration = 0
let modelsGeneration = 0

async function runDiagnose() {
    if (isRunning.value) return
    const generation = ++diagnoseGeneration
    const snapshot = targets.value.map((target) => ({ ...target, label: pick(target.label) }))
    const proxyUrl =
        useProxy.value && selectedProxyId.value
            ? proxyStore.proxyPool.get(selectedProxyId.value)?.url
            : undefined
    const probeValue = customProbeUrl.value
    isRunning.value = true
    diagnoseError.value = ''
    results.value = {}
    progress.value = { done: 0, total: snapshot.length }
    const next = {}
    try {
        for (let index = 0; index < snapshot.length; index += 4) {
            if (!active || generation !== diagnoseGeneration) break
            const slice = snapshot.slice(index, index + 4)
            const response = await window.api.diagnoseRun(
                toIpcData({
                    proxyUrl,
                    targets: slice.map((target) => ({
                        id: target.id,
                        label: target.label,
                        url: target.url,
                        expectStatus: target.expectStatus
                    }))
                })
            )
            if (!active || generation !== diagnoseGeneration) break
            for (const result of response.results) next[result.id] = result
            results.value = { ...next }
            progress.value = { done: Math.min(index + 4, snapshot.length), total: snapshot.length }
        }
    } catch (error) {
        if (active && generation === diagnoseGeneration)
            diagnoseError.value = error instanceof Error ? error.message : String(error)
    } finally {
        if (active && generation === diagnoseGeneration) {
            isRunning.value = false
            try {
                localStorage.setItem('kiro-diagnose-probe-url', probeValue)
            } catch {
                /* Ignore unavailable storage. */
            }
        }
    }
}

async function exportReport() {
    const lines = [
        isEn.value ? 'Kiro Account Manager - Diagnostic Report' : 'Kiro Account Manager - 诊断报告',
        `${isEn.value ? 'Generated' : '生成时间'}: ${new Date().toLocaleString()}`,
        `${isEn.value ? 'Proxy' : '代理'}: ${useProxy.value && selectedProxyId.value ? proxyStore.proxyPool.get(selectedProxyId.value)?.url : isEn.value ? 'Direct' : '直连'}`,
        '------------------------------------'
    ]
    for (const target of targets.value) {
        const result = results.value[target.id]
        lines.push(`[${pick(target.label)}]`)
        lines.push(`  URL: ${target.url}`)
        if (!result) {
            lines.push(
                `  ${isEn.value ? 'Status' : '状态'}: ${isEn.value ? 'Not tested' : '未测试'}`
            )
        } else {
            lines.push(
                `  ${isEn.value ? 'Status' : '状态'}: ${result.success ? (isEn.value ? '✓ Pass' : '✓ 通过') : isEn.value ? '✗ Fail' : '✗ 失败'}`
            )
            if (result.httpStatus) lines.push(`  HTTP: ${result.httpStatus}`)
            if (result.latencyMs != null)
                lines.push(`  ${isEn.value ? 'Latency' : '延迟'}: ${result.latencyMs}ms`)
            if (result.error) lines.push(`  ${isEn.value ? 'Error' : '错误'}: ${result.error}`)
        }
        lines.push('')
    }
    try {
        await navigator.clipboard.writeText(lines.join('\n'))
        snackbar.show(isEn.value ? 'Report copied to clipboard' : '诊断报告已复制到剪贴板', {
            tone: 'success'
        })
    } catch {
        snackbar.show(isEn.value ? 'Could not copy report' : '复制诊断报告失败', { tone: 'error' })
    }
}

const accountList = computed(() => [...accountsStore.accounts.values()])
const selectedAccounts = computed(() =>
    [...accountsStore.selectedIds].map((id) => accountsStore.accounts.get(id)).filter(Boolean)
)
const livenessMode = ref(accountsStore.selectedIds.size ? 'selected' : 'single')
const livenessAccountId = ref('')
const livenessModel = ref(readLivenessModel())
const livenessMessage = ref('Hi, reply with "pong" only.')
const livenessRunning = ref(false)
const livenessResult = ref(null)
const livenessBatch = ref(new Map())
const cachedModels = ref(readCachedModels())
const modelsLoading = ref(false)
const modelOptions = computed(() => [...new Set([...cachedModels.value, ...LIVENESS_MODELS])])
const failedAccountIds = computed(() =>
    selectedAccounts.value
        .filter((account) => {
            const result = livenessBatch.value.get(account.id)
            return result && !result.success
        })
        .map((account) => account.id)
)
const batchStats = computed(() => {
    const stats = { done: 0, ok: 0, fail: 0, total: livenessBatch.value.size }
    for (const result of livenessBatch.value.values()) {
        if (result === null) continue
        stats.done++
        if (result.success) stats.ok++
        else stats.fail++
    }
    return stats
})
const batchRows = computed(() =>
    selectedAccounts.value
        .filter((account) => livenessBatch.value.has(account.id))
        .map((account) => ({
            id: account.id,
            email: account.email,
            result: livenessBatch.value.get(account.id),
            boundProxy: Boolean(proxyStore.getAccountProxyUrl(account.id))
        }))
)
const batchHeaders = computed(() => [
    { key: 'email', title: isEn.value ? 'Account' : '账号' },
    { key: 'result', title: isEn.value ? 'Result' : '结果' },
    { key: 'latency', title: isEn.value ? 'Latency' : '延迟', width: '95px' },
    { key: 'action', title: isEn.value ? 'Action' : '操作', width: '80px' }
])

watch(
    livenessModel,
    (model) => {
        try {
            localStorage.setItem('kiro-liveness-model', model)
        } catch {
            /* Ignore unavailable storage. */
        }
    },
    { immediate: true }
)

async function loadModels() {
    if (modelsLoading.value) return
    const generation = ++modelsGeneration
    modelsLoading.value = true
    try {
        let models = []
        try {
            const response = await window.api.proxyGetModels()
            if (response.success && response.models?.length)
                models = response.models.map((model) => model.id)
        } catch {
            /* The proxy may be stopped. */
        }
        if (!active || generation !== modelsGeneration) return
        if (!models.length) {
            try {
                const response = await window.api.getKiroAvailableModels()
                if (response.models?.length) models = response.models.map((model) => model.id)
            } catch {
                /* No active account is available. */
            }
        }
        if (active && generation === modelsGeneration && models.length) {
            cachedModels.value = models
            try {
                localStorage.setItem('kiro-liveness-models-cache', JSON.stringify(models))
            } catch {
                /* Ignore unavailable storage. */
            }
        }
    } finally {
        if (active && generation === modelsGeneration) modelsLoading.value = false
    }
}

function maskProxyUrl(url) {
    return url.replace(/:([^:@/]+)@/, ':***@')
}

async function testOneAccount(account, model, message) {
    const credentials = account.credentials
    try {
        return await window.api.diagnoseAccountLiveness(
            toIpcData({
                account: {
                    id: account.id,
                    email: account.email,
                    accessToken: credentials.accessToken,
                    refreshToken: credentials.refreshToken,
                    clientId: credentials.clientId,
                    clientSecret: credentials.clientSecret,
                    region: credentials.region,
                    authMethod: credentials.authMethod,
                    provider: credentials.provider,
                    profileArn: account.profileArn,
                    machineId: account.machineId,
                    expiresAt: credentials.expiresAt,
                    proxyUrl: proxyStore.getAccountProxyUrl(account.id)
                },
                model,
                message
            })
        )
    } catch (error) {
        return {
            success: false,
            latencyMs: 0,
            error: error instanceof Error ? error.message : String(error)
        }
    }
}

async function runLiveness() {
    if (livenessRunning.value || !livenessModel.value.trim()) return
    const account = accountsStore.accounts.get(livenessAccountId.value)
    if (!account) return
    const generation = ++livenessGeneration
    livenessRunning.value = true
    livenessResult.value = null
    const result = await testOneAccount(
        account,
        livenessModel.value.trim(),
        livenessMessage.value.trim() || undefined
    )
    if (!active || generation !== livenessGeneration) return
    livenessResult.value = result
    livenessRunning.value = false
}

async function runLivenessQueue(accounts, resetAll) {
    if (livenessRunning.value || !accounts.length || !livenessModel.value.trim()) return
    const generation = ++livenessGeneration
    const model = livenessModel.value.trim()
    const message = livenessMessage.value.trim() || undefined
    livenessRunning.value = true
    if (resetAll) livenessBatch.value = new Map(accounts.map((account) => [account.id, null]))
    else {
        const next = new Map(livenessBatch.value)
        for (const account of accounts) next.set(account.id, null)
        livenessBatch.value = next
    }
    const queue = [...accounts]
    async function worker() {
        while (active && generation === livenessGeneration) {
            const account = queue.shift()
            if (!account) return
            const result = await testOneAccount(account, model, message)
            if (!active || generation !== livenessGeneration) return
            livenessBatch.value = new Map(livenessBatch.value).set(account.id, result)
        }
    }
    await Promise.all(Array.from({ length: Math.min(3, accounts.length) }, () => worker()))
    if (active && generation === livenessGeneration) livenessRunning.value = false
}

function runLivenessBatch() {
    return runLivenessQueue(selectedAccounts.value, true)
}

function stopLivenessBatch() {
    livenessGeneration++
    livenessRunning.value = false
}

function retestFailed() {
    const accounts = failedAccountIds.value
        .map((id) => accountsStore.accounts.get(id))
        .filter(Boolean)
    return runLivenessQueue(accounts, false)
}

async function retestOne(id) {
    if (livenessRunning.value || !livenessModel.value.trim()) return
    const account = accountsStore.accounts.get(id)
    if (!account) return
    const generation = ++livenessGeneration
    livenessRunning.value = true
    livenessBatch.value = new Map(livenessBatch.value).set(id, null)
    const result = await testOneAccount(
        account,
        livenessModel.value.trim(),
        livenessMessage.value.trim() || undefined
    )
    if (!active || generation !== livenessGeneration) return
    livenessBatch.value = new Map(livenessBatch.value).set(id, result)
    livenessRunning.value = false
}

function markFailedAsError() {
    if (livenessRunning.value) return
    for (const id of failedAccountIds.value) {
        const result = livenessBatch.value.get(id)
        accountsStore.updateAccount(id, {
            status: 'error',
            lastError: result?.error || (isEn.value ? 'Liveness test failed' : '测活失败')
        })
    }
}

async function deleteFailed() {
    if (livenessRunning.value) return
    const ids = [...failedAccountIds.value]
    if (!ids.length) return
    const generation = livenessGeneration
    const approved = await confirmDialog({
        title: isEn.value ? 'Delete failed accounts' : '删除失败账号',
        message: isEn.value
            ? `Delete ${ids.length} accounts that failed the liveness test? This cannot be undone.`
            : `确定删除 ${ids.length} 个测活失败的账号？此操作不可恢复。`,
        confirmText: isEn.value ? 'Delete' : '删除',
        tone: 'danger'
    })
    if (!active || !approved || livenessRunning.value || generation !== livenessGeneration) return
    accountsStore.removeAccounts(ids)
    const next = new Map(livenessBatch.value)
    for (const id of ids) next.delete(id)
    livenessBatch.value = next
}

onMounted(() => {
    void loadModels()
})
onBeforeUnmount(() => {
    active = false
    diagnoseGeneration++
    livenessGeneration++
    modelsGeneration++
})
</script>

<template>
    <div class="kam-page" data-testid="page-diagnose">
        <header class="kam-page-header">
            <div>
                <h1>{{ isEn ? 'Diagnostics' : '一键诊断' }}</h1>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Test network, Kiro API, email service and proxy connectivity.'
                            : '检测网络、Kiro/AWS API、邮箱服务与代理连通性，快速定位问题。'
                    }}
                </p>
            </div>
        </header>

        <UiCard :title="isEn ? 'Diagnostic Config' : '诊断配置'" density="compact">
            <div class="kam-diagnose-section">
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="isEn ? 'Custom probe URL (optional)' : '自定义探测 URL（可选）'"
                    for="diagnose-probe-url"
                    :description="
                        isEn
                            ? 'Any HTTP/HTTPS endpoint is added as a HEAD request; expected 2xx/3xx/4xx statuses count as reachable.'
                            : '可填任意 HTTP/HTTPS 地址用于连通性测试（HEAD 请求，2xx/3xx/4xx 视为可达）。'
                    "
                >
                    <UiInput
                        v-model="customProbeUrl"
                        v-bind="controlAttrs"
                        class="kam-diagnose-full kam-mono"
                        placeholder="https://example.com/health"
                        :disabled="isRunning"
                    />
                </UiField>
                <div class="kam-actions">
                    <UiCheckbox v-model="useProxy" :disabled="isRunning">{{
                        isEn ? 'Test through proxy' : '通过代理测试'
                    }}</UiCheckbox>
                    <UiSelect
                        v-if="useProxy && availableProxies.length"
                        v-model="selectedProxyId"
                        compact
                        :disabled="isRunning"
                        :aria-label="isEn ? 'Proxy' : '代理'"
                    >
                        <option value="">
                            -- {{ isEn ? 'Select a proxy' : '选择一个代理' }} --
                        </option>
                        <option v-for="proxy in availableProxies" :key="proxy.id" :value="proxy.id">
                            {{ proxy.protocol }}://{{ proxy.host }}:{{ proxy.port
                            }}{{ proxy.label ? ` (${proxy.label})` : ''
                            }}{{
                                proxy.status === 'alive' && proxy.latencyMs
                                    ? ` - ${proxy.latencyMs}ms`
                                    : ''
                            }}
                        </option>
                    </UiSelect>
                    <span v-else-if="useProxy" class="kam-muted">{{
                        proxyStore.proxyPoolConfig.enabled
                            ? isEn
                                ? 'No available proxy in pool'
                                : '代理池无可用代理'
                            : isEn
                              ? 'Proxy pool disabled; configure it in Proxy Pool first'
                              : '代理池未启用，请先在「代理池」配置'
                    }}</span>
                </div>
                <div class="kam-actions">
                    <UiButton
                        data-testid="diagnose-run"
                        :loading="isRunning"
                        :disabled="isRunning"
                        @click="runDiagnose"
                        ><Play :size="16" />
                        {{
                            isRunning
                                ? `${isEn ? 'Running' : '运行中'} ${progress.done}/${progress.total}`
                                : isEn
                                  ? 'Run Diagnostics'
                                  : '开始诊断'
                        }}</UiButton
                    >
                    <UiButton v-if="stats.total" variant="secondary" @click="exportReport"
                        ><Download :size="16" /> {{ isEn ? 'Copy Report' : '复制报告' }}</UiButton
                    >
                    <UiBadge v-if="stats.total" tone="success" dense
                        >{{ stats.passed }} {{ isEn ? 'passed' : '通过' }}</UiBadge
                    >
                    <UiBadge v-if="stats.failed" tone="error" dense
                        >{{ stats.failed }} {{ isEn ? 'failed' : '失败' }}</UiBadge
                    >
                </div>
                <UiProgress
                    v-if="isRunning"
                    :value="progress.done"
                    :max="progress.total"
                    :label="isEn ? 'Diagnostic progress' : '诊断进度'"
                    dense
                />
                <UiAlert
                    v-if="diagnoseError"
                    tone="error"
                    :title="isEn ? 'Diagnostic failed' : '诊断失败'"
                    >{{ diagnoseError }}</UiAlert
                >
            </div>
        </UiCard>

        <UiCard :title="isEn ? 'Account Liveness Test' : '账号测活'" density="compact">
            <div class="kam-diagnose-section">
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Sends a real chat message through the account-bound proxy to verify that the selected model responds.'
                            : '通过账号绑定的代理给指定模型发送真实消息，验证账号能否正常返回。'
                    }}
                </p>
                <div class="kam-actions">
                    <UiButton
                        dense
                        :variant="livenessMode === 'single' ? 'secondary' : 'ghost'"
                        :disabled="livenessRunning"
                        :aria-pressed="livenessMode === 'single'"
                        @click="livenessMode = 'single'"
                        >{{ isEn ? 'Single' : '单个账号' }}</UiButton
                    >
                    <UiButton
                        dense
                        :variant="livenessMode === 'selected' ? 'secondary' : 'ghost'"
                        :disabled="livenessRunning"
                        :aria-pressed="livenessMode === 'selected'"
                        @click="livenessMode = 'selected'"
                        >{{ isEn ? 'Selected' : '选中账号' }}
                        <UiBadge dense>{{ selectedAccounts.length }}</UiBadge></UiButton
                    >
                </div>
                <UiAlert
                    v-if="livenessMode === 'selected' && !selectedAccounts.length"
                    tone="warning"
                    >{{
                        isEn
                            ? 'No accounts selected. Select accounts on the Accounts page first.'
                            : '未选中任何账号。请先到「账号管理」页面多选账号。'
                    }}</UiAlert
                >
                <div class="kam-field-grid">
                    <UiField
                        v-if="livenessMode === 'single'"
                        v-slot="{ controlAttrs }"
                        class="kam-diagnose-liveness-field"
                        :label="isEn ? 'Account' : '账号'"
                        for="diagnose-account"
                    >
                        <div class="kam-diagnose-account-controls">
                            <UiSelect
                                v-model="livenessAccountId"
                                v-bind="controlAttrs"
                                :disabled="livenessRunning"
                                class="kam-diagnose-full"
                            >
                                <option value="">
                                    -- {{ isEn ? 'Select an account' : '选择账号' }} --
                                </option>
                                <option
                                    v-for="account in accountList"
                                    :key="account.id"
                                    :value="account.id"
                                >
                                    {{ account.email
                                    }}{{
                                        account.subscription?.type
                                            ? ` [${account.subscription.type}]`
                                            : ''
                                    }}{{ proxyStore.getAccountProxyUrl(account.id) ? ' 🔗' : '' }}
                                </option>
                            </UiSelect>
                            <p
                                v-if="
                                    livenessAccountId &&
                                    proxyStore.getAccountProxyUrl(livenessAccountId)
                                "
                                class="kam-muted"
                            >
                                {{ isEn ? 'Bound proxy' : '绑定代理' }}:
                                <span class="kam-mono">{{
                                    maskProxyUrl(proxyStore.getAccountProxyUrl(livenessAccountId))
                                }}</span>
                            </p>
                        </div>
                    </UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        class="kam-diagnose-liveness-field"
                        :label="isEn ? 'Model' : '模型'"
                        for="diagnose-model"
                    >
                        <div class="kam-diagnose-model-controls">
                            <UiInput
                                v-model="livenessModel"
                                v-bind="controlAttrs"
                                class="kam-mono"
                                list="diagnose-model-options"
                                :disabled="livenessRunning"
                                placeholder="claude-sonnet-4.5"
                            />
                            <datalist id="diagnose-model-options">
                                <option v-for="model in modelOptions" :key="model" :value="model" />
                            </datalist>
                            <UiButton
                                dense
                                ghost
                                :disabled="modelsLoading"
                                :loading="modelsLoading"
                                :title="
                                    isEn
                                        ? 'Refresh models from proxy cache / Kiro'
                                        : '从代理缓存 / Kiro 刷新可用模型'
                                "
                                @click="loadModels"
                                ><RefreshCw :size="14" />
                                {{
                                    cachedModels.length
                                        ? isEn
                                            ? `${cachedModels.length} cached`
                                            : `${cachedModels.length} 个缓存`
                                        : isEn
                                          ? 'Refresh'
                                          : '刷新'
                                }}</UiButton
                            >
                        </div>
                    </UiField>
                </div>
                <UiField
                    v-slot="{ controlAttrs }"
                    class="kam-diagnose-liveness-field"
                    :label="isEn ? 'Test message' : '测试消息'"
                    for="diagnose-message"
                >
                    <div class="kam-diagnose-message-controls">
                        <UiInput
                            v-model="livenessMessage"
                            v-bind="controlAttrs"
                            class="kam-diagnose-full"
                            :disabled="livenessRunning"
                            placeholder='Hi, reply with "pong" only.'
                        />
                    </div>
                </UiField>
                <div class="kam-actions">
                    <UiButton
                        v-if="livenessMode === 'single'"
                        data-testid="liveness-run"
                        :loading="livenessRunning"
                        :disabled="livenessRunning || !livenessAccountId || !livenessModel.trim()"
                        @click="runLiveness"
                        >{{
                            livenessRunning
                                ? isEn
                                    ? 'Testing...'
                                    : '测试中...'
                                : isEn
                                  ? 'Test Now'
                                  : '开始测活'
                        }}</UiButton
                    >
                    <template v-else>
                        <UiButton
                            data-testid="liveness-run"
                            :loading="livenessRunning"
                            :disabled="
                                livenessRunning || !selectedAccounts.length || !livenessModel.trim()
                            "
                            @click="runLivenessBatch"
                            >{{
                                livenessRunning
                                    ? `${isEn ? 'Testing' : '测试中'} ${batchStats.done}/${batchStats.total}`
                                    : `${isEn ? 'Test Selected' : '批量测活'} (${selectedAccounts.length})`
                            }}</UiButton
                        >
                        <UiButton
                            v-if="livenessRunning"
                            data-testid="liveness-stop"
                            variant="danger"
                            @click="stopLivenessBatch"
                            ><Square :size="14" /> {{ isEn ? 'Stop' : '停止' }}</UiButton
                        >
                        <UiBadge v-if="batchStats.total" dense tone="success"
                            >{{ batchStats.ok }} {{ isEn ? 'passed' : '通过' }}</UiBadge
                        >
                        <UiBadge v-if="batchStats.fail" dense tone="error"
                            >{{ batchStats.fail }} {{ isEn ? 'failed' : '失败' }}</UiBadge
                        >
                    </template>
                </div>
                <UiAlert
                    v-if="livenessMode === 'single' && livenessResult"
                    :tone="livenessResult.success ? 'success' : 'error'"
                    :title="
                        livenessResult.success
                            ? isEn
                                ? 'Account is alive'
                                : '账号正常'
                            : isEn
                              ? 'Failed'
                              : '失败'
                    "
                >
                    <div class="kam-diagnose-result-detail">
                        <span class="kam-mono">{{ livenessResult.latencyMs }}ms</span>
                        <pre
                            v-if="livenessResult.success && livenessResult.content"
                            class="kam-mono"
                            >{{ livenessResult.content }}</pre
                        >
                        <span v-if="livenessResult.usage"
                            >{{ isEn ? 'Input' : '输入' }}: {{ livenessResult.usage.inputTokens }} ·
                            {{ isEn ? 'Output' : '输出' }}:
                            {{ livenessResult.usage.outputTokens }} · Credits:
                            {{ livenessResult.usage.credits }}</span
                        >
                        <span v-if="!livenessResult.success && livenessResult.error">{{
                            livenessResult.error
                        }}</span>
                    </div>
                </UiAlert>
                <div
                    v-if="
                        livenessMode === 'selected' && !livenessRunning && failedAccountIds.length
                    "
                    class="kam-actions"
                >
                    <UiBadge dense tone="error"
                        >{{ failedAccountIds.length }} {{ isEn ? 'failed' : '个失败' }}</UiBadge
                    >
                    <UiButton
                        data-testid="liveness-retest"
                        dense
                        variant="secondary"
                        @click="retestFailed"
                        ><RotateCcw :size="14" />
                        {{ isEn ? 'Retest failed' : '重测失败' }}</UiButton
                    >
                    <UiButton dense variant="secondary" @click="markFailedAsError"
                        ><Flag :size="14" /> {{ isEn ? 'Mark as error' : '标记为错误' }}</UiButton
                    >
                    <UiButton dense variant="danger" @click="deleteFailed"
                        ><Trash2 :size="14" /> {{ isEn ? 'Delete failed' : '删除失败' }}</UiButton
                    >
                </div>
                <UiTable
                    v-if="livenessMode === 'selected' && batchStats.total"
                    :headers="batchHeaders"
                    :items="batchRows"
                    :label="isEn ? 'Account liveness results' : '账号测活结果'"
                    dense
                >
                    <template #[slotEmail]="{ item }"
                        ><span>{{ item.email }}</span
                        ><UiBadge v-if="item.boundProxy" dense tone="accent">{{
                            isEn ? 'Proxy' : '代理'
                        }}</UiBadge></template
                    >
                    <template #[slotResult]="{ item }">
                        <UiBadge v-if="item.result === null" dense>{{
                            isEn ? 'Pending' : '进行中'
                        }}</UiBadge>
                        <template v-else-if="item.result"
                            ><UiBadge dense :tone="item.result.success ? 'success' : 'error'">{{
                                item.result.success
                                    ? isEn
                                        ? 'Pass'
                                        : '通过'
                                    : isEn
                                      ? 'Fail'
                                      : '失败'
                            }}</UiBadge
                            ><span
                                v-if="item.result.content"
                                class="kam-diagnose-cell-detail kam-muted kam-mono"
                                :title="item.result.content"
                                >{{ item.result.content }}</span
                            ><span
                                v-if="item.result.error"
                                class="kam-diagnose-cell-detail"
                                :title="item.result.error"
                                >{{ item.result.error }}</span
                            ></template
                        >
                    </template>
                    <template #[slotLatency]="{ item }"
                        ><span v-if="item.result" class="kam-mono"
                            >{{ item.result.latencyMs }}ms</span
                        ></template
                    >
                    <template #[slotAction]="{ item }"
                        ><UiButton
                            v-if="item.result !== null"
                            dense
                            ghost
                            :disabled="livenessRunning"
                            :aria-label="isEn ? `Retest ${item.email}` : `重测 ${item.email}`"
                            @click="retestOne(item.id)"
                            ><RotateCcw :size="14" /></UiButton
                    ></template>
                </UiTable>
            </div>
        </UiCard>

        <UiCard
            v-for="group in targetGroups"
            :key="group.id"
            :title="pick(group.label)"
            density="compact"
        >
            <UiTable
                :headers="targetHeaders"
                :items="targetRows(group.items)"
                :label="pick(group.label)"
                dense
            >
                <template #[slotTarget]="{ item }"
                    ><strong>{{ pick(item.label) }}</strong
                    ><span class="kam-diagnose-cell-detail kam-muted kam-mono" :title="item.url">{{
                        item.url
                    }}</span
                    ><span class="kam-diagnose-cell-detail kam-muted">{{
                        pick(item.description)
                    }}</span
                    ><span v-if="item.result?.error" class="kam-diagnose-cell-detail">{{
                        item.result.error
                    }}</span></template
                >
                <template #[slotStatus]="{ item }"
                    ><UiBadge
                        dense
                        :tone="!item.result ? 'neutral' : item.result.success ? 'success' : 'error'"
                        >{{
                            !item.result
                                ? isEn
                                    ? 'Not tested'
                                    : '未测试'
                                : item.result.success
                                  ? isEn
                                      ? 'Pass'
                                      : '通过'
                                  : isEn
                                    ? 'Fail'
                                    : '失败'
                        }}</UiBadge
                    ></template
                >
                <template #[slotHttp]="{ item }"
                    ><span v-if="item.result?.httpStatus" class="kam-mono">{{
                        item.result.httpStatus
                    }}</span></template
                >
                <template #[slotLatency]="{ item }"
                    ><span v-if="item.result?.latencyMs != null" class="kam-mono"
                        >{{ item.result.latencyMs }}ms</span
                    ></template
                >
            </UiTable>
        </UiCard>
    </div>
</template>

<style scoped>
.kam-diagnose-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.kam-diagnose-full {
    width: 100%;
}
.kam-diagnose-section :deep(.ui-field) {
    min-width: 0;
}
.kam-diagnose-section :deep(.ui-field.kam-diagnose-liveness-field) {
    display: grid;
    grid-template-columns: minmax(100px, 0.35fr) minmax(0, 1fr);
    align-items: start;
    gap: 12px;
}
.kam-diagnose-account-controls,
.kam-diagnose-model-controls,
.kam-diagnose-message-controls {
    width: 100%;
    min-width: 0;
}
.kam-diagnose-model-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}
.kam-diagnose-model-controls :deep(.ui-input) {
    flex: 1 1 240px;
    min-width: 0;
}
.kam-diagnose-section :deep(.ui-select) {
    min-width: 0;
    max-width: 100%;
}
.kam-diagnose-result-detail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-wrap: anywhere;
}
.kam-diagnose-result-detail pre {
    margin: 0;
    white-space: pre-wrap;
    max-height: 160px;
    overflow: auto;
}
.kam-diagnose-cell-detail {
    display: block;
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
}
@media (max-width: 900px) {
    .kam-diagnose-section :deep(.ui-field.kam-diagnose-liveness-field) {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
