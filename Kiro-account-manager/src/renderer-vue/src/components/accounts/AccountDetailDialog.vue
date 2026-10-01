<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiDialog,
    UiProgress,
    confirmDialog
} from '@lingyzh/ui'
import { RefreshCw } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { useSettingsStore } from '../../stores/settings'
import { useProxyPoolStore } from '../../stores/proxyPool'

const props = defineProps({
    open: { type: Boolean, required: true },
    account: { type: Object, default: null },
    isRefreshing: { type: Boolean, default: false }
})
const emit = defineEmits(['refresh', 'update:open'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const settings = useSettingsStore()
const proxyPool = useProxyPoolStore()
const models = ref([])
const modelsLoading = ref(false)
const modelsError = ref('')
const proxyListOpen = ref(false)
const proxyBusy = ref(false)
const proxyError = ref('')
let active = true
let modelGeneration = 0
let proxyGeneration = 0

const usage = computed(() => props.account?.usage || {})
const subscription = computed(() => props.account?.subscription || {})
const credentials = computed(() => props.account?.credentials || {})
const bonusTotal = computed(() =>
    (usage.value.bonuses || []).reduce((sum, bonus) => sum + bonus.limit, 0)
)
const bonusUsed = computed(() =>
    (usage.value.bonuses || []).reduce((sum, bonus) => sum + bonus.current, 0)
)
const boundId = computed(() => props.account && proxyPool.accountProxyBindings[props.account.id])
const boundProxy = computed(() => (boundId.value ? proxyPool.proxyPool.get(boundId.value) : null))
const aliveProxies = computed(() =>
    Array.from(proxyPool.proxyPool.values()).filter(
        (proxy) => proxy.enabled && proxy.status === 'alive'
    )
)

function formatUsage(value) {
    if (settings.usagePrecision) {
        return value.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        })
    }
    return Math.floor(value).toLocaleString()
}

function formatDate(date) {
    if (!date) return '-'
    try {
        if (typeof date === 'string') return date.split('T')[0]
        if (date instanceof Date) return date.toISOString().split('T')[0]
        return new Date(date).toISOString().split('T')[0]
    } catch {
        return String(date).split('T')[0]
    }
}

function formatDateTime(date) {
    if (!date) return '-'
    try {
        const value = date instanceof Date ? date : new Date(date)
        return value.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    } catch {
        return String(date)
    }
}

function compactTokens(value) {
    if (!value) return '-'
    if (value >= 1000000) return `${(value / 1000000).toFixed(0)}M`
    return `${(value / 1000).toFixed(0)}K`
}

function displayName(account) {
    if (account.nickname) return settings.maskNickname(account.nickname)
    if (account.email) return settings.maskEmail(account.email)
    if (account.userId) return settings.privacyMode ? '********' : account.userId
    return 'Unknown'
}

function requestClose() {
    if (!active || !props.open) return
    modelGeneration += 1
    proxyGeneration += 1
    modelsLoading.value = false
    proxyListOpen.value = false
    emit('update:open', false)
}

function loadModels(force = false) {
    if (!active || !props.open || !props.account) return
    if (modelsLoading.value && !force) return
    const account = props.account
    const current = ++modelGeneration
    models.value = []
    modelsError.value = ''
    if (!account.credentials?.accessToken) {
        modelsLoading.value = false
        return
    }
    modelsLoading.value = true
    Promise.resolve()
        .then(() => {
            if (!active || !props.open || current !== modelGeneration) return null
            return window.api.accountGetModels(
                account.credentials.accessToken,
                account.credentials.region,
                account.profileArn,
                account.machineId,
                account.credentials.provider || account.idp,
                account.credentials.authMethod,
                account.id
            )
        })
        .then((result) => {
            if (!active || !props.open || current !== modelGeneration || !result) return
            if (result.success) models.value = result.models || []
            else
                modelsError.value =
                    result.error || (isEn.value ? 'Failed to fetch models' : '获取模型失败')
        })
        .catch((cause) => {
            if (active && props.open && current === modelGeneration)
                modelsError.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (active && current === modelGeneration) modelsLoading.value = false
        })
}

