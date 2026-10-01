<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiField,
    UiInput,
    UiSpinner,
    UiSwitch
} from '@lingyzh/ui'
import { Check, Copy, Download, KeyRound, Play, Square } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { toIpcData } from '../../lib/ipcData'

const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const defaultConfig = {
    enabled: false,
    port: 8899,
    host: '127.0.0.1',
    mitmDomains: ['amazonaws.com', 'amazon.com'],
    autoStart: false,
    logRequests: true
}
const config = ref({ ...defaultConfig })
const isRunning = ref(false)
const isInitialized = ref(false)
const isInitializing = ref(false)
const operation = ref('')
const error = ref('')
const notice = ref('')
const stats = ref(null)
const caInfo = ref(null)
const caInstalled = ref(null)
const isCheckingCa = ref(false)
const recentRequests = ref([])
const copied = ref('')
let active = false
let generation = 0
let updateQueue = Promise.resolve()
let copyTimer = null
let unsubRequest = null
let unsubStatus = null
let unsubError = null

function text(zh, en) {
    return isEn.value ? en : zh
}

function errorMessage(value, fallback) {
    return value instanceof Error ? value.message : typeof value === 'string' ? value : fallback
}

function setError(value) {
    if (active) {
        error.value = value
        notice.value = ''
    }
}

function setNotice(value) {
    if (active) {
        notice.value = value
        error.value = ''
    }
}

function applyStatus(status) {
    if (!active) return
    isRunning.value = Boolean(status.running)
    if (status.config) config.value = { ...status.config }
    if (status.stats) stats.value = status.stats
    if (status.caInfo && !caInfo.value) caInfo.value = status.caInfo
}

function initialize() {
    if (!active || isInitialized.value || isInitializing.value) return
    const current = generation
    isInitializing.value = true
    error.value = ''
    Promise.resolve()
        .then(() => window.api.kproxyInit())
        .then(async (result) => {
            if (!active || current !== generation) return
            if (!result.success) {
                setError(result.error || text('K-Proxy 初始化失败', 'Failed to initialize K-Proxy'))
                return
            }
            if (result.caInfo) caInfo.value = result.caInfo
            const status = await window.api.kproxyGetStatus()
            if (active && current === generation) {
                applyStatus(status)
                isInitialized.value = true
            }
        })
        .catch((cause) => {
            if (active && current === generation)
                setError(errorMessage(cause, text('初始化失败', 'Init failed')))
        })
        .finally(() => {
            if (active && current === generation) isInitializing.value = false
        })
}

function checkCaInstalled() {
    if (!active || isCheckingCa.value) return
    const current = generation
    isCheckingCa.value = true
    Promise.resolve()
        .then(() => window.api.kproxyCheckCaCertInstalled())
        .then((result) => {
            if (!active || current !== generation) return
            if (result.success) caInstalled.value = result.installed
            else {
                caInstalled.value = null
                setError(result.error || text('证书状态检测失败', 'Certificate check failed'))
            }
        })
        .catch((cause) => {
            if (!active || current !== generation) return
            caInstalled.value = null
            setError(errorMessage(cause, text('证书状态检测失败', 'Certificate check failed')))
        })
        .finally(() => {
            if (active && current === generation) isCheckingCa.value = false
        })
}

function updateConfig(updates) {
    if (!active) return Promise.resolve(false)
    config.value = { ...config.value, ...updates }
    const current = generation
    const payload = toIpcData(updates)
    const task = updateQueue.then(async () => {
        if (!active || current !== generation) return false
        try {
            const result = await window.api.kproxyUpdateConfig(payload)
            if (!active || current !== generation) return false
            if (!result.success) {
                setError(result.error || text('配置更新失败', 'Failed to update config'))
                return false
            }
            return true
        } catch (cause) {
            if (active && current === generation)
                setError(errorMessage(cause, text('配置更新失败', 'Failed to update config')))
            return false
        }
    })
    updateQueue = task.then(() => undefined)
    return task
}

