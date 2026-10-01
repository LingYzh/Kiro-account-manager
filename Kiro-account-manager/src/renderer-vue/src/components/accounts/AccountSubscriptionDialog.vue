<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { UiAlert, UiBadge, UiButton, UiCard, UiDialog } from '@lingyzh/ui'
import { useTranslation } from '../../composables/useTranslation'

const props = defineProps({ open: Boolean, account: { type: Object, default: null } })
const emit = defineEmits(['update:open'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const loading = ref(false)
const paying = ref(false)
const plans = ref([])
const selected = ref('')
const error = ref('')
const success = ref('')
const firstTime = computed(() => {
    const type = props.account?.subscription.type?.toUpperCase() || ''
    return !type || type.includes('FREE')
})
let generation = 0
let alive = true
let openTimer

function text(zh, en) {
    return isEn.value ? en : zh
}
function context(account) {
    return [
        account.credentials.region,
        account.profileArn,
        account.machineId,
        account.credentials.provider || account.idp,
        account.credentials.authMethod,
        account.id
    ]
}
function clearTimer() {
    if (openTimer !== undefined) clearTimeout(openTimer)
    openTimer = undefined
}
function changeOpen(value) {
    emit('update:open', value)
}
function isCurrent(plan) {
    return (
        plan.name === props.account?.subscription.type ||
        plan.description.title === props.account?.subscription.title
    )
}
function load() {
    if (!props.open || !props.account?.credentials.accessToken || loading.value) return
    const account = props.account
    const current = generation
    loading.value = true
    error.value = ''
    Promise.resolve()
        .then(() =>
            alive && current === generation
                ? window.api.accountGetSubscriptions(
                      account.credentials.accessToken,
                      ...context(account)
                  )
                : null
        )
        .then((result) => {
            if (!alive || current !== generation || !result) return
            if (!result.success)
                throw new Error(
                    result.error || text('加载订阅失败', 'Failed to load subscriptions')
                )
            plans.value = result.plans
        })
        .catch((cause) => {
            if (alive && current === generation)
                error.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (alive && current === generation) loading.value = false
        })
}
function getLink(plan) {
    if (!alive || paying.value || !props.open || !props.account?.credentials.accessToken) return
    const account = props.account
    const current = generation
    paying.value = true
    selected.value = plan || ''
    error.value = ''
    success.value = ''
    Promise.resolve()
        .then(() =>
            alive && current === generation
                ? window.api.accountGetSubscriptionUrl(
                      account.credentials.accessToken,
                      plan,
                      ...context(account)
                  )
                : null
        )
        .then(async (result) => {
            if (!alive || current !== generation || !result) return
            if (!result.success || !result.url)
                throw new Error(
                    result.error || text('获取订阅链接失败', 'Failed to get subscription link')
                )
            if (plan) {
                await navigator.clipboard.writeText(result.url)
                if (!alive || current !== generation) return
                success.value = text('链接已复制到剪贴板！', 'Link copied to clipboard!')
                clearTimer()
                openTimer = setTimeout(() => {
                    openTimer = undefined
                    if (!alive || current !== generation) return
                    // Opening the window is intentional; a manual close cancels the timer.
                    window.api.openSubscriptionWindow(result.url).catch((cause) => {
                        if (alive)
                            error.value = cause instanceof Error ? cause.message : String(cause)
                    })
                    changeOpen(false)
                }, 800)
            } else {
                await window.api.openSubscriptionWindow(result.url)
                if (alive && current === generation) changeOpen(false)
            }
        })
        .catch((cause) => {
            if (alive && current === generation)
                error.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (alive && current === generation) {
                paying.value = false
                selected.value = ''
            }
        })
}
watch(
    () => [props.open, props.account?.id],
    () => {
        generation += 1
        clearTimer()
        loading.value = false
        paying.value = false
        plans.value = []
        error.value = ''
        success.value = ''
        if (props.open) load()
    },
    { immediate: true }
)
onBeforeUnmount(() => {
    alive = false
    generation += 1
    clearTimer()
})
</script>

<template>
    <UiDialog
        :open="open"
        size="lg"
        scrollable
        :aria-label="text('管理订阅', 'Manage subscription')"
        :content-label="text('订阅计划', 'Subscription plans')"
        data-testid="account-subscription-dialog"
        @update:open="changeOpen"
    >
        <template #header
            ><h2 class="ui-card-title">{{ text('管理订阅', 'Manage subscription') }}</h2>
            <p class="kam-muted">{{ account?.email }}</p></template
        >
        <div class="kam-dialog-content">
            <UiAlert v-if="error" tone="error" data-testid="account-subscription-error">{{
                error
            }}</UiAlert>
            <UiAlert v-if="success" tone="success">{{ success }}</UiAlert>
            <p v-if="loading" class="kam-muted">{{ text('加载中…', 'Loading…') }}</p>
            <UiButton
                v-if="error && !plans.length"
                :loading="loading"
                data-testid="account-subscription-retry"
                @click="load"
                >{{ text('重试', 'Retry') }}</UiButton
            >
            <p v-if="!loading && !error && !plans.length" class="kam-muted">
                {{ text('暂无可用订阅', 'No plans available') }}
            </p>
            <UiCard v-for="plan in plans" :key="plan.qSubscriptionType" density="compact">
                <div class="subscription-plan">
                    <div>
                        <strong>{{ plan.description.title || plan.name }}</strong>
                        <p class="kam-muted">{{ plan.description.billingInterval }}</p>
                    </div>
                    <UiBadge>{{ plan.pricing.currency }} {{ plan.pricing.amount }}</UiBadge>
                </div>
                <p>{{ plan.description.featureHeader }}</p>
                <ul>
                    <li v-for="feature in plan.description.features" :key="feature">
                        {{ feature }}
                    </li>
                </ul>
                <UiButton
                    :disabled="paying || isCurrent(plan)"
                    :loading="paying && selected === plan.qSubscriptionType"
                    variant="primary"
                    :data-testid="`account-plan-${plan.qSubscriptionType}`"
                    @click="getLink(plan.qSubscriptionType)"
                >
                    {{ text('选择计划', 'Select plan') }}</UiButton
                >
            </UiCard>
        </div>
        <template #footer
            ><div class="kam-actions">
                <UiButton :disabled="paying" @click="changeOpen(false)">{{
                    text('关闭', 'Close')
                }}</UiButton>
                <UiButton
                    v-if="!firstTime"
                    :loading="paying && !selected"
                    :disabled="loading || paying"
                    data-testid="account-subscription-manage"
                    @click="getLink(undefined)"
                    >{{ text('管理当前订阅', 'Manage current subscription') }}</UiButton
                >
            </div></template
        >
    </UiDialog>
</template>

<style scoped>
.subscription-plan {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
</style>