function bindProxy(proxy) {
    if (
        !active ||
        !props.open ||
        !props.account ||
        proxyBusy.value ||
        !proxy.enabled ||
        proxy.status !== 'alive'
    )
        return
    try {
        proxyPool.bindAccountsToProxy([props.account.id], proxy.id)
        proxyListOpen.value = false
        proxyError.value = ''
    } catch (cause) {
        proxyError.value = cause instanceof Error ? cause.message : String(cause)
    }
}

function unbindProxy() {
    if (!active || !props.open || !props.account || !boundId.value || proxyBusy.value) return
    const accountId = props.account.id
    const current = ++proxyGeneration
    proxyBusy.value = true
    proxyError.value = ''
    confirmDialog({
        title: isEn.value ? 'Unbind proxy?' : '解绑代理？',
        message: isEn.value
            ? `Unbind ${props.account.email || accountId}?`
            : `解绑 ${props.account.email || accountId}？`,
        confirmText: isEn.value ? 'Unbind' : '解绑',
        cancelText: isEn.value ? 'Cancel' : '取消',
        tone: 'danger'
    })
        .then((confirmed) => {
            if (
                !active ||
                !props.open ||
                current !== proxyGeneration ||
                !confirmed ||
                props.account?.id !== accountId
            )
                return
            proxyPool.unbindAccountFromProxy(accountId)
        })
        .catch((cause) => {
            if (active && current === proxyGeneration)
                proxyError.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (active && current === proxyGeneration) proxyBusy.value = false
        })
}

watch(
    () => [
        props.open,
        props.account?.credentials?.accessToken,
        props.account?.credentials?.region,
        props.account?.profileArn,
        props.account?.machineId,
        props.account?.credentials?.provider,
        props.account?.idp,
        props.account?.credentials?.authMethod,
        props.account?.id
    ],
    () => {
        modelGeneration += 1
        proxyGeneration += 1
        proxyListOpen.value = false
        proxyBusy.value = false
        proxyError.value = ''
        if (props.open && props.account) loadModels(true)
        else {
            models.value = []
            modelsLoading.value = false
            modelsError.value = ''
        }
    },
    { immediate: true }
)
onBeforeUnmount(() => {
    active = false
    modelGeneration += 1
    proxyGeneration += 1
})
</script>

