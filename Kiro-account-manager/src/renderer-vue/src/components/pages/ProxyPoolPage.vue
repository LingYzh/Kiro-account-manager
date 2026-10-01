<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useVirtualizer } from '@tanstack/vue-virtual'
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
    UiSwitch,
    confirmDialog
} from '@lingyzh/ui'
import { Activity, Network, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import { IP_DETECT_ENDPOINTS } from '@shared/types/proxy'
import { useTranslation } from '../../composables/useTranslation'
import { useAccountsStore } from '../../stores/accounts'
import { useProxyPoolStore } from '../../stores/proxyPool'
import { toIpcData } from '../../lib/ipcData'
import { computePoolHealth, filterProxies } from '../../lib/proxyPoolPresentation'
import ProxyPoolRow from '../proxyPool/ProxyPoolRow.vue'

const accountsStore = useAccountsStore()
const poolStore = useProxyPoolStore()
const { accounts } = storeToRefs(accountsStore)
const { proxyPool, proxyPoolConfig, accountProxyBindings } = storeToRefs(poolStore)
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const proxies = computed(() => [...proxyPool.value.values()])
const health = computed(() => computePoolHealth(proxies.value))
const statusLabels = computed(() => ({
    alive: text('可用', 'Alive'),
    slow: text('较慢', 'Slow'),
    dead: text('失效', 'Dead'),
    untested: text('未测试', 'Untested'),
    testing: text('测试中', 'Testing')
}))
const filters = ref({
    text: '',
    status: 'all',
    protocol: 'all',
    enabled: 'all',
    latency: 'all',
    testedWithin: 'all'
})
const filtered = computed(() => filterProxies(proxies.value, filters.value))
const advancedCount = computed(
    () =>
        ['protocol', 'enabled', 'latency', 'testedWithin'].filter(
            (key) => filters.value[key] !== 'all'
        ).length
)
const selectedIds = ref(new Set())
const selectedCount = computed(() => selectedIds.value.size)
const singleInput = ref('')
const bulkInput = ref('')
const bulkOpen = ref(false)
const advancedOpen = ref(false)
const bindingOpen = ref(false)
const testConcurrency = ref(10)
const accountsPerProxy = ref(5)
const validating = ref(false)
const autoValidating = ref(false)
const testingIds = ref(new Set())
const chainDiagnosing = ref(false)
const chainDiagnose = ref(null)
const feedback = ref('')
const error = ref('')
let alive = true
let autoTimer
let lastAutoValidate = 0

const strategyOptions = [
    {
        value: 'round_robin',
        zh: '轮询',
        en: 'Round Robin',
        descZh: '依次使用每个代理',
        descEn: 'Use each proxy in sequence'
    },
    { value: 'random', zh: '随机', en: 'Random', descZh: '随机挑选', descEn: 'Pick randomly' },
    {
        value: 'least_used',
        zh: '最少使用',
        en: 'Least Used',
        descZh: '使用次数少的优先',
        descEn: 'Prefer proxies used less'
    },
    {
        value: 'fastest',
        zh: '最快优先',
        en: 'Fastest',
        descZh: '按延迟升序',
        descEn: 'Sort by latency'
    }
]
const endpointId = computed(
    () =>
        IP_DETECT_ENDPOINTS.find((endpoint) => endpoint.url === proxyPoolConfig.value.testUrl)
            ?.id || '_custom'
)
const bindingStats = computed(() => {
    const all = [...accounts.value.values()]
    const totalActive = all.filter((account) => account.status === 'active').length
    const boundCount = Object.keys(accountProxyBindings.value).filter((id) =>
        accounts.value.has(id)
    ).length
    const candidates = proxies.value.filter((proxy) => proxy.enabled && proxy.status !== 'dead')
    const perProxy = {}
    for (const [accountId, proxyId] of Object.entries(accountProxyBindings.value)) {
        if (accounts.value.has(accountId)) perProxy[proxyId] = (perProxy[proxyId] || 0) + 1
    }
    const overloaded = Object.entries(perProxy)
        .filter(([, count]) => count > 10)
        .map(([proxyId, count]) => ({ proxyId, count, proxy: proxyPool.value.get(proxyId) }))
    return {
        totalActive,
        boundCount,
        unboundCount: totalActive - boundCount,
        candidateCount: candidates.length,
        candidates,
        perProxy,
        overloaded
    }
})
const scrollElement = ref(null)
const virtualizer = useVirtualizer(
    computed(() => ({
        count: filtered.value.length >= 50 ? filtered.value.length : 0,
        getScrollElement: () => scrollElement.value,
        estimateSize: () => 58,
        overscan: 10,
        getItemKey: (index) => filtered.value[index]?.id || index
    }))
)
const visibleRows = computed(() => virtualizer.value.getVirtualItems())
let observer
let measureFrame = 0

function text(zh, en) {
    return isEn.value ? en : zh
}
function setConfig(patch) {
    poolStore.setProxyPoolConfig(patch)
}
function setNumberConfig(key, value, minimum) {
    const number = parseInt(value, 10)
    if (!Number.isNaN(number) && number >= minimum) setConfig({ [key]: number })
}
function setEndpoint(id) {
    const endpoint = IP_DETECT_ENDPOINTS.find((item) => item.id === id)
    if (endpoint) setConfig({ testUrl: endpoint.url })
}
function resetAdvanced() {
    filters.value = {
        ...filters.value,
        protocol: 'all',
        enabled: 'all',
        latency: 'all',
        testedWithin: 'all'
    }
}
function clearFilters() {
    filters.value = {
        text: '',
        status: 'all',
        protocol: 'all',
        enabled: 'all',
        latency: 'all',
        testedWithin: 'all'
    }
}
function toggleSelection(id) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
}
function toggleSelectAll() {
    selectedIds.value =
        selectedIds.value.size === filtered.value.length && filtered.value.length
            ? new Set()
            : new Set(filtered.value.map((proxy) => proxy.id))
}
function addSingle() {
    const value = singleInput.value.trim()
    if (!value) return
    const id = poolStore.addProxy(value)
    if (id) {
        singleInput.value = ''
        error.value = ''
    } else error.value = text('代理 URL 无效或重复', 'Invalid proxy URL or duplicate')
}
function importBulk() {
    if (!bulkInput.value.trim()) return
    const result = poolStore.importProxies(bulkInput.value)
    feedback.value = text(
        `导入完成：新增 ${result.added}，跳过 ${result.skipped}，失败 ${result.failed}`,
        `Imported: added ${result.added}, skipped ${result.skipped}, failed ${result.failed}`
    )
    bulkInput.value = ''
    bulkOpen.value = false
}
function closeBulk() {
    bulkInput.value = ''
    bulkOpen.value = false
}
async function validateBatch(ids) {
    if (!alive || validating.value || autoValidating.value || !ids.length) return
    validating.value = true
    error.value = ''
    try {
        await poolStore.validateProxiesBatch(ids, testConcurrency.value)
    } catch (cause) {
        if (alive) error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (alive) validating.value = false
    }
}
function validateAll() {
    return validateBatch(filtered.value.map((proxy) => proxy.id))
}
function validateSelected() {
    return validateBatch([...selectedIds.value])
}
async function validateOne(id) {
    if (!alive || testingIds.value.has(id) || validating.value || autoValidating.value) return
    testingIds.value = new Set([...testingIds.value, id])
    error.value = ''
    try {
        const result = await poolStore.validateProxy(id)
        if (alive && !result.success)
            error.value = result.error || text('验活失败', 'Validation failed')
    } catch (cause) {
        if (alive) error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (alive) {
            const next = new Set(testingIds.value)
            next.delete(id)
            testingIds.value = next
        }
    }
}
function toggleProxy(id) {
    poolStore.toggleProxyEnabled(id)
}
function removeOne(id) {
    poolStore.removeProxy(id)
    const next = new Set(selectedIds.value)
    next.delete(id)
    selectedIds.value = next
}
function saveLabel(id, label) {
    poolStore.updateProxy(id, { label })
}
async function deleteSelected() {
    if (!selectedIds.value.size) return
    const ids = [...selectedIds.value]
    const confirmed = await confirmDialog({
        title: text('删除选中代理？', 'Delete selected proxies?'),
        message: text(`确定删除 ${ids.length} 个代理？`, `Delete ${ids.length} proxies?`),
        tone: 'danger'
    })
    if (!alive || !confirmed) return
    poolStore.removeProxies(ids)
    selectedIds.value = new Set()
}
async function removeDead() {
    const ids = proxies.value.filter((proxy) => proxy.status === 'dead').map((proxy) => proxy.id)
    if (!ids.length) return
    const confirmed = await confirmDialog({
        title: text('移除失效代理？', 'Remove dead proxies?'),
        message: text(`确定移除 ${ids.length} 个失效代理？`, `Remove ${ids.length} dead proxies?`),
        tone: 'danger'
    })
    if (alive && confirmed) poolStore.removeProxies(ids)
}
async function clearPool() {
    if (!proxies.value.length) return
    const confirmed = await confirmDialog({
        title: text('清空所有代理？', 'Clear all proxies?'),
        message: text('确定清空所有代理？', 'Clear all proxies?'),
        tone: 'danger'
    })
    if (alive && confirmed) {
        poolStore.clearProxyPool()
        selectedIds.value = new Set()
    }
}
function distribute(onlyUnbound) {
    if (!bindingStats.value.candidateCount) {
        error.value = text(
            '没有可用代理，请先验活代理',
            'No available proxies. Validate proxies first.'
        )
        return
    }
    const ids = [...accounts.value.values()]
        .filter((account) => account.status === 'active')
        .map((account) => account.id)
    if (!ids.length) {
        error.value = text('没有可用账号', 'No active accounts')
        return
    }
    const result = poolStore.autoDistributeAccountsToProxies({
        accountsPerProxy: accountsPerProxy.value,
        onlyUnbound,
        accountIds: ids
    })
    feedback.value = text(
        `已分配 ${result.distributed} 个账号，跳过 ${result.skipped}`,
        `Distributed ${result.distributed} accounts, skipped ${result.skipped}`
    )
}
async function clearBindings() {
    if (!bindingStats.value.boundCount) return
    const confirmed = await confirmDialog({
        title: text('解绑全部账号？', 'Unbind all accounts?'),
        message: text(
            `解绑全部 ${bindingStats.value.boundCount} 个账号？`,
            `Unbind all ${bindingStats.value.boundCount} accounts?`
        ),
        tone: 'danger'
    })
    if (alive && confirmed) poolStore.clearAccountProxyBindings()
}
function unbindOne(id) {
    poolStore.unbindAccountFromProxy(id)
}
async function diagnoseChain() {
    if (!alive || chainDiagnosing.value || !proxyPoolConfig.value.upstreamProxy?.trim()) return
    const target = proxies.value.find((proxy) => proxy.enabled) || proxies.value[0]
    if (!target) return
    chainDiagnosing.value = true
    chainDiagnose.value = null
    try {
        const result = await window.api.proxyPoolDiagnoseChain(
            toIpcData({
                targetUrl: target.url,
                upstreamProxy: proxyPoolConfig.value.upstreamProxy.trim()
            })
        )
        if (alive) chainDiagnose.value = { targetUrl: target.url, ...result }
    } catch (cause) {
        if (alive)
            chainDiagnose.value = {
                targetUrl: target.url,
                success: false,
                error: cause instanceof Error ? cause.message : String(cause)
            }
    } finally {
        if (alive) chainDiagnosing.value = false
    }
}
async function autoValidateTick() {
    if (!alive || validating.value || autoValidating.value || testingIds.value.size) return
    const minutes = proxyPoolConfig.value.autoValidateIntervalMin
    if (!minutes || minutes <= 0 || Date.now() - lastAutoValidate < minutes * 60000) return
    const ids = proxies.value.filter((proxy) => proxy.enabled).map((proxy) => proxy.id)
    if (!ids.length) return
    lastAutoValidate = Date.now()
    autoValidating.value = true
    try {
        await poolStore.validateProxiesBatch(
            ids,
            proxyPoolConfig.value.autoValidateConcurrency || 5
        )
    } catch (cause) {
        if (alive) error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (alive) autoValidating.value = false
    }
}
function syncVirtualLayout() {
    cancelAnimationFrame(measureFrame)
    measureFrame = requestAnimationFrame(() => {
        if (alive) virtualizer.value.measure()
    })
}
function measure(element) {
    if (element) virtualizer.value.measureElement(element)
}
watch(
    () => filtered.value.length,
    () => nextTick(syncVirtualLayout)
)
watch(scrollElement, (element, previous) => {
    if (previous) observer?.unobserve(previous)
    if (element) {
        observer?.observe(element)
        nextTick(syncVirtualLayout)
    }
})
onMounted(() => {
    autoTimer = setInterval(autoValidateTick, 60000)
    observer = new ResizeObserver(syncVirtualLayout)
    if (scrollElement.value) observer.observe(scrollElement.value)
})
onBeforeUnmount(() => {
    alive = false
    clearInterval(autoTimer)
    observer?.disconnect()
    cancelAnimationFrame(measureFrame)
})
</script>

