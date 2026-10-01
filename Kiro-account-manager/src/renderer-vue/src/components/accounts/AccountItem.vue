<script setup>
import { computed, ref } from 'vue'
import { UiAlert, UiBadge, UiButton, UiCard, UiCheckbox, UiDialog, UiProgress } from '@lingyzh/ui'
import {
    Copy,
    Edit,
    Info,
    KeyRound,
    LogOut,
    Power,
    RefreshCw,
    RotateCcw,
    Trash2
} from 'lucide-vue-next'
import {
    formatDateSafe,
    formatTokenExpiry,
    isBannedError,
    StatusLabelsEn,
    StatusLabelsZh,
    toRgba
} from '@shared/lib/accountHelpers'
import { useAccountsStore } from '../../stores/accounts'
import { useSettingsStore } from '../../stores/settings'
import { useProxyPoolStore } from '../../stores/proxyPool'
import { useTranslation } from '../../composables/useTranslation'
import { useAccountActions } from '../../composables/useAccountActions'

const props = defineProps({ account: { type: Object, required: true }, compact: Boolean })
const emit = defineEmits(['edit', 'detail', 'subscription'])
const accounts = useAccountsStore()
const settings = useSettingsStore()
const proxyPool = useProxyPoolStore()
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const action = useAccountActions(
    () => props.account,
    () => isEn.value
)
const banOpen = ref(false)
const selected = computed(() => accounts.selectedIds.has(props.account.id))
const banned = computed(() => isBannedError(props.account.lastError))
const tags = computed(() => props.account.tags.map((id) => accounts.tags.get(id)).filter(Boolean))
const group = computed(() => accounts.groups.get(props.account.groupId))
const boundProxy = computed(() =>
    proxyPool.proxyPool.get(proxyPool.accountProxyBindings[props.account.id])
)
const percent = computed(() => props.account.usage.percentUsed * 100)
const title = computed(() =>
    props.compact && props.account.nickname
        ? settings.maskNickname(props.account.nickname)
        : props.account.email
          ? settings.maskEmail(props.account.email)
          : props.account.nickname || props.account.userId || 'Unknown'
)
const tone = computed(() =>
    banned.value || props.account.status === 'error'
        ? 'error'
        : props.account.status === 'expired'
          ? 'warning'
          : props.account.status === 'active'
            ? 'success'
            : 'neutral'
)

function text(zh, en) {
    return isEn.value ? en : zh
}
function usage(value) {
    return settings.usagePrecision
        ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : Math.floor(value).toLocaleString()
}
function select() {
    accounts.toggleSelection(props.account.id)
}
function edit() {
    emit('edit', props.account)
}
function detail() {
    emit('detail', props.account)
}
function subscription() {
    emit('subscription', props.account)
}
function copyEmail() {
    action.copy('email')
}
function copyCredentials() {
    action.copy('credentials')
}
function refreshInfo() {
    action.refreshInfo(props.compact)
}
function resetSuspended() {
    action.clearSuspended().then(() => {
        if (!action.error.value) banOpen.value = false
    })
}
function changeBanOpen(value) {
    banOpen.value = value
}
function showBan() {
    banOpen.value = true
}
</script>