function changePort(value) {
    void updateConfig({ port: parseInt(value, 10) || 8899 })
}

function changeHost(value) {
    void updateConfig({ host: value })
}

function changeLogRequests(value) {
    void updateConfig({ logRequests: value })
}

function changeAutoStart(value) {
    void updateConfig({ autoStart: value })
}

function changeDeviceId(value) {
    const current = generation
    void updateConfig({ deviceId: value }).then(async (updated) => {
        if (
            !updated ||
            !active ||
            current !== generation ||
            value.length !== 64 ||
            config.value.deviceId !== value
        )
            return
        try {
            const result = await window.api.kproxySetDeviceId(toIpcData(value))
            if (active && current === generation && !result.success) {
                setError(result.error || text('设置设备 ID 失败', 'Failed to set device ID'))
            }
        } catch (cause) {
            if (active && current === generation)
                setError(errorMessage(cause, text('设置设备 ID 失败', 'Failed to set device ID')))
        }
    })
}

function toggleProxy() {
    if (!active || !isInitialized.value || operation.value) return
    const current = generation
    const stopping = isRunning.value
    operation.value = stopping ? 'stop' : 'start'
    error.value = ''
    notice.value = ''
    Promise.resolve()
        .then(() => updateQueue)
        .then(() => {
            if (!active || current !== generation) return null
            return stopping
                ? window.api.kproxyStop()
                : window.api.kproxyStart(toIpcData(config.value))
        })
        .then(async (result) => {
            if (!active || current !== generation || !result) return
            if (!result.success)
                setError(
                    result.error ||
                        text(
                            stopping ? '停止失败' : '启动失败',
                            stopping ? 'Failed to stop' : 'Failed to start'
                        )
                )
            const status = await window.api.kproxyGetStatus()
            if (active && current === generation) applyStatus(status)
        })
        .catch((cause) => {
            if (active && current === generation)
                setError(errorMessage(cause, text('操作失败', 'Operation failed')))
        })
        .finally(() => {
            if (active && current === generation) operation.value = ''
        })
}

function generateDeviceId() {
    if (!active || operation.value) return
    const current = generation
    operation.value = 'generate'
    error.value = ''
    Promise.resolve()
        .then(() => window.api.kproxyGenerateDeviceId())
        .then(async (result) => {
            if (!active || current !== generation) return
            if (!result.success || !result.deviceId) {
                setError(result.error || text('生成设备 ID 失败', 'Failed to generate device ID'))
                return
            }
            const updated = await updateConfig({ deviceId: result.deviceId })
            if (!updated || !active || current !== generation) return
            const applied = await window.api.kproxySetDeviceId(toIpcData(result.deviceId))
            if (active && current === generation && !applied.success) {
                setError(applied.error || text('设置设备 ID 失败', 'Failed to set device ID'))
            }
        })
        .catch((cause) => {
            if (active && current === generation)
                setError(
                    errorMessage(cause, text('生成设备 ID 失败', 'Failed to generate device ID'))
                )
        })
        .finally(() => {
            if (active && current === generation) operation.value = ''
        })
}

function copyText(value, kind) {
    if (!value) return
    Promise.resolve()
        .then(() => navigator.clipboard.writeText(value))
        .then(() => {
            if (!active) return
            copied.value = kind
            if (copyTimer) clearTimeout(copyTimer)
            copyTimer = setTimeout(() => {
                copied.value = ''
                copyTimer = null
            }, 2000)
        })
        .catch((cause) => setError(errorMessage(cause, text('复制失败', 'Copy failed'))))
}

