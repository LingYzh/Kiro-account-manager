<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiCheckbox,
    UiDialog,
    UiField,
    UiInput,
    UiRadio,
    UiTextarea,
    confirmDialog
} from '@lingyzh/ui'
import { Copy, ExternalLink, RefreshCw, Trash2 } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { useSubscriptionState } from '../../composables/useSubscription'
import { useAccountsStore } from '../../stores/accounts'
import { parseImportedLinks } from '../../lib/subscription'
import ManageSubscriptions from '../subscription/ManageSubscriptions.vue'

const state = useSubscriptionState()
const accounts = useAccountsStore()
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const importOpen = ref(false)
const importText = ref('')
const overageList = ref(null)
const detectedCount = computed(() => parseImportedLinks(importText.value).length)
const overageSuccessCount = computed(
    () => state.overageItems.filter((item) => item.status === 'success').length
)
const overageErrorCount = computed(
    () => state.overageItems.filter((item) => item.status === 'error').length
)
const successCount = computed(() => state.links.filter((link) => link.status === 'success').length)
const errorCount = computed(() => state.links.filter((link) => link.status === 'error').length)
const expiredCount = computed(() => state.links.filter((link) => link.status === 'expired').length)
const failedCount = computed(() => errorCount.value + expiredCount.value)

state.beginPage()
onBeforeUnmount(() => state.disposePage())
watch(
    () => state.overageItems,
    async () => {
        await nextTick()
        if (overageList.value) overageList.value.scrollTop = overageList.value.scrollHeight
    },
    { deep: true }
)

function setConcurrency(value) {
    const count = Number.parseInt(value, 10)
    if (count > 0) state.concurrency = Math.min(count, 100)
}
function setQuickPickCount(value) {
    const count = Number.parseInt(value, 10)
    if (count > 0) state.quickPickCount = count
}
function statusTone(status) {
    return status === 'success'
        ? 'success'
        : status === 'error'
          ? 'error'
          : status === 'expired'
            ? 'warning'
            : 'neutral'
}
function statusLabel(status) {
    const labels = {
        pending: ['等待中', 'Pending'],
        loading: ['加载中', 'Loading'],
        success: ['成功', 'Success'],
        error: ['失败', 'Error'],
        expired: ['过期', 'Expired'],
        skipped: ['跳过', 'Skipped']
    }
    return labels[status]?.[isEn.value ? 1 : 0] || status
}
function reasonLabel(reason) {
    const labels = {
        'already-pro': ['已订阅', 'Already subscribed'],
        'no-token': ['无 Token', 'No token'],
        banned: ['已封禁', 'Banned'],
        'cant-upgrade': ['不可升级', "Can't upgrade"],
        'unknown-status': ['状态未知', 'Unknown status']
    }
    return labels[reason]?.[isEn.value ? 1 : 0] || reason
}
function preflightReasons() {
    return ['already-pro', 'no-token', 'banned', 'cant-upgrade', 'unknown-status'].filter(
        (reason) => state.preflightReport.reasonBuckets[reason] > 0
    )
}
async function confirmDeleteSelected() {
    if (!state.selectedLinkIds.size) return
    const approved = await confirmDialog({
        title: isEn.value ? 'Remove selected links' : '移除选中链接',
        message: isEn.value
            ? `Remove ${state.selectedLinkIds.size} selected links from the list?`
            : `从列表移除选中的 ${state.selectedLinkIds.size} 个链接？`,
        tone: 'danger'
    })
    if (approved) state.deleteSelectedLinks()
}
async function confirmDeleteFailed() {
    if (!failedCount.value) return
    const count = failedCount.value
    const approved = await confirmDialog({
        title: isEn.value ? 'Remove failed links' : '清理失败链接',
        message: state.deleteAlsoAccount
            ? isEn.value
                ? `Remove ${count} failed/expired links AND delete their accounts permanently?`
                : `移除 ${count} 个失败/过期的链接，并永久删除这些账号？`
            : isEn.value
              ? `Remove ${count} failed/expired links?`
              : `移除 ${count} 个失败/过期的链接？`,
        tone: 'danger'
    })
    if (approved) state.deleteFailedLinks(state.deleteAlsoAccount)
}
function confirmImport() {
    const count = state.importLinks(importText.value, isEn.value)
    importText.value = ''
    importOpen.value = false
    state.feedback = isEn.value ? `Imported ${count} link(s)` : `成功导入 ${count} 个链接`
}
async function runAction(action) {
    state.error = ''
    state.feedback = ''
    try {
        await action()
    } catch (cause) {
        state.error = cause instanceof Error ? cause.message : String(cause)
    }
}
async function openOne(url) {
    await runAction(() => state.openLink(url))
}
async function copyOne(url) {
    await runAction(async () => {
        await state.copyLink(url)
        state.feedback = isEn.value ? 'Link copied' : '链接已复制'
    })
}
async function copyExport(mode) {
    await runAction(async () => {
        await state.exportLinks(mode)
        state.feedback = isEn.value ? 'Links copied' : '链接已复制'
    })
}
function retryFailedOverage() {
    const ids = new Set(
        state.overageItems.filter((item) => item.status === 'error').map((item) => item.accountId)
    )
    const targets = state.subscribedAccounts.filter((account) => ids.has(account.id))
    if (targets.length) void state.batchSetOverage(targets)
}
function regenerateOne(accountId) {
    if (!state.selectedPlanType) {
        state.error = isEn.value ? 'Please select a plan first' : '请先选择计划'
        return
    }
    void state.regenerateLink(accountId)
}
</script>