<template>
    <UiCard
        density="compact"
        class="account-item"
        :class="{
            'is-compact': compact,
            'is-selected': selected,
            'is-current': account.isActive,
            'is-banned': banned
        }"
        :data-account-id="account.id"
        :data-testid="`account-item-${account.id}`"
    >
        <div class="account-body" @click="select">
            <div class="account-identity">
                <span @click.stop
                    ><UiCheckbox
                        :model-value="selected"
                        :aria-label="text('选择账号', 'Select account')"
                        :data-testid="`account-select-${account.id}`"
                        @update:model-value="select"
                /></span>
                <div class="account-name">
                    <UiButton
                        variant="ghost"
                        dense
                        class="account-copy-name"
                        :title="account.email || account.userId"
                        :data-testid="`account-email-${account.id}`"
                        @click.stop="copyEmail"
                        ><span class="account-copy-label">{{
                            action.copiedEmail.value ? text('已复制！', 'Copied!') : title
                        }}</span></UiButton
                    >
                    <p v-if="account.nickname" class="kam-muted">
                        {{
                            compact
                                ? settings.maskEmail(account.email)
                                : settings.maskNickname(account.nickname)
                        }}
                    </p>
                    <div class="account-labels">
                        <UiBadge v-if="group" dense :color="toRgba(group.color || '#3b82f6')">{{
                            group.name
                        }}</UiBadge>
                        <UiBadge
                            v-for="tag in tags"
                            :key="tag.id"
                            dense
                            :color="toRgba(tag.color)"
                            >{{ tag.name }}</UiBadge
                        >
                    </div>
                </div>
                <UiButton
                    v-if="banned"
                    variant="ghost"
                    dense
                    :data-testid="`account-ban-${account.id}`"
                    @click.stop="showBan"
                    ><UiBadge tone="error" dense>{{ text('已封禁', 'Banned') }}</UiBadge></UiButton
                >
                <UiBadge v-else :tone="tone" dense>{{
                    (isEn ? StatusLabelsEn : StatusLabelsZh)[account.status]
                }}</UiBadge>
            </div>
            <div class="account-labels" @click.stop>
                <UiButton
                    v-if="!compact"
                    variant="ghost"
                    dense
                    :disabled="!account.credentials.accessToken"
                    :data-testid="`account-subscription-${account.id}`"
                    @click="subscription"
                    >{{ account.subscription.title || account.subscription.type }}</UiButton
                >
                <UiBadge v-else dense>{{
                    account.subscription.title || account.subscription.type
                }}</UiBadge>
                <UiBadge dense>{{ account.idp }}</UiBadge>
                <UiButton
                    v-if="boundProxy"
                    variant="ghost"
                    dense
                    :title="`${boundProxy.host}:${boundProxy.port}`"
                    :data-testid="`account-proxy-${account.id}`"
                    @click="action.unbind"
                    >⇄ {{ boundProxy.host }}</UiButton
                >
                <UiBadge v-if="account.isActive" dense tone="success">{{
                    text('当前使用', 'Active')
                }}</UiBadge>
            </div>
            <div class="account-usage">
                <div class="account-usage-line">
                    <span class="kam-muted">{{ text('使用量', 'Usage') }}</span>
                    <strong
                        >{{ usage(account.usage.current) }} /
                        {{ usage(account.usage.limit) }}</strong
                    >
                    <span>{{ percent.toFixed(settings.usagePrecision ? 2 : 0) }}%</span>
                </div>
                <UiProgress
                    :value="percent"
                    :tone="percent > 100 ? 'error' : percent > 80 ? 'warning' : 'accent'"
                    dense
                    :label="text('使用量', 'Usage')"
                />
                <p v-if="percent > 100" class="account-excess">
                    {{ text('已超额', 'Over quota') }} +{{
                        (percent - 100).toFixed(settings.usagePrecision ? 2 : 0)
                    }}% · +{{ usage(account.usage.current - account.usage.limit) }}
                </p>
                <div v-if="!compact" class="account-quota-details">
                    <span v-if="account.usage.baseLimit > 0"
                        >{{ text('基础', 'Base') }} {{ usage(account.usage.baseCurrent ?? 0) }}/{{
                            usage(account.usage.baseLimit)
                        }}</span
                    >
                    <span
                        v-if="account.usage.freeTrialLimit > 0"
                        :title="formatDateSafe(account.usage.freeTrialExpiry)"
                        >{{ text('试用', 'Trial') }}
                        {{ usage(account.usage.freeTrialCurrent ?? 0) }}/{{
                            usage(account.usage.freeTrialLimit)
                        }}</span
                    >
                    <span
                        v-for="bonus in account.usage.bonuses || []"
                        :key="bonus.code"
                        :title="formatDateSafe(bonus.expiresAt)"
                        >{{ bonus.name }} {{ usage(bonus.current) }}/{{ usage(bonus.limit) }}</span
                    >
                    <span v-if="account.usage.nextResetDate"
                        >{{ text('重置', 'Reset') }}
                        {{ formatDateSafe(account.usage.nextResetDate) }}</span
                    >
                </div>
            </div>
            <div class="account-time kam-muted">
                <span>{{
                    account.subscription.daysRemaining !== undefined
                        ? text(
                              `剩 ${account.subscription.daysRemaining} 天`,
                              `${account.subscription.daysRemaining}d left`
                          )
                        : '-'
                }}</span>
                <span
                    >Token:
                    {{
                        account.credentials.expiresAt
                            ? formatTokenExpiry(account.credentials.expiresAt, isEn)
                            : '-'
                    }}</span
                >
            </div>
            <div class="account-actions kam-actions" @click.stop>
                <UiButton
                    v-if="account.isActive"
                    icon
                    variant="ghost"
                    :loading="action.busy.logout"
                    :aria-label="text('退出登录', 'Logout')"
                    :data-testid="`account-logout-${account.id}`"
                    @click="action.logout"
                    ><LogOut :size="16"
                /></UiButton>
                <UiButton
                    v-else-if="!compact || !banned"
                    icon
                    variant="ghost"
                    :loading="action.busy.switch"
                    :aria-label="text('切换账号', 'Switch account')"
                    :data-testid="`account-switch-${account.id}`"
                    @click="action.switchAccount"
                    ><Power :size="16"
                /></UiButton>
                <UiButton
                    icon
                    variant="ghost"
                    :loading="action.busy.refresh"
                    :disabled="account.status === 'refreshing'"
                    :aria-label="text('检查账户信息', 'Check account info')"
                    :data-testid="`account-refresh-${account.id}`"
                    @click="refreshInfo"
                    ><RefreshCw :size="16"
                /></UiButton>
                <UiButton
                    v-if="!compact"
                    icon
                    variant="ghost"
                    :loading="action.busy.token"
                    :aria-label="text('刷新 Token', 'Refresh Token')"
                    :data-testid="`account-token-${account.id}`"
                    @click="action.refreshToken"
                    ><KeyRound :size="16"
                /></UiButton>
                <UiButton
                    v-if="!compact"
                    icon
                    variant="ghost"
                    :loading="action.busy['copy-credentials']"
                    :aria-label="text('复制凭证', 'Copy credentials')"
                    :data-testid="`account-credentials-${account.id}`"
                    @click="copyCredentials"
                    ><Copy :size="16"
                /></UiButton>
                <UiButton
                    icon
                    variant="ghost"
                    :aria-label="text('详情', 'Details')"
                    :data-testid="`account-detail-${account.id}`"
                    @click="detail"
                    ><Info :size="16"
                /></UiButton>
                <UiButton
                    icon
                    variant="ghost"
                    :aria-label="text('编辑', 'Edit')"
                    :data-testid="`account-edit-${account.id}`"
                    @click="edit"
                    ><Edit :size="16"
                /></UiButton>
                <UiButton
                    v-if="!compact || !account.isActive"
                    icon
                    variant="ghost"
                    :loading="action.busy.delete"
                    :aria-label="text('删除', 'Delete')"
                    :data-testid="`account-delete-${account.id}`"
                    @click="action.remove"
                    ><Trash2 :size="16"
                /></UiButton>
                <UiButton
                    v-if="compact && banned"
                    icon
                    variant="ghost"
                    :loading="action.busy.suspended"
                    :aria-label="text('重置封禁状态', 'Reset suspended')"
                    :data-testid="`account-reset-${account.id}`"
                    @click="resetSuspended"
                    ><RotateCcw :size="16"
                /></UiButton>
                <UiButton v-if="compact && banned" variant="ghost" dense @click="action.support">{{
                    text('联系支持', 'Contact support')
                }}</UiButton>
            </div>
            <UiAlert
                v-if="action.error.value"
                tone="error"
                data-testid="account-action-error"
                @click.stop
                >{{ action.error.value }}</UiAlert
            >
            <UiAlert
                v-if="account.lastError && !banned"
                tone="error"
                class="account-error"
                :title="account.lastError"
                @click.stop
                >{{ account.lastError }}</UiAlert
            >
        </div>
    </UiCard>
    <UiDialog
        :open="banOpen"
        scrollable
        :aria-label="text('封禁详情', 'Suspension details')"
        :content-label="text('封禁原因', 'Suspension reason')"
        @update:open="changeBanOpen"
    >
        <template #header
            ><h2 class="ui-card-title">{{ text('封禁详情', 'Suspension details') }}</h2></template
        >
        <div class="kam-dialog-content">
            <UiAlert tone="error">{{ account.lastError }}</UiAlert
            ><UiAlert v-if="action.error.value" tone="error">{{ action.error.value }}</UiAlert>
        </div>
        <template #footer
            ><div class="kam-actions">
                <UiButton @click="changeBanOpen(false)">{{ text('关闭', 'Close') }}</UiButton
                ><UiButton @click="action.support">{{
                    text('联系支持', 'Contact support')
                }}</UiButton
                ><UiButton
                    :loading="action.busy.suspended"
                    data-testid="account-ban-reset"
                    @click="resetSuspended"
                    >{{ text('重置封禁状态', 'Reset suspended') }}</UiButton
                >
            </div></template
        >
    </UiDialog>