<template>
    <div class="kam-page proxy-pool-page" data-testid="page-proxyPool">
        <header class="kam-page-header">
            <div class="proxy-pool-heading">
                <Network :size="20" />
                <h1>{{ text('代理池', 'Proxy Pool') }}</h1>
            </div>
            <p class="kam-muted">
                {{
                    text(
                        '注册批量任务的 IP 轮换池。降低同 IP 多账号关联风控。',
                        'IP rotation pool for registration tasks.'
                    )
                }}
            </p>
        </header>

        <UiAlert v-if="error" tone="error" data-testid="proxy-pool-error">{{ error }}</UiAlert>
        <UiAlert v-if="feedback" tone="success" data-testid="proxy-pool-feedback">{{
            feedback
        }}</UiAlert>

        <UiCard v-if="health.total" density="compact" data-testid="proxy-health">
            <div class="proxy-pool-section">
                <h2 class="ui-card-title">
                    <Activity :size="17" />{{ text('代理池健康看板', 'Pool Health Dashboard') }}
                </h2>
                <div class="proxy-pool-stats">
                    <div>
                        <span class="kam-muted">{{ text('总数 / 已启用', 'Total / Enabled') }}</span
                        ><strong>{{ health.total }} / {{ health.enabled }}</strong>
                    </div>
                    <div>
                        <span class="kam-muted">{{ text('可用率', 'Availability') }}</span
                        ><strong
                            >{{
                                Math.round(((health.alive + health.slow) / health.total) * 100)
                            }}%</strong
                        ><small
                            >{{ health.alive + health.slow }} {{ text('可用', 'available') }}</small
                        >
                    </div>
                    <div>
                        <span class="kam-muted">{{ text('成功率', 'Success Rate') }}</span
                        ><strong>{{
                            health.successRate === null
                                ? '—'
                                : `${Math.round(health.successRate * 100)}%`
                        }}</strong
                        ><small>{{ health.totalSuccess }} / {{ health.totalUsed }}</small>
                    </div>
                    <div>
                        <span class="kam-muted">{{ text('平均延迟', 'Avg Latency') }}</span
                        ><strong>{{
                            health.avgLatencyMs === null ? '—' : `${health.avgLatencyMs}ms`
                        }}</strong>
                    </div>
                    <div>
                        <span class="kam-muted">{{ text('失效', 'Dead') }}</span
                        ><strong>{{ health.dead }}</strong>
                    </div>
                    <div>
                        <span class="kam-muted">{{ text('未测试', 'Untested') }}</span
                        ><strong>{{ health.untested + health.testing }}</strong>
                    </div>
                </div>
                <div
                    v-if="health.topUsed.length"
                    class="proxy-pool-top"
                    data-testid="proxy-top-used"
                >
                    <p class="kam-muted">
                        {{
                            text(
                                `承担量 Top ${health.topUsed.length}`,
                                `Top ${health.topUsed.length} most used proxies`
                            )
                        }}
                    </p>
                    <div v-for="entry in health.topUsed" :key="entry.id" class="proxy-pool-top-row">
                        <div class="kam-actions">
                            <UiBadge
                                :tone="
                                    entry.status === 'dead'
                                        ? 'error'
                                        : entry.status === 'slow'
                                          ? 'warning'
                                          : 'neutral'
                                "
                                dense
                                >{{ statusLabels[entry.status] }}</UiBadge
                            ><span class="kam-mono">{{ entry.label }}</span
                            ><span
                                >{{ entry.success }}/{{ entry.used }} ·
                                {{
                                    entry.rate === null ? '—' : `${Math.round(entry.rate * 100)}%`
                                }}</span
                            >
                        </div>
                        <UiProgress
                            :value="entry.rate === null ? 0 : entry.rate * 100"
                            :tone="
                                entry.rate === null
                                    ? 'neutral'
                                    : entry.rate >= 0.8
                                      ? 'success'
                                      : entry.rate >= 0.5
                                        ? 'warning'
                                        : 'error'
                            "
                            dense
                            :label="entry.label"
                        />
                    </div>
                </div>
            </div>
        </UiCard>
        <UiCard density="compact" data-testid="proxy-configuration">
            <div class="proxy-pool-section">
                <h2 class="ui-card-title">{{ text('池配置', 'Pool Configuration') }}</h2>
                <label class="kam-actions"
                    ><UiSwitch
                        :model-value="proxyPoolConfig.enabled"
                        data-testid="proxy-config-enabled"
                        @update:model-value="setConfig({ enabled: $event })"
                    /><span>{{
                        text('为注册流程启用代理池', 'Enable proxy pool for registration')
                    }}</span></label
                >
                <p class="kam-muted">
                    {{
                        text(
                            '开启后，每个注册任务按策略自动选取可用代理。',
                            'Each registration task picks an available proxy using the selected strategy.'
                        )
                    }}
                </p>
                <UiField :label="text('调度策略', 'Selection Strategy')">
                    <div class="kam-actions">
                        <UiButton
                            v-for="option in strategyOptions"
                            :key="option.value"
                            :variant="
                                proxyPoolConfig.strategy === option.value ? 'secondary' : 'ghost'
                            "
                            :title="isEn ? option.descEn : option.descZh"
                            :data-testid="`proxy-strategy-${option.value}`"
                            @click="setConfig({ strategy: option.value })"
                            >{{ isEn ? option.en : option.zh }}</UiButton
                        >
                    </div>
                </UiField>
                <div class="kam-grid">
                    <UiField :label="text('失败自动停用', 'Auto-disable on failure')"
                        ><UiSwitch
                            :model-value="proxyPoolConfig.autoDisableDead"
                            data-testid="proxy-config-auto-disable"
                            @update:model-value="setConfig({ autoDisableDead: $event })"
                    /></UiField>
                    <UiField :label="text('失败阈值', 'Failure threshold')"
                        ><UiInput
                            type="number"
                            min="1"
                            max="20"
                            :model-value="proxyPoolConfig.failureThreshold"
                            data-testid="proxy-config-failure-threshold"
                            @update:model-value="setNumberConfig('failureThreshold', $event, 1)"
                    /></UiField>
                    <UiField :label="text('启动时验活', 'Validate on startup')"
                        ><UiSwitch
                            :model-value="proxyPoolConfig.validateOnStartup"
                            data-testid="proxy-config-startup"
                            @update:model-value="setConfig({ validateOnStartup: $event })"
                    /></UiField>
                    <UiField :label="text('测试超时 (ms)', 'Test timeout (ms)')"
                        ><UiInput
                            type="number"
                            min="1"
                            :model-value="proxyPoolConfig.testTimeoutMs"
                            data-testid="proxy-config-timeout"
                            @update:model-value="setNumberConfig('testTimeoutMs', $event, 1)"
                    /></UiField>
                    <UiField
                        :label="
                            text(
                                '定时自动验活（分钟，0=关闭）',
                                'Auto-validate interval (min, 0=off)'
                            )
                        "
                        ><UiInput
                            type="number"
                            min="0"
                            max="1440"
                            :model-value="proxyPoolConfig.autoValidateIntervalMin"
                            data-testid="proxy-config-interval"
                            @update:model-value="
                                setNumberConfig('autoValidateIntervalMin', $event, 0)
                            "
                    /></UiField>
                    <UiField :label="text('自动验活并发', 'Auto-validate concurrency')"
                        ><UiInput
                            type="number"
                            min="1"
                            max="50"
                            :disabled="proxyPoolConfig.autoValidateIntervalMin === 0"
                            :model-value="proxyPoolConfig.autoValidateConcurrency"
                            data-testid="proxy-config-concurrency"
                            @update:model-value="
                                setNumberConfig('autoValidateConcurrency', $event, 1)
                            "
                    /></UiField>
                </div>
                <UiField :label="text('IP 检测端点', 'IP Detection Endpoint')">
                    <div class="proxy-pool-endpoint">
                        <UiSelect
                            :model-value="endpointId"
                            data-testid="proxy-endpoint"
                            @update:model-value="setEndpoint($event)"
                            ><option
                                v-for="endpoint in IP_DETECT_ENDPOINTS"
                                :key="endpoint.id"
                                :value="endpoint.id"
                            >
                                {{ endpoint.label }}
                            </option>
                            <option value="_custom">
                                {{ text('自定义…', 'Custom…') }}
                            </option></UiSelect
                        >
                        <UiInput
                            :model-value="proxyPoolConfig.testUrl"
                            class="kam-mono"
                            data-testid="proxy-config-test-url"
                            @update:model-value="setConfig({ testUrl: $event })"
                        />
                    </div>
                </UiField>
                <UiField :label="text('上游中转代理（代理链）', 'Upstream relay proxy')">
                    <div class="proxy-pool-endpoint">
                        <UiInput
                            :model-value="proxyPoolConfig.upstreamProxy || ''"
                            class="kam-mono"
                            :placeholder="
                                text(
                                    '如 socks5://127.0.0.1:7890（留空=关闭）',
                                    'e.g. socks5://127.0.0.1:7890 (empty=off)'
                                )
                            "
                            data-testid="proxy-config-upstream"
                            @update:model-value="setConfig({ upstreamProxy: $event })"
                        />
                        <UiButton
                            :disabled="
                                !proxyPoolConfig.upstreamProxy?.trim() ||
                                !proxies.length ||
                                chainDiagnosing
                            "
                            :loading="chainDiagnosing"
                            data-testid="proxy-chain-diagnose"
                            @click="diagnoseChain"
                            >{{ text('诊断', 'Diagnose') }}</UiButton
                        >
                    </div>
                </UiField>
                <p class="kam-muted">
                    {{
                        text(
                            '链路：本机 → 上游中转 → 目标代理 → 目标站点。支持 HTTP/SOCKS5。',
                            'Route: local → relay → target proxy → site. Supports HTTP/SOCKS5.'
                        )
                    }}
                </p>
                <UiAlert
                    v-if="chainDiagnose && !chainDiagnose.success"
                    tone="error"
                    data-testid="proxy-chain-error"
                    >{{ chainDiagnose.error || text('诊断失败', 'Diagnosis failed') }}</UiAlert
                >
                <div
                    v-if="chainDiagnose?.success && chainDiagnose.diagnose"
                    class="proxy-chain-stages"
                    data-testid="proxy-chain-results"
                >
                    <span class="kam-mono kam-muted">{{
                        chainDiagnose.targetUrl.replace(/:([^:@/]+)@/, ':***@')
                    }}</span>
                    <div
                        v-for="stage in [
                            {
                                key: 'upstream',
                                ok: chainDiagnose.diagnose.upstreamReachable,
                                rt: chainDiagnose.diagnose.upstreamRtMs,
                                err: chainDiagnose.diagnose.upstreamError,
                                zh: 'A) 上游 TCP 可达',
                                en: 'A) Upstream TCP reachable'
                            },
                            {
                                key: 'target',
                                ok: chainDiagnose.diagnose.targetReachable,
                                rt: chainDiagnose.diagnose.targetRtMs,
                                err: chainDiagnose.diagnose.targetError,
                                zh: 'B) 经上游 → 目标代理入口',
                                en: 'B) Via upstream → target proxy'
                            },
                            {
                                key: 'end',
                                ok: chainDiagnose.diagnose.endToEndOk === true,
                                rt: chainDiagnose.diagnose.endToEndRtMs,
                                err: chainDiagnose.diagnose.endToEndError,
                                zh: 'C) 端到端 CONNECT',
                                en: 'C) End-to-end CONNECT'
                            }
                        ]"
                        :key="stage.key"
                        class="kam-actions"
                    >
                        <UiBadge :tone="stage.ok ? 'success' : 'error'" dense>{{
                            stage.ok ? '✓' : '✗'
                        }}</UiBadge
                        ><span>{{ isEn ? stage.en : stage.zh }}</span
                        ><span v-if="stage.rt !== undefined" class="kam-mono">{{ stage.rt }}ms</span
                        ><span v-if="stage.err" class="proxy-stage-error">{{ stage.err }}</span>
                    </div>
                    <p v-if="chainDiagnose.diagnose.targetStatus !== undefined">
                        {{ text('状态', 'Status') }} {{ chainDiagnose.diagnose.targetStatus }}
                        {{ chainDiagnose.diagnose.targetStatusText }}
                    </p>
                    <p v-if="chainDiagnose.diagnose.targetBodySnippet" class="kam-mono">
                        {{ chainDiagnose.diagnose.targetBodySnippet.slice(0, 160) }}
                    </p>
                </div>
            </div>
        </UiCard>

        <UiCard density="compact" data-testid="proxy-add-section">
            <div class="proxy-pool-section">
                <h2 class="ui-card-title">{{ text('添加代理', 'Add Proxies') }}</h2>
                <div class="proxy-pool-endpoint">
                    <UiInput
                        v-model="singleInput"
                        class="kam-mono"
                        :placeholder="
                            text(
                                'http://user:pass@host:port 或 host:port',
                                'http://user:pass@host:port or host:port'
                            )
                        "
                        data-testid="proxy-add-input"
                        @keydown.enter="addSingle"
                    />
                    <UiButton
                        :disabled="!singleInput.trim()"
                        data-testid="proxy-add-submit"
                        @click="addSingle"
                        ><Plus :size="16" />{{ text('添加', 'Add') }}</UiButton
                    >
                    <UiButton
                        variant="secondary"
                        data-testid="proxy-bulk-open"
                        @click="bulkOpen = !bulkOpen"
                        >{{ text('批量', 'Bulk') }}</UiButton
                    >
                </div>
                <div v-if="bulkOpen" class="proxy-pool-bulk" data-testid="proxy-bulk-panel">
                    <p class="kam-muted">
                        {{
                            text(
                                '每行一个代理。支持 http(s)://、user:pass@host:port、host:port:user:pass、socks5://。',
                                'One proxy per line. Supports http(s)://, user:pass@host:port, host:port:user:pass, socks5://.'
                            )
                        }}
                    </p>
                    <textarea
                        v-model="bulkInput"
                        rows="5"
                        class="proxy-pool-textarea kam-mono"
                        data-testid="proxy-bulk-input"
                    />
                    <div class="kam-actions">
                        <UiButton
                            variant="ghost"
                            data-testid="proxy-bulk-cancel"
                            @click="closeBulk"
                            >{{ text('取消', 'Cancel') }}</UiButton
                        ><UiButton
                            :disabled="!bulkInput.trim()"
                            data-testid="proxy-bulk-submit"
                            @click="importBulk"
                            >{{ text('导入', 'Import') }}</UiButton
                        >
                    </div>
                </div>
            </div>
        </UiCard>

        <UiCard density="compact" data-testid="proxy-toolbar-section">
            <div class="proxy-pool-section">
                <div class="kam-actions">
                    <UiBadge dense>{{ text('总计', 'Total') }} {{ health.total }}</UiBadge>
                    <UiBadge tone="success" dense
                        >{{ text('可用', 'Alive') }} {{ health.alive }}</UiBadge
                    >
                    <UiBadge tone="warning" dense
                        >{{ text('较慢', 'Slow') }} {{ health.slow }}</UiBadge
                    >
                    <UiBadge tone="error" dense
                        >{{ text('失效', 'Dead') }} {{ health.dead }}</UiBadge
                    >
                    <UiBadge dense>{{ text('未测试', 'Untested') }} {{ health.untested }}</UiBadge>
                    <span class="kam-muted"
                        >{{ health.enabled }} {{ text('已启用', 'enabled') }}</span
                    >
                </div>
                <div class="kam-actions">
                    <UiInput
                        :model-value="filters.text"
                        class="proxy-pool-search"
                        :placeholder="
                            text(
                                '搜索 host/端口/协议/user/邮箱/备注/URL',
                                'Search host/port/protocol/user/email/note/URL'
                            )
                        "
                        data-testid="proxy-filter-search"
                        @update:model-value="filters.text = $event"
                    />
                    <UiSelect v-model="filters.status" data-testid="proxy-filter-status"
                        ><option value="all">{{ text('全部状态', 'All statuses') }}</option>
                        <option value="alive">{{ text('可用', 'Alive') }}</option>
                        <option value="slow">{{ text('较慢', 'Slow') }}</option>
                        <option value="dead">{{ text('失效', 'Dead') }}</option>
                        <option value="untested">{{ text('未测试', 'Untested') }}</option>
                        <option value="testing">{{ text('测试中', 'Testing') }}</option></UiSelect
                    >
                    <UiButton
                        :variant="advancedOpen || advancedCount ? 'secondary' : 'ghost'"
                        data-testid="proxy-filter-advanced"
                        @click="advancedOpen = !advancedOpen"
                        >{{ text('高级', 'Advanced')
                        }}<UiBadge v-if="advancedCount" dense>{{
                            advancedCount
                        }}</UiBadge></UiButton
                    >
                    <UiButton
                        v-if="filters.text || filters.status !== 'all' || advancedCount"
                        variant="ghost"
                        data-testid="proxy-filter-clear-all"
                        @click="clearFilters"
                        >{{ text('清空', 'Clear') }}</UiButton
                    >
                </div>
                <div class="kam-actions">
                    <UiButton
                        :disabled="validating || autoValidating || !filtered.length"
                        :loading="validating"
                        data-testid="proxy-test-all"
                        @click="validateAll"
                        ><RefreshCw :size="16" />{{
                            text(`全部测试 (${filtered.length})`, `Test All (${filtered.length})`)
                        }}</UiButton
                    >
                    <UiButton
                        v-if="selectedCount"
                        :disabled="validating || autoValidating"
                        data-testid="proxy-test-selected"
                        @click="validateSelected"
                        >{{
                            text(`测试选中 (${selectedCount})`, `Test Selected (${selectedCount})`)
                        }}</UiButton
                    >
                    <UiButton
                        v-if="selectedCount"
                        variant="danger"
                        data-testid="proxy-delete-selected"
                        @click="deleteSelected"
                        >{{
                            text(`删除 (${selectedCount})`, `Delete (${selectedCount})`)
                        }}</UiButton
                    >
                    <UiButton
                        variant="ghost"
                        :disabled="!health.dead"
                        data-testid="proxy-remove-dead"
                        @click="removeDead"
                        >{{ text('移除失效', 'Remove Dead') }}</UiButton
                    >
                    <UiButton
                        variant="ghost"
                        :disabled="!proxies.length"
                        data-testid="proxy-clear-all"
                        @click="clearPool"
                        ><Trash2 :size="16" />{{ text('清空', 'Clear All') }}</UiButton
                    >
                    <UiField :label="text('并发', 'Concurrency')"
                        ><UiInput
                            type="number"
                            min="1"
                            max="50"
                            :model-value="testConcurrency"
                            data-testid="proxy-test-concurrency"
                            @update:model-value="
                                !Number.isNaN(parseInt($event, 10)) && parseInt($event, 10) >= 1
                                    ? (testConcurrency = parseInt($event, 10))
                                    : undefined
                            "
                    /></UiField>
                </div>
                <div
                    v-if="advancedOpen"
                    class="proxy-pool-advanced"
                    data-testid="proxy-advanced-panel"
                >
                    <UiField :label="text('协议', 'Protocol')"
                        ><UiSelect v-model="filters.protocol" data-testid="proxy-filter-protocol"
                            ><option value="all">{{ text('全部', 'All') }}</option>
                            <option value="http">HTTP</option>
                            <option value="https">HTTPS</option>
                            <option value="socks5">SOCKS5</option>
                            <option value="socks4">SOCKS4</option></UiSelect
                        ></UiField
                    >
                    <UiField :label="text('启用', 'Enabled')"
                        ><UiSelect v-model="filters.enabled" data-testid="proxy-filter-enabled"
                            ><option value="all">{{ text('全部', 'All') }}</option>
                            <option value="enabled">{{ text('已启用', 'Enabled') }}</option>
                            <option value="disabled">
                                {{ text('已停用', 'Disabled') }}
                            </option></UiSelect
                        ></UiField
                    >
                    <UiField :label="text('延迟', 'Latency')"
                        ><UiSelect v-model="filters.latency" data-testid="proxy-filter-latency"
                            ><option value="all">{{ text('全部', 'All') }}</option>
                            <option value="fast">&lt; 200ms</option>
                            <option value="medium">200-999ms</option>
                            <option value="slow">≥ 1000ms</option>
                            <option value="unknown">{{ text('未知', 'Unknown') }}</option></UiSelect
                        ></UiField
                    >
                    <UiField :label="text('验证于', 'Tested')"
                        ><UiSelect v-model="filters.testedWithin" data-testid="proxy-filter-tested"
                            ><option value="all">{{ text('任意时间', 'Any time') }}</option>
                            <option value="1h">{{ text('最近 1 小时', 'Last 1h') }}</option>
                            <option value="1d">{{ text('最近 1 天', 'Last 1 day') }}</option>
                            <option value="7d">{{ text('最近 7 天', 'Last 7 days') }}</option>
                            <option value="never">
                                {{ text('从未测试', 'Never tested') }}
                            </option></UiSelect
                        ></UiField
                    >
                    <UiButton
                        v-if="advancedCount"
                        variant="ghost"
                        data-testid="proxy-filter-reset-advanced"
                        @click="resetAdvanced"
                        >{{ text('重置', 'Reset') }}</UiButton
                    >
                    <p class="kam-muted">
                        {{
                            text(
                                `匹配 ${filtered.length} / ${proxies.length}`,
                                `Matched ${filtered.length} of ${proxies.length}`
                            )
                        }}
                    </p>
                </div>
            </div>
        </UiCard>

        <UiCard density="compact" data-testid="proxy-bindings-section">
            <div class="proxy-pool-section">
                <h2 class="ui-card-title">
                    {{ text('反代分桶（账号绑定代理 IP）', 'Account-to-IP Bucketing') }}
                </h2>
                <p class="kam-muted">
                    {{
                        text(
                            '限制每 IP 账号数，避免被风控关联。',
                            'Limit accounts per IP to reduce association risk.'
                        )
                    }}
                </p>
                <div class="proxy-pool-stats proxy-pool-binding-stats">
                    <div>
                        <span class="kam-muted">{{ text('可用账号', 'Active Accounts') }}</span
                        ><strong>{{ bindingStats.totalActive }}</strong>
                    </div>
                    <div>
                        <span class="kam-muted">{{ text('已绑定', 'Bound') }}</span
                        ><strong>{{ bindingStats.boundCount }}</strong>
                    </div>
                    <div>
                        <span class="kam-muted">{{ text('未绑定', 'Unbound') }}</span
                        ><strong>{{ bindingStats.unboundCount }}</strong>
                    </div>
                    <div>
                        <span class="kam-muted">{{ text('可用代理', 'Available Proxies') }}</span
                        ><strong>{{ bindingStats.candidateCount }}</strong>
                    </div>
                </div>
                <UiAlert
                    v-if="bindingStats.overloaded.length"
                    tone="warning"
                    data-testid="proxy-overloaded"
                    >{{
                        text(
                            `${bindingStats.overloaded.length} 个代理承载超过 10 个账号，建议重新分配。`,
                            `${bindingStats.overloaded.length} proxies carry more than 10 accounts.`
                        )
                    }}</UiAlert
                >
                <div class="kam-actions">
                    <UiField
                        :label="text('每代理承载（0=均分）', 'Accounts per proxy (0=even split)')"
                        ><UiInput
                            type="number"
                            min="0"
                            max="50"
                            :model-value="accountsPerProxy"
                            data-testid="proxy-accounts-per-proxy"
                            @update:model-value="
                                !Number.isNaN(parseInt($event, 10)) && parseInt($event, 10) >= 0
                                    ? (accountsPerProxy = parseInt($event, 10))
                                    : undefined
                            "
                    /></UiField>
                    <UiButton
                        :disabled="!bindingStats.unboundCount"
                        data-testid="proxy-bind-unbound"
                        @click="distribute(true)"
                        >{{
                            text(
                                `自动绑定未分配 (${bindingStats.unboundCount})`,
                                `Auto-Bind Unbound (${bindingStats.unboundCount})`
                            )
                        }}</UiButton
                    >
                    <UiButton
                        variant="secondary"
                        data-testid="proxy-bind-all"
                        @click="distribute(false)"
                        >{{ text('重新分配全部', 'Re-Distribute All') }}</UiButton
                    >
                    <UiButton
                        variant="ghost"
                        :disabled="!bindingStats.boundCount"
                        data-testid="proxy-unbind-all"
                        @click="clearBindings"
                        >{{ text('解绑全部', 'Unbind All') }}</UiButton
                    >
                    <UiButton
                        variant="ghost"
                        data-testid="proxy-binding-details-toggle"
                        @click="bindingOpen = !bindingOpen"
                        >{{
                            bindingOpen
                                ? text('隐藏绑定明细', 'Hide binding details')
                                : text('显示绑定明细', 'Show binding details')
                        }}</UiButton
                    >
                </div>
                <div
                    v-if="bindingOpen"
                    class="proxy-pool-binding-details"
                    data-testid="proxy-binding-details"
                >
                    <div v-for="proxy in bindingStats.candidates" :key="proxy.id">
                        <template v-if="bindingStats.perProxy[proxy.id]">
                            <div class="kam-actions">
                                <strong class="kam-mono">{{ proxy.host }}:{{ proxy.port }}</strong
                                ><UiBadge dense
                                    >{{ bindingStats.perProxy[proxy.id] }}
                                    {{ text('账号', 'accounts') }}</UiBadge
                                >
                            </div>
                            <div class="kam-actions">
                                <span
                                    v-for="accountId in Object.keys(accountProxyBindings).filter(
                                        (id) => accountProxyBindings[id] === proxy.id
                                    )"
                                    :key="accountId"
                                    class="proxy-binding-chip"
                                    ><span>{{
                                        accounts.get(accountId)?.email || accountId.slice(0, 8)
                                    }}</span
                                    ><UiButton
                                        icon
                                        variant="ghost"
                                        dense
                                        :aria-label="text('解绑', 'Unbind')"
                                        :data-testid="`proxy-unbind-${accountId}`"
                                        @click="unbindOne(accountId)"
                                        >×</UiButton
                                    ></span
                                >
                            </div>
                        </template>
                    </div>
                    <p v-if="bindingStats.unboundCount > 0" class="kam-muted">
                        {{
                            text(
                                `${bindingStats.unboundCount} 个账号未绑定代理（将走全局代理 / 直连）。`,
                                `${bindingStats.unboundCount} accounts have no proxy binding.`
                            )
                        }}
                    </p>
                    <p v-if="!bindingStats.boundCount" class="kam-muted">
                        {{ text('尚无绑定。', 'No bindings yet.') }}
                    </p>
                </div>
            </div>
        </UiCard>

        <UiCard density="compact" data-testid="proxy-list-section">
            <div class="proxy-pool-section">
                <h2 class="ui-card-title">{{ text('代理列表', 'Proxies') }}</h2>
                <div v-if="filtered.length" class="proxy-pool-table-wrap">
                    <div class="proxy-pool-table-head">
                        <UiCheckbox
                            :model-value="selectedCount === filtered.length && filtered.length > 0"
                            :aria-label="text('全选', 'Select all')"
                            data-testid="proxy-select-all"
                            @update:model-value="toggleSelectAll"
                        /><span>{{ text('启用', 'On') }}</span
                        ><span>URL</span><span>{{ text('状态', 'Status') }}</span
                        ><span>{{ text('使用', 'Used') }}</span
                        ><span>{{ text('失败', 'Failed') }}</span
                        ><span>{{ text('出口 IP / 邮箱', 'External IP / Email') }}</span
                        ><span>{{ text('操作', 'Actions') }}</span>
                    </div>
                    <div
                        v-if="filtered.length < 50"
                        class="proxy-pool-list-scroll"
                        data-testid="proxy-list"
                    >
                        <ProxyPoolRow
                            v-for="proxy in filtered"
                            :key="proxy.id"
                            :proxy="proxy"
                            :selected="selectedIds.has(proxy.id)"
                            :is-en="isEn"
                            @select="toggleSelection"
                            @toggle="toggleProxy"
                            @test="validateOne"
                            @delete="removeOne"
                            @save-label="saveLabel(proxy.id, $event)"
                        />
                    </div>
                    <div
                        v-else
                        ref="scrollElement"
                        class="proxy-pool-list-scroll"
                        data-testid="proxy-list-virtual"
                    >
                        <div
                            class="proxy-pool-virtual-space"
                            :style="{ height: `${virtualizer.getTotalSize()}px` }"
                        >
                            <div
                                v-for="row in visibleRows"
                                :key="row.key"
                                :ref="measure"
                                :data-index="row.index"
                                class="proxy-pool-virtual-row"
                                :style="{ transform: `translateY(${row.start}px)` }"
                            >
                                <ProxyPoolRow
                                    v-if="filtered[row.index]"
                                    :proxy="filtered[row.index]"
                                    :selected="selectedIds.has(filtered[row.index].id)"
                                    :is-en="isEn"
                                    @select="toggleSelection"
                                    @toggle="toggleProxy"
                                    @test="validateOne"
                                    @delete="removeOne"
                                    @save-label="saveLabel(filtered[row.index].id, $event)"
                                />
                            </div>
                        </div>
                    </div>
                </div>
                <p v-else class="kam-muted" data-testid="proxy-empty">
                    {{
                        proxies.length
                            ? text('当前筛选无匹配代理。', 'No proxies match the current filter.')
                            : text(
                                  '暂无代理。先添加一些代理。',
                                  'No proxies yet. Add some to begin.'
                              )
                    }}
                </p>
            </div>
        </UiCard>
    </div>
