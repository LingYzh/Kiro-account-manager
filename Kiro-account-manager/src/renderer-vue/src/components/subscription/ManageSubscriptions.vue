<script setup>
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { UiBadge, UiButton, UiCard, UiCheckbox, confirmDialog } from '@lingyzh/ui'
import { ExternalLink } from 'lucide-vue-next'
import { useSubscriptionState } from '../../composables/useSubscription'

const props = defineProps({ isEn: { type: Boolean, required: true } })
const state = useSubscriptionState()
const scrollElement = ref(null)
const subscribed = computed(() => state.subscribedAccounts)
const overageEnabledCount = computed(
    () =>
        subscribed.value.filter((account) => account.usage?.resourceDetail?.overageEnabled === true)
            .length
)
const selectedCount = computed(() => state.manageSelectedIds.size)
const virtualizer = useVirtualizer(
    computed(() => ({
        count: subscribed.value.length,
        getScrollElement: () => scrollElement.value,
        estimateSize: () => 48,
        overscan: 10
    }))
)
const rows = computed(() => virtualizer.value.getVirtualItems())

function planTone(account) {
    const name = (account.subscription?.title || account.subscription?.type || '').toUpperCase()
    return name.includes('PRO') ? 'accent' : name.includes('POWER') ? 'warning' : 'neutral'
}
function daysTone(account) {
    const days = account.subscription?.daysRemaining
    return days <= 3 ? 'error' : days <= 7 ? 'warning' : 'neutral'
}
async function confirmOpen(mode) {
    const count = state.manageTargets(mode).length
    if (!count) return
    const approved = await confirmDialog({
        title: props.isEn ? 'Open subscription portals' : '打开订阅门户',
        message: props.isEn
            ? `Open ${count} subscription portal pages? (in browser incognito mode)`
            : `打开 ${count} 个订阅门户页面？（浏览器无痕模式）`
    })
    if (approved) await state.batchOpenPortals(mode)
}
async function confirmDisable(mode) {
    const count = state
        .manageTargets(mode)
        .filter((account) => account.usage?.resourceDetail?.overageEnabled === true).length
    if (!count) {
        state.feedback = props.isEn ? 'No accounts with overage enabled' : '没有开启超额的账号'
        return
    }
    const approved = await confirmDialog({
        title: props.isEn ? 'Disable overage' : '关闭超额',
        message: props.isEn
            ? `Disable overage on ${count} accounts?`
            : `关闭 ${count} 个账号的超额？`,
        tone: 'danger'
    })
    if (approved) await state.batchDisableOverage(mode)
}
async function openOne(account) {
    try {
        await state.openPortalForAccount(account)
    } catch (cause) {
        state.error = cause instanceof Error ? cause.message : String(cause)
    }
}
</script>