</template>

<style scoped>
.account-item {
    min-width: 0;
}
.account-item.is-selected {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
}
.account-item.is-current {
    border-color: var(--accent);
}
.account-item.is-banned {
    border-color: var(--red);
}
.account-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    cursor: pointer;
}
.account-identity {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}
.account-name {
    flex: 1;
    min-width: 0;
}
.account-copy-name {
    max-width: 100%;
    justify-content: flex-start;
}
.account-copy-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.account-name p {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
}
.account-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
}
.account-usage {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.account-usage-line {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
    font-size: 12px;
}
.account-usage-line strong {
    margin-left: auto;
}
.account-excess {
    color: var(--red);
    font-size: 12px;
}
.account-quota-details {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
    color: var(--muted);
}
.account-time {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
}
.account-actions {
    gap: 2px;
}
.account-error {
    overflow-wrap: anywhere;
    font-size: 12px;
}
.is-compact .account-body {
    display: grid;
    grid-template-columns: minmax(160px, 1.2fr) minmax(120px, 1fr) minmax(150px, 1fr) auto;
    gap: 12px;
    align-items: center;
}
.is-compact .account-time {
    grid-column: 1 / 3;
}
.is-compact .account-actions {
    grid-column: 3 / 5;
    justify-content: flex-end;
}
.is-compact .account-error,
.is-compact .ui-alert {
    grid-column: 1 / -1;
}
@media (max-width: 900px) {
    .is-compact .account-body {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .is-compact .account-time,
    .is-compact .account-actions {
        grid-column: auto;
    }
}
</style>