function changeCertificate(install) {
    if (!active || operation.value) return
    const current = generation
    operation.value = install ? 'install-ca' : 'uninstall-ca'
    error.value = ''
    notice.value = ''
    Promise.resolve()
        .then(() =>
            install ? window.api.kproxyInstallCaCert() : window.api.kproxyUninstallCaCert()
        )
        .then((result) => {
            if (!active || current !== generation) return
            if (result.success) {
                caInstalled.value = install
                setNotice(
                    result.message ||
                        text(
                            install ? '证书已安装' : '证书已卸载',
                            install ? 'Certificate installed' : 'Certificate uninstalled'
                        )
                )
            } else
                setError(
                    result.error ||
                        text(
                            install ? '证书安装失败' : '证书卸载失败',
                            install ? 'Failed to install' : 'Failed to uninstall'
                        )
                )
        })
        .catch((cause) => {
            if (active && current === generation)
                setError(errorMessage(cause, text('证书操作失败', 'Certificate operation failed')))
        })
        .finally(() => {
            if (active && current === generation) operation.value = ''
        })
}

function exportCaCert() {
    if (!active || operation.value) return
    const current = generation
    operation.value = 'export-ca'
    error.value = ''
    Promise.resolve()
        .then(() => window.api.kproxyExportCaCert())
        .then((result) => {
            if (!active || current !== generation) return
            if (result.success) setNotice(text('证书已导出', 'Certificate exported'))
            else setError(result.error || text('导出失败', 'Export failed'))
        })
        .catch((cause) => {
            if (active && current === generation)
                setError(errorMessage(cause, text('导出失败', 'Export failed')))
        })
        .finally(() => {
            if (active && current === generation) operation.value = ''
        })
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString()
}

function formatDate(value) {
    return new Date(value).toLocaleDateString()
}

onMounted(() => {
    active = true
    generation += 1
    unsubRequest = window.api.onKproxyRequest((info) => {
        if (!active) return
        recentRequests.value = [
            {
                timestamp: info.timestamp,
                host: info.host,
                method: info.method,
                path: info.path,
                isMitm: info.isMitm,
                deviceIdReplaced: info.deviceIdReplaced
            },
            ...recentRequests.value
        ].slice(0, 50)
    })
    unsubStatus = window.api.onKproxyStatusChange((status) => {
        if (active) isRunning.value = status.running
    })
    unsubError = window.api.onKproxyError((message) => setError(message))
    initialize()
    checkCaInstalled()
})

onBeforeUnmount(() => {
    active = false
    generation += 1
    unsubRequest?.()
    unsubStatus?.()
    unsubError?.()
    unsubRequest = unsubStatus = unsubError = null
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = null
})
</script>