<template>
    <div class="kam-subscription-section" data-testid="subscription-manage">
        <UiCard density="compact"
            ><h2>{{ isEn ? 'Subscription Lifecycle Management' : '订阅生命周期管理' }}</h2>
            <p class="kam-muted">
                {{
                    isEn
                        ? 'Bulk open subscription portals in browser (cancel/manage there), or bulk disable overage.'
                        : '批量打开订阅门户（在浏览器内取消/管理），或批量关闭超额。'
                }}
            </p></UiCard
        >
        <UiCard v-if="!subscribed.length" density="compact"
            ><p class="kam-muted">
                {{
                    isEn
                        ? 'No subscribed accounts found. Run “Check Accounts” first to refresh status.'
                        : '未发现已订阅账号。请先在账户页“批量检查”刷新状态。'
                }}
            </p></UiCard
        >
        <template v-else>
            <UiCard density="compact"
                ><div class="kam-actions">
                    <UiButton
                        size="sm"
                        :loading="state.isBatchOpening"
                        :disabled="state.isBatchOpening || !selectedCount"
                        data-testid="manage-open-selected"
                        @click="confirmOpen('selected')"
                        >{{
                            isEn
                                ? `Open Portal (Selected: ${selectedCount})`
                                : `打开门户（已选 ${selectedCount}）`
                        }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="state.isBatchOpening"
                        data-testid="manage-open-all"
                        @click="confirmOpen('all')"
                        >{{
                            isEn
                                ? `Open All (${subscribed.length})`
                                : `打开全部 (${subscribed.length})`
                        }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        :loading="state.isBatchDisablingOverage"
                        :disabled="state.isBatchDisablingOverage || !selectedCount"
                        data-testid="manage-disable-selected"
                        @click="confirmDisable('selected')"
                        >{{ isEn ? 'Disable Overage (Selected)' : '关超额（已选）' }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="state.isBatchDisablingOverage || !overageEnabledCount"
                        data-testid="manage-disable-all"
                        @click="confirmDisable('all')"
                        >{{
                            isEn
                                ? `Disable All Overage (${overageEnabledCount})`
                                : `关全部超额 (${overageEnabledCount})`
                        }}</UiButton
                    ><span class="kam-muted">{{
                        selectedCount
                            ? isEn
                                ? `${selectedCount} of ${subscribed.length} selected`
                                : `已选 ${selectedCount} / ${subscribed.length}`
                            : isEn
                              ? `${subscribed.length} subscribed accounts`
                              : `${subscribed.length} 个已订阅账号`
                    }}</span>
                </div></UiCard
            >
            <UiCard density="compact"
                ><div class="kam-manage-header">
                    <UiCheckbox
                        :model-value="selectedCount === subscribed.length"
                        :aria-label="isEn ? 'Select all accounts' : '全选账号'"
                        data-testid="manage-select-all"
                        @update:model-value="state.toggleManageAll"
                    /><span>#</span><span>{{ isEn ? 'Email' : '邮箱' }}</span
                    ><span>{{ isEn ? 'Plan' : '订阅类型' }}</span
                    ><span>{{ isEn ? 'Days Left' : '剩余天数' }}</span
                    ><span>{{ isEn ? 'Overage' : '超额状态' }}</span
                    ><span>{{ isEn ? 'Actions' : '操作' }}</span>
                </div>
                <div ref="scrollElement" class="kam-manage-scroll" data-testid="manage-scroll">
                    <div
                        v-if="subscribed.length >= 50"
                        class="kam-manage-virtual"
                        :style="{ height: `${virtualizer.getTotalSize()}px` }"
                    >
                        <div
                            v-for="row in rows"
                            :key="row.key"
                            class="kam-manage-positioned"
                            :style="{ transform: `translateY(${row.start}px)` }"
                        >
                            <div v-if="subscribed[row.index]" class="kam-manage-row">
                                <UiCheckbox
                                    :model-value="
                                        state.manageSelectedIds.has(subscribed[row.index].id)
                                    "
                                    :aria-label="
                                        isEn
                                            ? `Select ${subscribed[row.index].email}`
                                            : `选择 ${subscribed[row.index].email}`
                                    "
                                    :data-testid="`manage-select-${subscribed[row.index].id}`"
                                    @update:model-value="
                                        state.toggleManageSelection(subscribed[row.index].id)
                                    "
                                /><span>{{ row.index + 1 }}</span
                                ><span :title="subscribed[row.index].email">{{
                                    subscribed[row.index].email
                                }}</span
                                ><UiBadge :tone="planTone(subscribed[row.index])">{{
                                    subscribed[row.index].subscription?.title ||
                                    subscribed[row.index].subscription?.type ||
                                    '-'
                                }}</UiBadge
                                ><UiBadge :tone="daysTone(subscribed[row.index])">{{
                                    subscribed[row.index].subscription?.daysRemaining != null
                                        ? isEn
                                            ? `${subscribed[row.index].subscription.daysRemaining}d`
                                            : `${subscribed[row.index].subscription.daysRemaining} 天`
                                        : '-'
                                }}</UiBadge
                                ><UiBadge
                                    :tone="
                                        subscribed[row.index].usage?.resourceDetail
                                            ?.overageEnabled === true
                                            ? 'success'
                                            : 'neutral'
                                    "
                                    >{{
                                        subscribed[row.index].usage?.resourceDetail
                                            ?.overageEnabled === true
                                            ? isEn
                                                ? 'ENABLED'
                                                : '已开启'
                                            : subscribed[row.index].subscription
                                                    ?.overageCapability === 'OVERAGE_CAPABLE'
                                              ? isEn
                                                  ? 'DISABLED'
                                                  : '未开启'
                                              : '-'
                                    }}</UiBadge
                                ><UiButton
                                    variant="ghost"
                                    size="sm"
                                    :disabled="state.busyLinkIds.has(subscribed[row.index].id)"
                                    :data-testid="`manage-open-${subscribed[row.index].id}`"
                                    @click="openOne(subscribed[row.index])"
                                    ><ExternalLink :size="14" />{{
                                        isEn ? 'Manage' : '管理'
                                    }}</UiButton
                                >
                            </div>
                        </div>
                    </div>
                    <div
                        v-for="(account, index) in subscribed"
                        v-else
                        :key="account.id"
                        class="kam-manage-row"
                    >
                        <UiCheckbox
                            :model-value="state.manageSelectedIds.has(account.id)"
                            :aria-label="isEn ? `Select ${account.email}` : `选择 ${account.email}`"
                            :data-testid="`manage-select-${account.id}`"
                            @update:model-value="state.toggleManageSelection(account.id)"
                        /><span>{{ index + 1 }}</span
                        ><span :title="account.email">{{ account.email }}</span
                        ><UiBadge :tone="planTone(account)">{{
                            account.subscription?.title || account.subscription?.type || '-'
                        }}</UiBadge
                        ><UiBadge :tone="daysTone(account)">{{
                            account.subscription?.daysRemaining != null
                                ? isEn
                                    ? `${account.subscription.daysRemaining}d`
                                    : `${account.subscription.daysRemaining} 天`
                                : '-'
                        }}</UiBadge
                        ><UiBadge
                            :tone="
                                account.usage?.resourceDetail?.overageEnabled === true
                                    ? 'success'
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
                        ><UiButton
                            variant="ghost"
                            size="sm"
                            :disabled="state.busyLinkIds.has(account.id)"
                            :data-testid="`manage-open-${account.id}`"
                            @click="openOne(account)"
                            ><ExternalLink :size="14" />{{ isEn ? 'Manage' : '管理' }}</UiButton
                        >
                    </div>
                </div></UiCard
            >
        </template>
    </div>
</template>

<style scoped>
.kam-subscription-section {
    display: grid;
    gap: 16px;
}
.kam-manage-header,
.kam-manage-row {
    display: grid;
    grid-template-columns: 24px 30px minmax(150px, 1fr) 110px 88px 100px 110px;
    gap: 8px;
    align-items: center;
    min-width: 650px;
}
.kam-manage-header {
    font-size: 0.78rem;
    color: var(--muted);
    padding: 8px;
    border-bottom: 1px solid var(--border);
}
.kam-manage-scroll {
    max-height: 60vh;
    overflow: auto;
}
.kam-manage-virtual {
    position: relative;
    min-width: 650px;
}
.kam-manage-positioned {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
}
.kam-manage-row {
    min-height: 48px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    font-size: 0.82rem;
}
.kam-manage-row > span:nth-child(3) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