<template>
    <div class="kam-page kam-subscription-page" data-testid="page-subscription">
        <header class="kam-page-header">
            <div>
                <h1>{{ isEn ? 'Batch Subscription' : '批量订阅' }}</h1>
                <p class="kam-muted">
                    {{
                        accounts.selectedIds.size > 0
                            ? isEn
                                ? `Using ${accounts.selectedIds.size} selected accounts`
                                : `使用已选中的 ${accounts.selectedIds.size} 个账户`
                            : isEn
                              ? 'Using all accounts'
                              : '使用全部账户'
                    }}
                </p>
            </div>
        </header>
        <div
            class="kam-actions"
            role="tablist"
            :aria-label="isEn ? 'Subscription sections' : '订阅分类'"
        >
            <UiButton
                :variant="state.activeTab === 'overage' ? 'primary' : 'secondary'"
                role="tab"
                :aria-selected="state.activeTab === 'overage'"
                data-testid="subscription-tab-overage"
                @click="state.activeTab = 'overage'"
                >{{ isEn ? 'Overage Settings' : '超额设置' }}</UiButton
            ><UiButton
                :variant="state.activeTab === 'links' ? 'primary' : 'secondary'"
                role="tab"
                :aria-selected="state.activeTab === 'links'"
                data-testid="subscription-tab-links"
                @click="state.activeTab = 'links'"
                >{{ isEn ? 'Subscription Links' : '获取链接' }}</UiButton
            ><UiButton
                :variant="state.activeTab === 'manage' ? 'primary' : 'secondary'"
                role="tab"
                :aria-selected="state.activeTab === 'manage'"
                data-testid="subscription-tab-manage"
                @click="state.activeTab = 'manage'"
                >{{ isEn ? 'Manage Subscriptions' : '订阅管理' }}</UiButton
            >
        </div>
        <UiAlert
            v-if="state.error"
            tone="error"
            :title="isEn ? 'Operation failed' : '操作失败'"
            data-testid="subscription-error"
            >{{ state.error }}</UiAlert
        ><UiAlert
            v-if="state.feedback"
            tone="info"
            :title="isEn ? 'Notice' : '提示'"
            data-testid="subscription-feedback"
            >{{ state.feedback }}</UiAlert
        >

        <div
            v-if="state.activeTab === 'overage'"
            class="kam-subscription-section"
            data-testid="subscription-overage"
        >
            <UiCard density="compact"
                ><div class="kam-actions">
                    <UiButton
                        :loading="state.isSettingOverage"
                        :disabled="state.isSettingOverage || !state.overageableAccounts.length"
                        data-testid="subscription-enable-overage"
                        @click="state.batchSetOverage()"
                        >{{
                            isEn
                                ? `Enable Overage (${state.overageableAccounts.length})`
                                : `一键超额 (${state.overageableAccounts.length})`
                        }}</UiButton
                    ><UiButton
                        variant="secondary"
                        :disabled="state.isSettingOverage || !state.subscribedAccounts.length"
                        data-testid="subscription-enable-all"
                        @click="state.batchSetOverage(state.subscribedAccounts)"
                        >{{
                            isEn
                                ? `Set All (${state.subscribedAccounts.length})`
                                : `全部设置 (${state.subscribedAccounts.length})`
                        }}</UiButton
                    ><UiButton
                        variant="ghost"
                        :disabled="state.isSettingOverage || !state.overageItems.length"
                        data-testid="subscription-clear-overage"
                        @click="state.clearOverageItems()"
                        ><Trash2 :size="16" />{{ isEn ? 'Clear' : '清空' }}</UiButton
                    ><UiButton
                        variant="ghost"
                        :disabled="state.isSettingOverage || !overageErrorCount"
                        @click="state.clearOverageItems(true)"
                        >{{
                            isEn
                                ? `Clear Failed (${overageErrorCount})`
                                : `清失败 (${overageErrorCount})`
                        }}</UiButton
                    ><UiButton
                        variant="secondary"
                        :disabled="state.isSettingOverage || !overageErrorCount"
                        data-testid="subscription-retry-overage"
                        @click="retryFailedOverage"
                        ><RefreshCw :size="16" />{{
                            isEn
                                ? `Retry Failed (${overageErrorCount})`
                                : `重试失败 (${overageErrorCount})`
                        }}</UiButton
                    ><UiField :label="isEn ? 'Concurrency' : '并发'"
                        ><UiInput
                            :model-value="state.concurrency"
                            type="number"
                            min="1"
                            max="100"
                            :disabled="state.isSettingOverage"
                            data-testid="subscription-concurrency"
                            @update:model-value="setConcurrency" /></UiField
                    ><span class="kam-muted">{{
                        state.overageableAccounts.length
                            ? isEn
                                ? `${state.overageableAccounts.length} subscribed accounts without overage enabled`
                                : `${state.overageableAccounts.length} 个已订阅账号未开启超额`
                            : isEn
                              ? 'No accounts need overage enablement'
                              : '没有需要开启超额的账号'
                    }}</span
                    ><UiBadge v-if="overageSuccessCount" tone="success">{{
                        overageSuccessCount
                    }}</UiBadge
                    ><UiBadge v-if="overageErrorCount" tone="error">{{
                        overageErrorCount
                    }}</UiBadge>
                </div></UiCard
            >
            <UiCard v-if="state.overageItems.length" density="compact"
                ><h2>{{ isEn ? 'Overage results' : '超额结果' }}</h2>
                <div ref="overageList" class="kam-subscription-list">
                    <div
                        v-for="(item, index) in state.overageItems"
                        :key="item.accountId"
                        class="kam-subscription-row"
                    >
                        <span>{{ index + 1 }}</span
                        ><span :title="item.email">{{ item.email }}</span
                        ><UiBadge :tone="statusTone(item.status)">{{
                            statusLabel(item.status)
                        }}</UiBadge
                        ><span class="kam-muted">{{
                            item.status === 'success'
                                ? isEn
                                    ? 'Overage enabled'
                                    : '超额已开启'
                                : item.error || ''
                        }}</span>
                    </div>
                </div></UiCard
            >
            <UiCard v-else density="compact"
                ><h2>{{ isEn ? 'Subscribed accounts' : '已订阅账号' }}</h2>
                <div v-if="state.subscribedAccounts.length" class="kam-subscription-list">
                    <div
                        v-for="(account, index) in state.subscribedAccounts"
                        :key="account.id"
                        class="kam-subscription-row"
                    >
                        <span>{{ index + 1 }}</span
                        ><span :title="account.email">{{ account.email }}</span
                        ><span>{{
                            account.subscription?.title || account.subscription?.type || '-'
                        }}</span
                        ><UiBadge
                            :tone="
                                account.usage?.resourceDetail?.overageEnabled === true
                                    ? 'success'
                                    : account.subscription?.overageCapability === 'OVERAGE_CAPABLE'
                                      ? 'warning'
                                      : 'neutral'
                            "
                            >{{
                                account.usage?.resourceDetail?.overageEnabled === true
                                    ? isEn
                                        ? 'ENABLED'
                                        : '已开启'
                                    : account.subscription?.overageCapability === 'OVERAGE_CAPABLE'
                                      ? isEn
                                          ? 'DISABLED'
                                          : '未开启'
                                      : '-'
                            }}</UiBadge
                        >
                    </div>
                </div>
                <p v-else class="kam-muted">
                    {{
                        isEn
                            ? 'No subscribed accounts found. Ensure accounts are checked first.'
                            : '未找到已订阅账号。请先检测账号状态。'
                    }}
                </p></UiCard
            >
        </div>

        <div
            v-else-if="state.activeTab === 'links'"
            class="kam-subscription-section"
            data-testid="subscription-links"
        >
            <UiCard v-if="state.preflightReport.totalScanned" density="compact"
                ><div class="kam-actions">
                    <strong>{{ isEn ? 'Pre-flight Check' : '升级预检' }}</strong
                    ><span class="kam-muted">{{
                        isEn
                            ? `Scanned ${state.preflightReport.totalScanned} accounts: ${state.preflightReport.eligible.length} eligible, ${state.preflightReport.blocked.length} blocked`
                            : `扫描 ${state.preflightReport.totalScanned} 个账号：${state.preflightReport.eligible.length} 可升级，${state.preflightReport.blocked.length} 不可升级`
                    }}</span>
                </div>
                <div class="kam-actions">
                    <UiBadge
                        v-for="reason in preflightReasons()"
                        :key="reason"
                        :tone="
                            reason === 'already-pro'
                                ? 'success'
                                : reason === 'no-token'
                                  ? 'neutral'
                                  : 'warning'
                        "
                        >{{ reasonLabel(reason) }}:
                        {{ state.preflightReport.reasonBuckets[reason] }}</UiBadge
                    >
                </div>
                <p v-if="!state.preflightReport.eligible.length" class="kam-muted">
                    {{
                        isEn
                            ? 'No eligible accounts. Run “Check Accounts” on the accounts page first to get latest status.'
                            : '无可升级账号。建议先在账户管理页“批量检查”获取最新状态。'
                    }}
                </p></UiCard
            >
            <UiCard density="compact"
                ><div class="kam-actions">
                    <UiButton
                        variant="secondary"
                        :loading="state.isLoadingPlans"
                        :disabled="state.isLoadingPlans || !state.upgradeableAccounts.length"
                        data-testid="subscription-load-plans"
                        @click="state.loadPlans"
                        ><RefreshCw :size="16" />{{ isEn ? 'Load Plans' : '加载计划' }}</UiButton
                    ><span class="kam-muted">{{
                        state.availablePlans.length
                            ? isEn
                                ? `${state.availablePlans.length} plans available`
                                : `已加载 ${state.availablePlans.length} 个计划`
                            : isEn
                              ? 'Click to load available subscription plans'
                              : '点击加载可用订阅计划'
                    }}</span>
                </div>
                <div v-if="state.availablePlans.length" class="kam-plan-grid">
                    <UiCard
                        v-for="plan in state.availablePlans"
                        :key="plan.qSubscriptionType"
                        density="compact"
                        ><UiRadio
                            :model-value="state.selectedPlanType"
                            :value="plan.qSubscriptionType"
                            name="subscription-plan"
                            :data-testid="`subscription-plan-${plan.qSubscriptionType}`"
                            @update:model-value="state.selectedPlanType = plan.qSubscriptionType"
                            >{{ plan.description?.title || plan.name }}</UiRadio
                        >
                        <p class="kam-muted">
                            {{ plan.pricing?.currency || '$'
                            }}{{ (plan.pricing?.amount || 0) / 100 }}/{{
                                plan.description?.billingInterval || '-'
                            }}
                        </p>
                        <p v-if="plan.description?.featureHeader" class="kam-muted">
                            {{ plan.description.featureHeader }}
                        </p>
                        <p
                            v-for="feature in plan.description?.features || []"
                            :key="feature"
                            class="kam-muted"
                        >
                            {{ feature }}
                        </p></UiCard
                    >
                </div></UiCard
            >
            <UiCard density="compact"
                ><div class="kam-actions">
                    <UiButton
                        :loading="state.isFetching"
                        :disabled="
                            state.isFetching ||
                            !state.upgradeableAccounts.length ||
                            !state.selectedPlanType
                        "
                        data-testid="subscription-fetch-links"
                        @click="state.batchFetchLinks"
                        >{{
                            isEn
                                ? `Fetch Links (${state.upgradeableAccounts.length})`
                                : `获取链接 (${state.upgradeableAccounts.length})`
                        }}</UiButton
                    ><UiButton
                        variant="ghost"
                        :disabled="state.isFetching || !state.links.length"
                        data-testid="subscription-clear-links"
                        @click="state.clearLinks"
                        ><Trash2 :size="16" />{{ isEn ? 'Clear' : '清空' }}</UiButton
                    ><UiButton
                        variant="secondary"
                        :disabled="state.isFetching"
                        data-testid="subscription-import-open"
                        @click="importOpen = true"
                        >{{ isEn ? 'Import' : '导入链接' }}</UiButton
                    ><UiButton
                        variant="secondary"
                        :loading="state.isValidatingLinks"
                        :disabled="state.isFetching || state.isValidatingLinks || !successCount"
                        data-testid="subscription-validate"
                        @click="state.validateLinks"
                        >{{ isEn ? 'Validate' : '检测有效性' }}</UiButton
                    ><UiButton
                        variant="secondary"
                        :disabled="state.isFetching || !failedCount"
                        data-testid="subscription-delete-failed"
                        @click="confirmDeleteFailed"
                        >{{
                            isEn ? `Remove Failed (${failedCount})` : `清失败 (${failedCount})`
                        }}</UiButton
                    ><UiCheckbox
                        v-model="state.deleteAlsoAccount"
                        data-testid="subscription-delete-accounts"
                        >{{ isEn ? 'Delete accounts' : '连删账号' }}</UiCheckbox
                    ><UiField :label="isEn ? 'Concurrency' : '并发'"
                        ><UiInput
                            :model-value="state.concurrency"
                            type="number"
                            min="1"
                            max="100"
                            :disabled="state.isFetching"
                            data-testid="subscription-concurrency"
                            @update:model-value="setConcurrency"
                    /></UiField>
                </div>
                <div v-if="state.links.length" class="kam-actions">
                    <UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="state.isFetching"
                        data-testid="subscription-select-all"
                        @click="state.toggleSelectAllLinks"
                        >{{
                            state.selectedCount === state.links.length
                                ? isEn
                                    ? 'Deselect all'
                                    : '取消全选'
                                : isEn
                                  ? 'Select all'
                                  : '全选'
                        }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="state.isFetching"
                        @click="state.invertLinkSelection"
                        >{{ isEn ? 'Invert' : '反选' }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="state.isFetching || !state.selectedCount"
                        @click="state.clearLinkSelection"
                        >{{ isEn ? 'Deselect' : '取消多选' }}</UiButton
                    ><UiField :label="isEn ? 'Quick pick' : '快选'"
                        ><UiInput
                            :model-value="state.quickPickCount"
                            type="number"
                            min="1"
                            :disabled="state.isFetching"
                            data-testid="subscription-quick-count"
                            @update:model-value="setQuickPickCount" /></UiField
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="state.isFetching || !successCount"
                        data-testid="subscription-quick-top"
                        @click="state.quickPickTop"
                        >{{ isEn ? 'Top' : '前N个' }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="state.isFetching || !successCount"
                        data-testid="subscription-quick-next"
                        @click="state.quickPickNext"
                        >{{ isEn ? 'Next' : '下一批' }}</UiButton
                    ><UiButton
                        variant="ghost"
                        size="sm"
                        :disabled="state.isFetching"
                        @click="state.selectByStatus('success')"
                        >{{ isEn ? 'Success' : '成功' }} ({{ successCount }})</UiButton
                    ><UiButton
                        variant="ghost"
                        size="sm"
                        :disabled="state.isFetching"
                        @click="state.selectByStatus('expired')"
                        >{{ isEn ? 'Expired' : '过期' }} ({{ expiredCount }})</UiButton
                    ><UiButton
                        variant="ghost"
                        size="sm"
                        :disabled="state.isFetching"
                        @click="state.selectByStatus('error')"
                        >{{ isEn ? 'Error' : '失败' }} ({{ errorCount }})</UiButton
                    ><UiButton
                        v-if="state.selectedCount"
                        variant="danger"
                        size="sm"
                        :disabled="state.isFetching"
                        data-testid="subscription-delete-selected"
                        @click="confirmDeleteSelected"
                        >{{
                            isEn
                                ? `Delete Selected (${state.selectedCount})`
                                : `删除选中 (${state.selectedCount})`
                        }}</UiButton
                    >
                </div>
                <div v-if="successCount" class="kam-actions">
                    <UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="!state.selectedCount"
                        data-testid="subscription-open-selected"
                        @click="runAction(() => state.openLinks('selected'))"
                        >{{
                            isEn
                                ? `Open Selected (${state.selectedCount})`
                                : `打开选中 (${state.selectedCount})`
                        }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        data-testid="subscription-open-all"
                        @click="runAction(() => state.openLinks('all'))"
                        >{{
                            isEn ? `Open All (${successCount})` : `全部打开 (${successCount})`
                        }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="!state.selectedCount"
                        data-testid="subscription-export-selected"
                        @click="copyExport('selected')"
                        >{{
                            isEn
                                ? `Export Selected (${state.selectedCount})`
                                : `导出选中 (${state.selectedCount})`
                        }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        data-testid="subscription-export-all"
                        @click="copyExport('all')"
                        >{{
                            isEn ? `Export All (${successCount})` : `全部导出 (${successCount})`
                        }}</UiButton
                    ><UiBadge tone="success">{{ successCount }}</UiBadge
                    ><UiBadge v-if="errorCount" tone="error">{{ errorCount }}</UiBadge>
                </div></UiCard
            >
            <UiCard v-if="state.links.length" density="compact"
                ><h2>{{ isEn ? 'Subscription links' : '订阅链接' }}</h2>
                <div class="kam-subscription-list">
                    <div
                        v-for="(link, index) in state.links"
                        :key="link.accountId"
                        class="kam-link-row"
                        :data-testid="`subscription-link-${link.accountId}`"
                    >
                        <UiCheckbox
                            :model-value="state.selectedLinkIds.has(link.accountId)"
                            :aria-label="isEn ? `Select ${link.email}` : `选择 ${link.email}`"
                            @update:model-value="state.toggleLinkSelection(link.accountId)"
                        /><span>{{ index + 1 }}</span
                        ><span :title="link.email">{{ link.email }}</span
                        ><UiBadge :tone="statusTone(link.status)"
                            >{{ statusLabel(link.status)
                            }}<span v-if="link.status === 'success' && link.generatedAt">
                                {{ Math.round((Date.now() - link.generatedAt) / 60000) }}m</span
                            ></UiBadge
                        >
                        <div class="kam-actions">
                            <UiButton
                                v-if="
                                    (link.status === 'success' || link.status === 'expired') &&
                                    link.url
                                "
                                variant="ghost"
                                size="sm"
                                :aria-label="isEn ? 'Open link' : '打开链接'"
                                :data-testid="`subscription-open-${link.accountId}`"
                                @click="openOne(link.url)"
                                ><ExternalLink :size="14" /></UiButton
                            ><UiButton
                                v-if="
                                    (link.status === 'success' || link.status === 'expired') &&
                                    link.url
                                "
                                variant="ghost"
                                size="sm"
                                :aria-label="isEn ? 'Copy link' : '复制链接'"
                                :data-testid="`subscription-copy-${link.accountId}`"
                                @click="copyOne(link.url)"
                                ><Copy :size="14" /></UiButton
                            ><UiButton
                                v-if="link.status === 'expired' || link.status === 'error'"
                                variant="ghost"
                                size="sm"
                                :disabled="state.busyLinkIds.has(link.accountId)"
                                :aria-label="isEn ? 'Regenerate' : '重新生成'"
                                :data-testid="`subscription-regenerate-${link.accountId}`"
                                @click="regenerateOne(link.accountId)"
                                ><RefreshCw :size="14" /></UiButton
                            ><span v-if="link.error" class="kam-muted" :title="link.error">{{
                                link.error
                            }}</span>
                        </div>
                    </div>
                </div></UiCard
            >
            <UiCard v-else density="compact"
                ><p class="kam-muted">
                    {{
                        state.upgradeableAccounts.length
                            ? isEn
                                ? `${state.upgradeableAccounts.length} FREE accounts available for upgrade. Click “Fetch Links” to start.`
                                : `有 ${state.upgradeableAccounts.length} 个 FREE 账户可升级。点击“获取链接”开始。`
                            : isEn
                              ? 'No FREE tier accounts found. Select accounts in the Accounts page first.'
                              : '未找到 FREE 账户。请先在账户管理页面选择账户。'
                    }}
                </p></UiCard
            >
        </div>

        <ManageSubscriptions v-else :is-en="isEn" />
        <UiDialog
            :open="importOpen"
            size="lg"
            scrollable
            :aria-label="isEn ? 'Import Links' : '批量导入链接'"
            :content-label="isEn ? 'Paste links' : '粘贴链接'"
            data-testid="subscription-import-dialog"
            @update:open="importOpen = $event"
            ><template #header
                ><h2>{{ isEn ? 'Import Links' : '批量导入链接' }}</h2></template
            >
            <div class="kam-dialog-content">
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Paste links, one per line. Supports plain URLs or “email + URL” (space / comma / tab / | / ----). Duplicates are skipped.'
                            : '每行一个链接。支持纯 URL，或「邮箱 + URL」（空格 / 逗号 / Tab / | / ----）。重复链接会跳过。'
                    }}
                </p>
                <UiTextarea
                    v-model="importText"
                    :rows="12"
                    spellcheck="false"
                    placeholder="https://aws.amazon.com/..."
                    data-testid="subscription-import-text"
                />
                <p class="kam-muted">
                    {{
                        isEn
                            ? `Detected ${detectedCount} valid link(s)`
                            : `已识别 ${detectedCount} 个有效链接`
                    }}
                </p>
            </div>
            <template #footer
                ><UiButton variant="secondary" @click="importOpen = false">{{
                    isEn ? 'Cancel' : '取消'
                }}</UiButton
                ><UiButton
                    :disabled="!detectedCount"
                    data-testid="subscription-import-confirm"
                    @click="confirmImport"
                    >{{ isEn ? `Import (${detectedCount})` : `导入 (${detectedCount})` }}</UiButton
                ></template
            ></UiDialog
        >
    </div>
</template>

<style scoped>
.kam-subscription-section {
    display: grid;
    gap: 16px;
}
.kam-subscription-list {
    max-height: 60vh;
    overflow: auto;
}
.kam-subscription-row {
    display: grid;
    grid-template-columns: 32px minmax(130px, 1fr) 120px minmax(100px, 1fr);
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-bottom: 1px solid var(--border);
}
.kam-subscription-row > span:nth-child(2),
.kam-link-row > span:nth-child(3) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kam-plan-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
}
.kam-link-row {
    display: grid;
    grid-template-columns: 24px 32px minmax(130px, 1fr) 100px minmax(120px, 1fr);
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-bottom: 1px solid var(--border);
}
.kam-link-row > .kam-actions {
    justify-content: flex-end;
}
.kam-link-row > .kam-actions > span {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kam-subscription-page :deep(.ui-field) {
    min-width: 80px;
}
@media (max-width: 700px) {
    .kam-subscription-row,
    .kam-link-row {
        min-width: 590px;
    }
}
</style>
