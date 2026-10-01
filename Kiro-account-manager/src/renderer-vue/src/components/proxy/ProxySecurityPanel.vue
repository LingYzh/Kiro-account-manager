<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiField,
    UiInput,
    UiSwitch,
    confirmDialog
} from '@lingyzh/ui'
import { Activity, RefreshCw, Shield } from 'lucide-vue-next'

const props = defineProps({
    config: { type: Object, required: true },
    running: { type: Boolean, required: true },
    isEn: { type: Boolean, required: true },
    onUpdateConfig: { type: Function, required: true }
})
const expanded = ref(false)
const showAudit = ref(false)
const showCert = ref(false)
const certInfo = ref(null)
const auditEntries = ref([])
const needsRestart = ref(false)
const copiedCert = ref(false)
const confirmingCert = ref(false)
const regenerating = ref(false)
const restarting = ref(false)
const certLoading = ref(false)
const auditLoading = ref(false)
const error = ref('')
const success = ref('')
const allowedIPsText = ref((props.config.allowedIPs || []).join('\n'))
const deniedIPsText = ref((props.config.deniedIPs || []).join('\n'))
const reversedAudit = computed(() => [...auditEntries.value].reverse())
let alive = true
let restartGeneration = 0
let certGeneration = 0
let auditGeneration = 0
let pollGeneration = 0
let pollBusy = false
let pollTimer
let copyTimer