<template>
    <div class="kproxy-panel" data-testid="kproxy-panel">
        <UiAlert
            v-if="error"
            tone="error"
            :title="text('K-Proxy 错误', 'K-Proxy error')"
            data-testid="kproxy-error"
        >
            <div class="kproxy-alert-content">
                <span>{{ error }}</span>
                <UiButton
                    variant="ghost"
                    size="sm"
                    data-testid="kproxy-dismiss-error"
                    @click="error = ''"
                    >{{ text('关闭', 'Dismiss') }}</UiButton
                >
            </div>
        </UiAlert>
        <UiAlert
            v-if="notice"
            tone="success"
            :title="text('操作完成', 'Operation complete')"
            data-testid="kproxy-notice"
            >{{ notice }}</UiAlert
        >

        <div v-if="!isInitialized" class="kproxy-initializing">
            <UiSpinner
                v-if="isInitializing || !error"
                :label="text('正在初始化 K-Proxy...', 'Initializing K-Proxy...')"
            />
            <UiButton
                v-else
                :loading="isInitializing"
                data-testid="kproxy-retry-init"
                @click="initialize"
                >{{ text('重试', 'Retry') }}</UiButton
            >
        </div>
        <template v-else>
            <UiCard
                title="K-Proxy MITM"
                density="compact"
                :subtitle="
                    text(
                        'MITM 代理，用于替换 Kiro 请求中的 Machine ID',
                        'MITM proxy for replacing Machine ID in Kiro requests'
                    )
                "
            >
                <template #header>
                    <div class="kam-actions kproxy-control-header">
                        <h2 class="ui-card-title">K-Proxy MITM</h2>
                        <UiBadge
                            :tone="isRunning ? 'success' : 'neutral'"
                            dense
                            data-testid="kproxy-running-status"
                            >{{
                                isRunning ? text('运行中', 'Running') : text('已停止', 'Stopped')
                            }}</UiBadge
                        >
                        <UiButton
                            :variant="isRunning ? 'danger' : 'primary'"
                            size="sm"
                            :loading="operation === 'start' || operation === 'stop'"
                            :disabled="Boolean(operation)"
                            data-testid="kproxy-toggle"
                            @click="toggleProxy"
                        >
                            <Square v-if="isRunning" :size="16" aria-hidden="true" />
                            <Play v-else :size="16" aria-hidden="true" />
                            {{ isRunning ? text('停止', 'Stop') : text('启动', 'Start') }}
                        </UiButton>
                    </div>
                    <p class="kam-muted">
                        {{
                            text(
                                'MITM 代理，用于替换 Kiro 请求中的 Machine ID',
                                'MITM proxy for replacing Machine ID in Kiro requests'
                            )
                        }}
                    </p>
                </template>
                <div class="kproxy-address kam-actions">
                    <span class="kam-muted">{{ text('代理地址', 'Proxy') }}:</span>
                    <code class="kam-mono">{{ config.host }}:{{ config.port }}</code>
                    <UiButton
                        icon
                        size="sm"
                        :aria-label="text('复制代理地址', 'Copy proxy address')"
                        data-testid="kproxy-copy-address"
                        @click="copyText(`${config.host}:${config.port}`, 'address')"
                    >
                        <Check v-if="copied === 'address'" :size="16" aria-hidden="true" />
                        <Copy v-else :size="16" aria-hidden="true" />
                    </UiButton>
                </div>
                <div class="kam-field-grid">
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="text('端口', 'Port')"
                        for="kproxy-port"
                    >
                        <UiInput
                            :model-value="config.port"
                            v-bind="controlAttrs"
                            type="number"
                            :disabled="isRunning || Boolean(operation)"
                            data-testid="kproxy-port"
                            @update:model-value="changePort"
                        />
                    </UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="text('监听地址', 'Host')"
                        for="kproxy-host"
                    >
                        <UiInput
                            :model-value="config.host"
                            v-bind="controlAttrs"
                            :disabled="isRunning || Boolean(operation)"
                            data-testid="kproxy-host"
                            @update:model-value="changeHost"
                        />
                    </UiField>
                </div>
                <UiField :label="text('记录请求日志', 'Log Requests')">
                    <UiSwitch
                        :model-value="config.logRequests"
                        :disabled="Boolean(operation)"
                        :aria-label="text('记录请求日志', 'Log Requests')"
                        data-testid="kproxy-log-requests"
                        @update:model-value="changeLogRequests"
                    />
                </UiField>
                <UiField :label="text('自动启动', 'Auto Start')">
                    <UiSwitch
                        :model-value="config.autoStart"
                        :disabled="Boolean(operation)"
                        :aria-label="text('自动启动', 'Auto Start')"
                        data-testid="kproxy-auto-start"
                        @update:model-value="changeAutoStart"
                    />
                </UiField>
            </UiCard>

            <UiCard
                :title="text('设备 ID', 'Device ID')"
                :subtitle="
                    text(
                        '替换请求中的 Machine ID（64 位十六进制）',
                        'Machine ID to replace in requests (64 hex characters)'
                    )
                "
                density="compact"
            >
                <div class="kam-actions kproxy-device-row">
                    <UiInput
                        :model-value="config.deviceId || ''"
                        :aria-label="text('设备 ID', 'Device ID')"
                        class="kam-mono"
                        :disabled="Boolean(operation)"
                        data-testid="kproxy-device-id"
                        @update:model-value="changeDeviceId"
                    />
                    <UiButton
                        size="sm"
                        :loading="operation === 'generate'"
                        :disabled="Boolean(operation)"
                        data-testid="kproxy-generate-id"
                        @click="generateDeviceId"
                    >
                        <KeyRound :size="16" aria-hidden="true" />
                        {{ text('生成', 'Generate') }}
                    </UiButton>
                    <UiButton
                        v-if="config.deviceId"
                        icon
                        size="sm"
                        :aria-label="text('复制设备 ID', 'Copy device ID')"
                        data-testid="kproxy-copy-device-id"
                        @click="copyText(config.deviceId, 'device')"
                    >
                        <Check v-if="copied === 'device'" :size="16" aria-hidden="true" />
                        <Copy v-else :size="16" aria-hidden="true" />
                    </UiButton>
                </div>
                <p v-if="config.deviceId" class="kam-muted" data-testid="kproxy-device-id-status">
                    {{
                        config.deviceId.length === 64
                            ? text('设备 ID 长度正确', 'Device ID length is valid')
                            : text(
                                  `长度不正确: ${config.deviceId.length}/64`,
                                  `Invalid length: ${config.deviceId.length}/64`
                              )
                    }}
                </p>
            </UiCard>

            <UiCard
                :title="text('CA 证书', 'CA Certificate')"
                :subtitle="
                    text(
                        '安装此证书以信任 K-Proxy MITM 代理',
                        'Install this certificate to trust K-Proxy MITM'
                    )
                "
                density="compact"
            >
                <div class="kam-actions">
                    <UiButton
                        v-if="caInstalled === false"
                        size="sm"
                        :loading="operation === 'install-ca'"
                        :disabled="Boolean(operation)"
                        data-testid="kproxy-install-ca"
                        @click="changeCertificate(true)"
                        >{{ text('安装', 'Install') }}</UiButton
                    >
                    <UiButton
                        v-else-if="caInstalled === true"
                        variant="danger"
                        size="sm"
                        :loading="operation === 'uninstall-ca'"
                        :disabled="Boolean(operation)"
                        data-testid="kproxy-uninstall-ca"
                        @click="changeCertificate(false)"
                        >{{ text('卸载', 'Uninstall') }}</UiButton
                    >
                    <UiButton
                        v-else-if="isCheckingCa"
                        size="sm"
                        disabled
                        data-testid="kproxy-checking-ca"
                        >{{ text('检测中...', 'Checking...') }}</UiButton
                    >
                    <UiButton
                        v-else
                        size="sm"
                        data-testid="kproxy-retry-ca"
                        @click="checkCaInstalled"
                        >{{ text('重新检测', 'Check Again') }}</UiButton
                    >
                    <UiButton
                        size="sm"
                        :loading="operation === 'export-ca'"
                        :disabled="Boolean(operation)"
                        data-testid="kproxy-export-ca"
                        @click="exportCaCert"
                    >
                        <Download :size="16" aria-hidden="true" />
                        {{ text('导出', 'Export') }}
                    </UiButton>
                </div>
                <div v-if="caInfo" class="kproxy-cert-details">
                    <p>
                        <span class="kam-muted">{{ text('指纹', 'Fingerprint') }}:</span>
                        <code class="kam-mono">{{ caInfo.fingerprint }}</code>
                    </p>
                    <p>
                        <span class="kam-muted">{{ text('有效期', 'Valid') }}:</span>
                        {{ formatDate(caInfo.validFrom) }} – {{ formatDate(caInfo.validTo) }}
                    </p>
                </div>
            </UiCard>

            <UiCard v-if="stats" :title="text('统计', 'Statistics')" density="compact">
                <div class="kproxy-stats">
                    <div>
                        <strong class="kam-mono">{{ stats.totalRequests }}</strong
                        ><span class="kam-muted">{{ text('总请求', 'Total') }}</span>
                    </div>
                    <div>
                        <strong class="kam-mono">{{ stats.mitmRequests }}</strong
                        ><span class="kam-muted">MITM</span>
                    </div>
                    <div>
                        <strong class="kam-mono">{{ stats.modifiedRequests }}</strong
                        ><span class="kam-muted">{{ text('已修改', 'Modified') }}</span>
                    </div>
                    <div>
                        <strong class="kam-mono">{{ stats.bypassRequests }}</strong
                        ><span class="kam-muted">{{ text('透传', 'Bypass') }}</span>
                    </div>
                </div>
            </UiCard>

            <UiCard
                v-if="recentRequests.length"
                :title="text('最近请求', 'Recent Requests')"
                density="compact"
            >
                <ul class="kproxy-requests">
                    <li
                        v-for="(request, index) in recentRequests.slice(0, 10)"
                        :key="`${request.timestamp}-${index}`"
                    >
                        <time class="kam-muted kam-mono">{{ formatTime(request.timestamp) }}</time>
                        <UiBadge :tone="request.isMitm ? 'accent' : 'neutral'" dense>{{
                            request.isMitm ? 'MITM' : 'PASS'
                        }}</UiBadge>
                        <UiBadge v-if="request.deviceIdReplaced" tone="success" dense>ID</UiBadge>
                        <span
                            class="kam-mono"
                            :title="`${request.method} ${request.host}${request.path}`"
                            >{{ request.host }}</span
                        >
                    </li>
                </ul>
            </UiCard>

            <UiCard :title="text('使用说明', 'Usage Guide')" density="compact">
                <ol class="kproxy-guide kam-muted">
                    <li>
                        {{
                            text(
                                '导出并安装 CA 证书到系统信任存储',
                                'Export and install the CA certificate to your system trust store'
                            )
                        }}
                    </li>
                    <li>
                        {{ text('设置系统/应用代理为', 'Set your system/application proxy to') }}
                        <code class="kam-mono">{{ config.host }}:{{ config.port }}</code>
                    </li>
                    <li>
                        {{
                            text(
                                '生成或输入用于请求的设备 ID',
                                'Generate or enter a device ID to use for requests'
                            )
                        }}
                    </li>
                    <li>
                        {{
                            text(
                                '启动代理后正常使用 Kiro IDE',
                                'Start the proxy and use Kiro IDE normally'
                            )
                        }}
                    </li>
                </ol>
            </UiCard>
        </template>
    </div>