<template>
    <UiDialog
        :open="open && Boolean(account)"
        size="lg"
        scrollable
        :aria-label="isEn ? 'Account Details' : '账号详情'"
        :content-label="isEn ? 'Account details' : '账号详情内容'"
        @update:open="requestClose"
    >
        <template #header>
            <div v-if="account" class="detail-heading">
                <h2 class="ui-card-title">
                    {{ account.email ? settings.maskEmail(account.email) : displayName(account) }}
                </h2>
                <UiBadge tone="accent">{{ subscription.title || subscription.type }}</UiBadge>
                <span class="kam-muted"
                    >{{ account.idp }} · {{ isEn ? 'Added' : '添加于' }}
                    {{ formatDate(account.createdAt) }}</span
                >
            </div>
        </template>
        <div v-if="account" class="kam-dialog-content" data-testid="account-detail-dialog">
            <UiCard density="compact"
                ><div class="detail-section">
                    <div class="detail-heading">
                        <h3 class="ui-card-title">{{ isEn ? 'Quota Overview' : '配额总览' }}</h3>
                        <UiButton
                            size="sm"
                            :loading="isRefreshing"
                            data-testid="account-detail-refresh"
                            @click="emit('refresh')"
                        >
                            <RefreshCw :size="16" />{{ isEn ? 'Refresh' : '刷新数据' }}
                        </UiButton>
                    </div>
                    <div class="detail-heading">
                        <strong
                            >{{ formatUsage(usage.current || 0) }} /
                            {{ formatUsage(usage.limit || 0) }}</strong
                        >
                        <UiBadge :tone="(usage.percentUsed || 0) > 0.9 ? 'error' : 'success'">
                            {{
                                ((usage.percentUsed || 0) * 100).toFixed(
                                    settings.usagePrecision ? 2 : 1
                                )
                            }}% {{ isEn ? 'used' : '已使用' }}
                        </UiBadge>
                    </div>
                    <UiProgress
                        :value="(usage.percentUsed || 0) * 100"
                        :tone="(usage.percentUsed || 0) > 0.9 ? 'error' : 'accent'"
                        :label="isEn ? 'Total usage' : '总使用量'"
                    />
                    <div class="kam-field-grid">
                        <div>
                            <strong>{{ isEn ? 'Base' : '主配额' }}</strong>
                            <p>
                                {{ formatUsage(usage.baseCurrent ?? 0) }} /
                                {{ formatUsage(usage.baseLimit ?? 0) }}
                            </p>
                            <p class="kam-muted">
                                {{ formatDate(usage.nextResetDate) }} {{ isEn ? 'reset' : '重置' }}
                            </p>
                        </div>
                        <div>
                            <strong>{{ isEn ? 'Trial' : '免费试用' }}</strong>
                            <p>
                                {{ formatUsage(usage.freeTrialCurrent ?? 0) }} /
                                {{ formatUsage(usage.freeTrialLimit ?? 0) }}
                            </p>
                            <p class="kam-muted">
                                {{
                                    usage.freeTrialExpiry
                                        ? formatDate(usage.freeTrialExpiry)
                                        : isEn
                                          ? 'No trial'
                                          : '无试用额度'
                                }}
                            </p>
                        </div>
                        <div>
                            <strong>{{ isEn ? 'Bonus' : '奖励总计' }}</strong>
                            <p>{{ formatUsage(bonusUsed) }} / {{ formatUsage(bonusTotal) }}</p>
                            <p class="kam-muted">
                                {{ usage.bonuses?.length ?? 0 }}
                                {{ isEn ? 'active' : '个生效奖励' }}
                            </p>
                        </div>
                    </div>
                </div></UiCard
            >

            <UiCard v-if="usage.bonuses?.length" density="compact"
                ><div class="detail-section">
                    <h3 class="ui-card-title">{{ isEn ? 'Active Bonuses' : '生效奖励明细' }}</h3>
                    <div v-for="bonus in usage.bonuses" :key="bonus.code" class="detail-row">
                        <div>
                            <strong>{{ bonus.name }}</strong>
                            <p class="kam-muted kam-mono">
                                {{ bonus.code }} · {{ formatDateTime(bonus.expiresAt) }}
                                {{ isEn ? 'expires' : '过期' }}
                            </p>
                        </div>
                        <div>
                            <strong
                                >{{ formatUsage(bonus.current) }} /
                                {{ formatUsage(bonus.limit) }}</strong
                            >
                            <p class="kam-muted">
                                {{ isEn ? 'Used' : '已用' }}
                                {{
                                    ((bonus.current / bonus.limit) * 100).toFixed(
                                        settings.usagePrecision ? 2 : 0
                                    )
                                }}%
                            </p>
                        </div>
                    </div>
                </div></UiCard
            >

            <div class="kam-grid">
                <UiCard density="compact"
                    ><div class="detail-section">
                        <h3 class="ui-card-title">{{ isEn ? 'Basic Info' : '基本信息' }}</h3>
                        <div>
                            <span class="kam-muted">{{ isEn ? 'Email/ID' : '邮箱/ID' }}</span>
                            <p class="kam-mono">
                                {{
                                    account.email
                                        ? settings.maskEmail(account.email)
                                        : displayName(account)
                                }}
                            </p>
                        </div>
                        <div>
                            <span class="kam-muted">{{ isEn ? 'Nickname' : '账号别名' }}</span>
                            <p>{{ settings.maskNickname(account.nickname) || '-' }}</p>
                        </div>
                        <div>
                            <span class="kam-muted">{{ isEn ? 'Provider' : '身份提供商' }}</span>
                            <p>{{ account.idp }}</p>
                        </div>
                        <div>
                            <span class="kam-muted">{{ isEn ? 'User ID' : '用户 ID' }}</span>
                            <p class="kam-mono">
                                {{ settings.privacyMode ? '********' : account.userId || '-' }}
                            </p>
                        </div>
                        <div class="detail-section">
                            <strong>{{
                                isEn ? 'Bound Proxy (Reverse Proxy)' : '反代绑定代理'
                            }}</strong>
                            <div v-if="boundProxy" class="detail-row">
                                <span class="kam-mono"
                                    >{{ boundProxy.protocol }}://{{ boundProxy.host }}:{{
                                        boundProxy.port
                                    }}
                                    {{ boundProxy.label ? `(${boundProxy.label})` : '' }}</span
                                >
                                <UiBadge
                                    :tone="boundProxy.status === 'alive' ? 'success' : 'warning'"
                                    >{{ boundProxy.status }}</UiBadge
                                >
                            </div>
                            <UiAlert v-else-if="boundId" tone="warning">{{
                                isEn
                                    ? 'Previously bound proxy is unavailable.'
                                    : '之前绑定的代理已不可用。'
                            }}</UiAlert>
                            <div class="kam-actions">
                                <UiButton
                                    size="sm"
                                    data-testid="account-detail-proxy-open"
                                    @click="proxyListOpen = !proxyListOpen"
                                    >{{
                                        boundId
                                            ? isEn
                                                ? 'Change'
                                                : '更换'
                                            : isEn
                                              ? 'Bind to Proxy'
                                              : '绑定代理'
                                    }}</UiButton
                                >
                                <UiButton
                                    v-if="boundId"
                                    size="sm"
                                    variant="danger"
                                    :disabled="proxyBusy"
                                    data-testid="account-detail-proxy-unbind"
                                    @click="unbindProxy"
                                    >{{ isEn ? 'Unbind' : '解绑' }}</UiButton
                                >
                            </div>
                            <UiAlert
                                v-if="proxyError"
                                tone="error"
                                data-testid="account-detail-proxy-error"
                                >{{ proxyError }}</UiAlert
                            >
                            <div v-if="proxyListOpen" class="detail-proxy-list">
                                <p v-if="!aliveProxies.length" class="kam-muted">
                                    {{
                                        isEn
                                            ? 'No alive proxies. Add and validate in Proxy Pool.'
                                            : '无可用代理。请先在代理池添加并验活。'
                                    }}
                                </p>
                                <UiButton
                                    v-for="proxy in aliveProxies"
                                    :key="proxy.id"
                                    size="sm"
                                    variant="ghost"
                                    :data-testid="`account-detail-proxy-${proxy.id}`"
                                    @click="bindProxy(proxy)"
                                >
                                    <span class="kam-mono"
                                        >{{ proxy.host }}:{{ proxy.port }}
                                        {{ proxy.label ? `(${proxy.label})` : '' }}</span
                                    >
                                    <span v-if="proxy.latencyMs !== undefined" class="kam-muted"
                                        >{{ proxy.latencyMs }}ms</span
                                    >
                                    <span v-if="proxy.id === boundId">✓</span>
                                </UiButton>
                            </div>
                        </div>
                    </div></UiCard
                >
                <UiCard density="compact"
                    ><div class="detail-section">
                        <h3 class="ui-card-title">{{ isEn ? 'Subscription' : '订阅详情' }}</h3>
                        <div class="detail-row">
                            <span class="kam-muted">Region</span
                            ><code>{{ credentials.region || 'us-east-1' }}</code>
                        </div>
                        <div class="detail-row">
                            <span class="kam-muted">{{
                                isEn ? 'Token Expires' : 'Token 到期'
                            }}</span
                            ><span>{{ formatDateTime(credentials.expiresAt) }}</span>
                        </div>
                        <div class="detail-row">
                            <span class="kam-muted">{{ isEn ? 'Plan Type' : '订阅类型' }}</span
                            ><code>{{ subscription.rawType || '-' }}</code>
                        </div>
                        <div class="detail-row">
                            <span class="kam-muted">{{ isEn ? 'Overage Rate' : '超额费率' }}</span
                            ><code>{{
                                usage.resourceDetail?.overageRate
                                    ? `$${usage.resourceDetail.overageRate}/${usage.resourceDetail.unit || 'INV'}`
                                    : '-'
                            }}</code>
                        </div>
                        <div class="detail-row">
                            <span class="kam-muted">{{ isEn ? 'Resource Type' : '资源类型' }}</span
                            ><code>{{ usage.resourceDetail?.resourceType || '-' }}</code>
                        </div>
                        <div class="detail-row">
                            <span class="kam-muted">{{ isEn ? 'Upgradable' : '可升级' }}</span
                            ><UiBadge
                                :tone="
                                    subscription.upgradeCapability === 'UPGRADE_CAPABLE'
                                        ? 'success'
                                        : 'neutral'
                                "
                                >{{
                                    subscription.upgradeCapability === 'UPGRADE_CAPABLE'
                                        ? 'YES'
                                        : 'NO'
                                }}</UiBadge
                            >
                        </div>
                    </div></UiCard
                >
            </div>

            <UiCard density="compact"
                ><div class="detail-section">
                    <div class="detail-heading">
                        <h3 class="ui-card-title">
                            {{ isEn ? 'Available Models' : '账户可用模型' }}
                        </h3>
                        <UiBadge tone="accent">{{ models.length }}</UiBadge>
                    </div>
                    <p
                        v-if="modelsLoading"
                        class="kam-muted"
                        data-testid="account-detail-models-loading"
                    >
                        {{ isEn ? 'Loading models...' : '加载模型中...' }}
                    </p>
                    <div v-else-if="modelsError" class="detail-section">
                        <UiAlert tone="error" data-testid="account-detail-models-error">{{
                            modelsError
                        }}</UiAlert>
                        <div class="kam-actions">
                            <UiButton
                                size="sm"
                                data-testid="account-detail-models-retry"
                                @click="loadModels"
                                >{{ isEn ? 'Retry' : '重试' }}</UiButton
                            >
                        </div>
                    </div>
                    <p v-else-if="!models.length" class="kam-muted">
                        {{ isEn ? 'No models available' : '暂无可用模型' }}
                    </p>
                    <div v-else class="kam-grid">
                        <div
                            v-for="model in models"
                            :key="model.id"
                            class="detail-model"
                            :data-testid="`account-detail-model-${model.id}`"
                        >
                            <strong class="kam-mono">{{ model.id }}</strong>
                            <p v-if="model.name && model.name !== model.id">{{ model.name }}</p>
                            <p class="kam-muted">
                                {{ model.description || (isEn ? 'No description' : '无描述') }}
                            </p>
                            <div class="kam-actions">
                                <UiBadge v-if="model.inputTypes?.includes('TEXT')" tone="neutral"
                                    >Text</UiBadge
                                >
                                <UiBadge v-if="model.inputTypes?.includes('IMAGE')" tone="accent"
                                    >Image</UiBadge
                                >
                                <UiBadge v-if="model.rateMultiplier !== undefined" tone="warning"
                                    >{{ model.rateMultiplier }}x</UiBadge
                                >
                                <span class="kam-muted kam-mono"
                                    >{{ compactTokens(model.maxInputTokens) }} /
                                    {{ compactTokens(model.maxOutputTokens) }}</span
                                >
                            </div>
                        </div>
                    </div>
                </div></UiCard
            >
        </div>
        <template #footer
            ><div class="kam-actions">
                <UiButton data-testid="account-detail-close" @click="requestClose">{{
                    isEn ? 'Close' : '关闭'
                }}</UiButton>
            </div></template
        >
    </UiDialog>
</template>

<style scoped>
.detail-heading,
.detail-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
}
.detail-heading h2,
.detail-section h3 {
    margin: 0;
}
.detail-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
}
.detail-section p {
    margin: 0;
}
.detail-proxy-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 192px;
    overflow-y: auto;
}
.detail-proxy-list :deep(.ui-button) {
    justify-content: space-between;
}
.detail-model {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
}
</style>