function text(zh, en) {
    return props.isEn ? en : zh
}
function failure(cause) {
    return cause instanceof Error ? cause.message : String(cause)
}
function parseIPList(value) {
    return value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
}
async function updateConfig(key, value) {
    if (!alive) return
    error.value = ''
    try {
        await props.onUpdateConfig({ [key]: value })
    } catch (cause) {
        if (alive) error.value = failure(cause)
    }
}
function updateNumber(key, value, fallback, multiplier = 1) {
    updateConfig(key, (parseInt(value, 10) || fallback) * multiplier)
}
function saveAllowed() {
    updateConfig('allowedIPs', parseIPList(allowedIPsText.value))
}
function saveDenied() {
    updateConfig('deniedIPs', parseIPList(deniedIPsText.value))
}
async function pollRestart() {
    if (!alive || !props.running || pollBusy) return
    const current = pollGeneration
    pollBusy = true
    try {
        const result = await window.api.proxyNeedsRestart()
        if (alive && props.running && current === pollGeneration)
            needsRestart.value = Boolean(result.needsRestart)
    } catch (cause) {
        if (alive && props.running && current === pollGeneration) error.value = failure(cause)
    } finally {
        pollBusy = false
    }
}
async function fetchCertInfo() {
    if (!alive || !showCert.value || certLoading.value) return
    const current = ++certGeneration
    certLoading.value = true
    error.value = ''
    try {
        const result = await window.api.proxySelfSignedCertInfo()
        if (!alive || !showCert.value || current !== certGeneration) return
        if (!result.success)
            throw new Error(result.error || text('证书信息获取失败', 'Failed to load certificate'))
        certInfo.value = result
    } catch (cause) {
        if (alive && showCert.value && current === certGeneration) error.value = failure(cause)
    } finally {
        if (alive && current === certGeneration) certLoading.value = false
    }
}
function toggleCert() {
    showCert.value = !showCert.value
    if (!showCert.value) {
        certGeneration++
        certLoading.value = false
    } else if (!certInfo.value) fetchCertInfo()
}
async function regenerateCert() {
    if (!alive || !showCert.value || confirmingCert.value || regenerating.value) return
    const beforeConfirm = certGeneration
    confirmingCert.value = true
    let confirmed
    try {
        confirmed = await confirmDialog({
            title: text('重新生成自签证书？', 'Regenerate self-signed certificate?'),
            message: text('所有客户端需要重新安装。', 'You will need to re-install it on clients.'),
            tone: 'danger'
        })
    } catch (cause) {
        if (alive && showCert.value && beforeConfirm === certGeneration)
            error.value = failure(cause)
        return
    } finally {
        if (alive) confirmingCert.value = false
    }
    if (!alive || !showCert.value || beforeConfirm !== certGeneration || !confirmed) return
    const current = ++certGeneration
    regenerating.value = true
    error.value = ''
    success.value = ''
    try {
        const result = await window.api.proxySelfSignedCertRegenerate()
        if (!alive || !showCert.value || current !== certGeneration) return
        if (!result.success)
            throw new Error(result.error || text('重新生成失败', 'Regeneration failed'))
        certInfo.value = result
        success.value = text('已重新生成。重启反代后生效。', 'Regenerated. Restart proxy to apply.')
    } catch (cause) {
        if (alive && showCert.value && current === certGeneration) error.value = failure(cause)
    } finally {
        if (alive) regenerating.value = false
    }
}
function downloadCert() {
    if (!certInfo.value?.cert) return
    const url = URL.createObjectURL(
        new Blob([certInfo.value.cert], { type: 'application/x-pem-file' })
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'kiro-proxy-cert.crt'
    anchor.click()
    URL.revokeObjectURL(url)
}
async function copyCert() {
    if (!alive || !certInfo.value?.cert || copiedCert.value) return
    error.value = ''
    try {
        await navigator.clipboard.writeText(certInfo.value.cert)
        if (!alive) return
        copiedCert.value = true
        clearTimeout(copyTimer)
        copyTimer = setTimeout(() => {
            if (alive) copiedCert.value = false
        }, 2000)
    } catch (cause) {
        if (alive) error.value = failure(cause)
    }
}
async function fetchAudit() {
    if (!alive || !showAudit.value || auditLoading.value) return
    const current = ++auditGeneration
    auditLoading.value = true
    error.value = ''
    try {
        const result = await window.api.proxyAuditLog()
        if (alive && showAudit.value && current === auditGeneration)
            auditEntries.value = result.entries || []
    } catch (cause) {
        if (alive && showAudit.value && current === auditGeneration) error.value = failure(cause)
    } finally {
        if (alive && current === auditGeneration) auditLoading.value = false
    }
}
function toggleAudit() {
    showAudit.value = !showAudit.value
    if (showAudit.value) fetchAudit()
    else {
        auditGeneration++
        auditLoading.value = false
    }
}
async function restartProxy() {
    if (!alive || restarting.value || !props.running) return
    const confirmed = await confirmDialog({
        title: text('立即重启反代服务器？', 'Restart proxy server now?'),
        message: text('正在进行的流式响应会被中断。', 'Active streams will be interrupted.'),
        tone: 'default'
    })
    if (!alive || !props.running || !confirmed) return
    const current = ++restartGeneration
    restarting.value = true
    error.value = ''
    success.value = ''
    try {
        const result = await window.api.proxyRestart()
        if (!alive || !props.running || current !== restartGeneration) return
        if (!result.success) throw new Error(result.error || text('重启失败', 'Restart failed'))
        needsRestart.value = false
        success.value = text('反代已重启', 'Proxy restarted')
    } catch (cause) {
        if (alive && props.running && current === restartGeneration) error.value = failure(cause)
    } finally {
        if (alive && current === restartGeneration) restarting.value = false
    }
}
watch(
    () => props.config.allowedIPs,
    (value) => {
        allowedIPsText.value = (value || []).join('\n')
    }
)
watch(
    () => props.config.deniedIPs,
    (value) => {
        deniedIPsText.value = (value || []).join('\n')
    }
)
watch(
    () => props.running,
    (running) => {
        pollGeneration++
        clearInterval(pollTimer)
        pollTimer = undefined
        if (!running) {
            needsRestart.value = false
            restartGeneration++
            restarting.value = false
            return
        }
        pollRestart()
        pollTimer = setInterval(pollRestart, 5000)
    },
    { immediate: true }
)
onBeforeUnmount(() => {
    alive = false
    restartGeneration++
    certGeneration++
    auditGeneration++
    pollGeneration++
    clearInterval(pollTimer)
    clearTimeout(copyTimer)
})
</script>

<template>
    <UiCard density="compact" class="proxy-security-panel" data-testid="proxy-security-panel">
        <div class="proxy-security-content">
            <UiButton
                variant="ghost"
                class="proxy-security-toggle"
                :aria-expanded="expanded"
                data-testid="proxy-security-toggle"
                @click="expanded = !expanded"
            >
                <Shield :size="18" /><span class="ui-card-title">{{
                    text('安全与可观测设置 (v1.8)', 'Security & Observability (v1.8)')
                }}</span>
                <UiBadge
                    v-if="needsRestart"
                    tone="warning"
                    dense
                    data-testid="proxy-security-needs-restart"
                    >{{ text('需要重启', 'Restart required') }}</UiBadge
                >
                <span>{{ expanded ? '⌄' : '›' }}</span>
            </UiButton>
            <div v-if="expanded" class="proxy-security-body" data-testid="proxy-security-body">
                <UiAlert v-if="error" tone="error" data-testid="proxy-security-error">{{
                    error
                }}</UiAlert>
                <UiAlert v-if="success" tone="success" data-testid="proxy-security-success">{{
                    success
                }}</UiAlert>
                <div v-if="needsRestart" class="kam-actions">
                    <UiAlert tone="warning">{{
                        text('配置已更改，重启后生效。', 'Configuration change requires a restart.')
                    }}</UiAlert>
                    <UiButton
                        :loading="restarting"
                        data-testid="proxy-security-restart"
                        @click="restartProxy"
                        ><RefreshCw :size="16" />{{ text('立即重启', 'Restart Now') }}</UiButton
                    >
                </div>

                <div class="kam-grid">
                    <UiField :label="text('请求体上限 (MB)', 'Max body size (MB)')">
                        <UiInput
                            type="number"
                            min="1"
                            max="100"
                            step="1"
                            :model-value="
                                Math.round(
                                    (config.maxRequestBodyBytes || 10 * 1024 * 1024) / (1024 * 1024)
                                )
                            "
                            data-testid="proxy-security-body-mb"
                            @update:model-value="
                                updateNumber('maxRequestBodyBytes', $event, 10, 1024 * 1024)
                            "
                        />
                        <small class="kam-muted">{{
                            text('超过则返回 HTTP 413', 'Larger requests receive HTTP 413')
                        }}</small>
                    </UiField>
                    <UiField :label="text('限速（每 Key 每分钟）', 'Rate limit (req/min per Key)')">
                        <UiInput
                            type="number"
                            min="0"
                            max="10000"
                            step="10"
                            :model-value="config.rateLimitPerKeyPerMinute || 0"
                            data-testid="proxy-security-rate-limit"
                            @update:model-value="
                                updateNumber('rateLimitPerKeyPerMinute', $event, 0)
                            "
                        />
                        <small class="kam-muted">{{
                            text(
                                '匿名时按 IP 限速；0 = 不限制',
                                'Anonymous clients use IP; 0 = unlimited'
                            )
                        }}</small>
                    </UiField>
                    <UiField :label="text('IP 白名单', 'Allowed IPs (whitelist)')">
                        <textarea
                            v-model="allowedIPsText"
                            class="proxy-security-textarea kam-mono"
                            :placeholder="
                                text('每行一个，支持 CIDR', 'One per line, supports CIDR')
                            "
                            rows="4"
                            data-testid="proxy-security-allowed-ips"
                            @blur="saveAllowed"
                        />
                        <small class="kam-muted">{{
                            text('为空 = 不限制', 'Empty = no restriction')
                        }}</small>
                    </UiField>
                    <UiField :label="text('IP 黑名单', 'Denied IPs (blacklist)')">
                        <textarea
                            v-model="deniedIPsText"
                            class="proxy-security-textarea kam-mono"
                            :placeholder="
                                text('优先级高于白名单', 'Higher priority than allowed list')
                            "
                            rows="4"
                            data-testid="proxy-security-denied-ips"
                            @blur="saveDenied"
                        />
                        <small class="kam-muted">IPv4 / IPv6 / CIDR</small>
                    </UiField>
                </div>

                <UiAlert
                    v-if="config.host === '0.0.0.0' || config.host === '::'"
                    tone="error"
                    data-testid="proxy-security-external-warning"
                >
                    <div class="proxy-security-stack">
                        <strong>{{
                            text(
                                `当前绑定到 ${config.host}（局域网/公网可访问）`,
                                `Binding to ${config.host} exposes accounts to the network!`
                            )
                        }}</strong
                        ><span>{{
                            text(
                                '必须设置至少一个 API Key 才能启动。',
                                'API Key is required to start the server.'
                            )
                        }}</span
                        ><label class="kam-actions"
                            ><UiSwitch
                                :model-value="Boolean(config.allowExternalWithoutApiKey)"
                                :disabled="running"
                                data-testid="proxy-security-allow-external"
                                @update:model-value="
                                    updateConfig('allowExternalWithoutApiKey', $event)
                                "
                            /><span>{{
                                text(
                                    '我了解风险，允许无 Key 启动（危险）',
                                    'I understand the risk, allow without API Key'
                                )
                            }}</span></label
                        >
                    </div>
                </UiAlert>

                <div class="kam-grid">
                    <UiField :label="text('会话粘性', 'Session affinity')"
                        ><UiSwitch
                            :model-value="Boolean(config.sessionAffinityEnabled)"
                            data-testid="proxy-security-affinity"
                            @update:model-value="updateConfig('sessionAffinityEnabled', $event)"
                        /><small class="kam-muted">{{
                            text(
                                '同客户端总用同账号（保 cache + 防风控）',
                                'Route same client to same account'
                            )
                        }}</small></UiField
                    >
                    <UiField label="Prometheus /metrics"
                        ><UiSwitch
                            :model-value="Boolean(config.enableMetrics)"
                            data-testid="proxy-security-metrics"
                            @update:model-value="updateConfig('enableMetrics', $event)"
                        /><small class="kam-muted">{{
                            text('暴露监控指标端点', 'Expose monitoring endpoint')
                        }}</small></UiField
                    >
                    <UiField :label="text('审计日志', 'Audit log')"
                        ><div class="kam-actions">
                            <UiSwitch
                                :model-value="Boolean(config.enableAuditLog)"
                                data-testid="proxy-security-audit-enabled"
                                @update:model-value="updateConfig('enableAuditLog', $event)"
                            /><UiButton
                                variant="secondary"
                                data-testid="proxy-security-audit-toggle"
                                @click="toggleAudit"
                                >{{
                                    showAudit ? text('隐藏', 'Hide') : text('查看', 'View')
                                }}</UiButton
                            >
                        </div>
                        <small class="kam-muted">{{
                            text(
                                '记录配置变更与关键事件',
                                'Track config changes and critical events'
                            )
                        }}</small></UiField
                    >
                    <UiField :label="text('最近请求日志条数', 'Recent requests limit')"
                        ><UiInput
                            type="number"
                            min="20"
                            max="10000"
                            step="50"
                            :model-value="config.recentRequestsLimit || 100"
                            data-testid="proxy-security-recent-limit"
                            @update:model-value="updateNumber('recentRequestsLimit', $event, 100)"
                        /><small class="kam-muted">{{
                            text('默认 100，上限 10000', 'Default 100, max 10000')
                        }}</small></UiField
                    >
                    <UiField :label="text('keep-alive 空闲超时（秒）', 'Keep-alive timeout (sec)')"
                        ><UiInput
                            type="number"
                            min="5"
                            max="600"
                            step="5"
                            :model-value="Math.round((config.keepAliveTimeoutMs || 65000) / 1000)"
                            data-testid="proxy-security-keepalive"
                            @update:model-value="
                                updateNumber('keepAliveTimeoutMs', $event, 65, 1000)
                            "
                    /></UiField>
                    <UiField
                        :label="
                            text(
                                'HTTP 回退端口（启用 TLS 时）',
                                'HTTP fallback port (when TLS enabled)'
                            )
                        "
                        ><UiInput
                            type="number"
                            min="0"
                            max="65535"
                            :disabled="running"
                            :model-value="config.fallbackPort || 0"
                            data-testid="proxy-security-fallback-port"
                            @update:model-value="updateNumber('fallbackPort', $event, 0)"
                    /></UiField>
                </div>

                <section class="proxy-security-stack" data-testid="proxy-security-tls">
                    <div class="kam-actions">
                        <h3 class="ui-card-title">
                            {{ text('自签 TLS 证书', 'Self-signed TLS Certificate') }}
                        </h3>
                        <UiButton
                            variant="secondary"
                            data-testid="proxy-security-cert-toggle"
                            @click="toggleCert"
                            >{{
                                showCert ? text('隐藏', 'Hide') : text('查看详情', 'Show details')
                            }}</UiButton
                        >
                    </div>
                    <p class="kam-muted">
                        {{
                            text(
                                '启用 TLS 但未配置证书时，反代自动生成 2 年有效期的自签证书。客户端需要安装该证书。',
                                'When TLS is enabled without a cert/key, the proxy generates a 2-year self-signed certificate. Install it on clients.'
                            )
                        }}
                    </p>
                    <p v-if="showCert && certLoading" class="kam-muted">
                        {{ text('正在加载证书…', 'Loading certificate…') }}
                    </p>
                    <div
                        v-if="showCert && certInfo"
                        class="proxy-security-stack"
                        data-testid="proxy-security-cert-info"
                    >
                        <div class="kam-grid">
                            <div>
                                <span class="kam-muted">{{ text('主体', 'Subject') }}</span>
                                <p class="kam-mono">{{ certInfo.subject || '-' }}</p>
                            </div>
                            <div>
                                <span class="kam-muted">{{ text('过期', 'Expires') }}</span>
                                <p class="kam-mono">
                                    {{
                                        certInfo.notAfter
                                            ? new Date(certInfo.notAfter).toLocaleString()
                                            : '-'
                                    }}
                                </p>
                            </div>
                            <div>
                                <span class="kam-muted"
                                    >SHA-256 {{ text('指纹', 'Fingerprint') }}</span
                                >
                                <p class="kam-mono proxy-security-wrap">
                                    {{ certInfo.fingerprint || '-' }}
                                </p>
                            </div>
                            <div>
                                <span class="kam-muted">{{
                                    text('备用名称 (SAN)', 'Subject Alt Names')
                                }}</span>
                                <p class="kam-mono proxy-security-wrap">
                                    {{ certInfo.altNames?.join(', ') || '-' }}
                                </p>
                            </div>
                        </div>
                        <div class="kam-actions">
                            <UiButton
                                variant="secondary"
                                :disabled="!certInfo.cert"
                                data-testid="proxy-security-cert-download"
                                @click="downloadCert"
                                >{{ text('下载 .crt', 'Download .crt') }}</UiButton
                            ><UiButton
                                variant="secondary"
                                :disabled="!certInfo.cert"
                                data-testid="proxy-security-cert-copy"
                                @click="copyCert"
                                >{{
                                    copiedCert
                                        ? text('已复制', 'Copied')
                                        : text('复制 PEM', 'Copy PEM')
                                }}</UiButton
                            ><UiButton
                                variant="secondary"
                                :loading="confirmingCert || regenerating"
                                :disabled="confirmingCert || regenerating"
                                data-testid="proxy-security-cert-regenerate"
                                @click="regenerateCert"
                                >{{ text('重新生成', 'Regenerate') }}</UiButton
                            >
                        </div>
                    </div>
                </section>

                <section
                    v-if="showAudit"
                    class="proxy-security-stack"
                    data-testid="proxy-security-audit"
                >
                    <div class="kam-actions">
                        <h3 class="ui-card-title">
                            {{ text('审计日志（最近 200 条）', 'Audit Log (recent 200)') }}
                        </h3>
                        <UiButton
                            variant="secondary"
                            :loading="auditLoading"
                            data-testid="proxy-security-audit-refresh"
                            @click="fetchAudit"
                            >{{ text('刷新', 'Refresh') }}</UiButton
                        >
                    </div>
                    <p v-if="!auditLoading && !auditEntries.length" class="kam-muted">
                        {{ text('暂无记录', 'No entries') }}
                    </p>
                    <div v-else class="proxy-security-audit-list">
                        <div
                            v-for="(entry, index) in reversedAudit"
                            :key="`${entry.ts}-${index}`"
                            class="proxy-security-audit-entry"
                        >
                            <div class="kam-actions">
                                <span class="kam-mono">{{
                                    new Date(entry.ts).toLocaleTimeString()
                                }}</span
                                ><UiBadge dense>{{ entry.type }}</UiBadge>
                            </div>
                            <pre>{{ JSON.stringify(entry.data) }}</pre>
                        </div>
                    </div>
                </section>

                <UiAlert
                    v-if="config.enableMetrics && running"
                    tone="info"
                    data-testid="proxy-security-metrics-hint"
                    ><Activity :size="15" />{{ text('指标端点', 'Metrics available at') }}:
                    <code>/metrics</code></UiAlert
                >
            </div>
        </div>
    </UiCard>
</template>

<style scoped>
.proxy-security-content,
.proxy-security-body,
.proxy-security-stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
}
.proxy-security-toggle {
    align-self: stretch;
    justify-content: flex-start;
    gap: 8px;
}
.proxy-security-toggle .ui-card-title {
    margin: 0;
}
.proxy-security-body :deep(.ui-field) {
    flex-direction: column;
    align-items: stretch;
}
.proxy-security-body :deep(.ui-field-control),
.proxy-security-body :deep(.ui-input) {
    width: 100%;
    min-width: 0;
}
.proxy-security-textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    background: var(--surface);
}
.proxy-security-body h3 {
    margin: 0;
}
.proxy-security-wrap {
    overflow-wrap: anywhere;
}
.proxy-security-audit-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 260px;
    overflow-y: auto;
}
.proxy-security-audit-entry {
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
}
.proxy-security-audit-entry pre {
    margin: 4px 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