</template>

<style scoped>
.kproxy-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.kproxy-initializing {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    gap: 16px;
}
.kproxy-alert-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
}
.kproxy-control-header {
    justify-content: flex-start;
}
.kproxy-control-header .ui-button {
    margin-left: auto;
}
.kproxy-address,
.kproxy-device-row {
    margin-bottom: 16px;
}
.kproxy-device-row :deep(.ui-input) {
    flex: 1 1 320px;
    min-width: 0;
}
.kproxy-panel :deep(.ui-card-content) {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.kproxy-panel :deep(.ui-field) {
    min-width: 0;
}
.kproxy-panel .kam-field-grid :deep(.ui-field) {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
}
.kproxy-panel .kam-field-grid :deep(.ui-input) {
    width: 100%;
}
.kproxy-cert-details {
    display: grid;
    gap: 8px;
}
.kproxy-cert-details code {
    overflow-wrap: anywhere;
}
.kproxy-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
}
.kproxy-stats > div {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.kproxy-stats strong {
    font-size: 22px;
}
.kproxy-requests {
    display: grid;
    gap: 6px;
    max-height: 192px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
}
.kproxy-requests li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.kproxy-requests li span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kproxy-guide {
    display: grid;
    gap: 8px;
    margin: 0;
    padding-left: 20px;
}
@media (max-width: 700px) {
    .kproxy-stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