</template>

<style scoped>
.proxy-pool-page {
    min-width: 0;
}
.proxy-pool-heading {
    display: flex;
    align-items: center;
    gap: 8px;
}
.proxy-pool-heading h1 {
    margin: 0;
}
.proxy-pool-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
}
.proxy-pool-section .ui-card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
}
.proxy-pool-section :deep(.ui-field) {
    flex-direction: column;
    align-items: stretch;
}
.proxy-pool-section :deep(.ui-field-control),
.proxy-pool-section :deep(.ui-input) {
    width: 100%;
    min-width: 0;
}
.proxy-pool-stats {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 8px;
}
.proxy-pool-stats > div {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
}
.proxy-pool-stats strong {
    font-size: 18px;
}
.proxy-pool-stats small {
    color: var(--muted);
}
.proxy-pool-binding-stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
}
.proxy-pool-top,
.proxy-pool-top-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.proxy-pool-top-row .kam-mono {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
}
.proxy-pool-endpoint {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
}
.proxy-pool-endpoint :deep(.ui-select) {
    flex: 0 0 auto;
}
.proxy-pool-endpoint :deep(.ui-input) {
    flex: 1 1 200px;
}
.proxy-pool-bulk,
.proxy-chain-stages,
.proxy-pool-binding-details {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
}
.proxy-pool-textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 8px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
}
.proxy-pool-search {
    flex: 1 1 280px;
}
.proxy-pool-advanced {
    display: flex;
    align-items: end;
    flex-wrap: wrap;
    gap: 8px;
}
.proxy-pool-advanced :deep(.ui-field) {
    flex: 1 1 130px;
}
.proxy-pool-advanced p {
    flex-basis: 100%;
}
.proxy-stage-error {
    color: var(--red);
    overflow-wrap: anywhere;
}
.proxy-binding-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow-wrap: anywhere;
}
.proxy-pool-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
}
.proxy-pool-table-head {
    display: grid;
    grid-template-columns: 28px 50px minmax(240px, 1fr) 110px 55px 55px 135px 150px;
    align-items: center;
    gap: 8px;
    min-width: 900px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
}
.proxy-pool-list-scroll {
    max-height: 60vh;
    min-width: 900px;
    overflow-y: auto;
}
.proxy-pool-virtual-space {
    position: relative;
    min-width: 900px;
}
.proxy-pool-virtual-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
}
@media (max-width: 900px) {
    .proxy-pool-stats {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .proxy-pool-binding-stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
@media (max-width: 560px) {
    .proxy-pool-stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .proxy-pool-endpoint {
        flex-wrap: wrap;
    }
}
</style>
