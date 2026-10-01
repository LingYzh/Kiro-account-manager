<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { UiAlert, UiBadge, UiButton, UiInput, UiMenu, UiMenuItem, confirmDialog } from '@lingyzh/ui'
import {
    Activity,
    CheckSquare,
    Download,
    Eye,
    EyeOff,
    Filter,
    FolderPlus,
    KeyRound,
    LayoutGrid,
    List,
    Network,
    Plus,
    Square,
    Tag,
    Trash2,
    Upload,
    X,
    Zap
} from 'lucide-vue-next'
import { toRgba } from '@shared/lib/accountHelpers'
import { useTranslation } from '../../composables/useTranslation'
import { useAccountsStore } from '../../stores/accounts'
import { useSettingsStore } from '../../stores/settings'
import { useProxyPoolStore } from '../../stores/proxyPool'
import AccountFilter from './AccountFilter.vue'

const props = defineProps({
    viewMode: { type: String, required: true },
    isFilterExpanded: { type: Boolean, required: true },
    importing: { type: Boolean, required: true }
})
const emit = defineEmits([
    'add',
    'import',
    'export',
    'manage-groups',
    'manage-tags',
    'update:viewMode',
    'toggle-filter'
])
const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()
const proxyPoolStore = useProxyPoolStore()
const { accounts, filter, selectedIds, groups, tags, activeGroupTab } = storeToRefs(accountsStore)
const { privacyMode } = storeToRefs(settingsStore)
const { proxyPool, accountProxyBindings } = storeToRefs(proxyPoolStore)
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const stats = computed(() => accountsStore.getStats())
const filteredCount = computed(() => accountsStore.getFilteredAccounts().length)
const selectedCount = computed(() => selectedIds.value.size)
const selectedAccounts = computed(() =>
    [...selectedIds.value].map((id) => accounts.value.get(id)).filter(Boolean)
)
const sortedGroups = computed(() =>
    [...groups.value.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
)
const aliveProxies = computed(() =>
    [...proxyPool.value.values()].filter((proxy) => proxy.enabled && proxy.status === 'alive')
)
const showGroupMenu = ref(false)
const showTagMenu = ref(false)
const showProxyMenu = ref(false)
const showFilterMenu = computed({
    get: () => props.isFilterExpanded,
    set: (value) => {
        if (value !== props.isFilterExpanded) emit('toggle-filter')
    }
})
const isRefreshing = ref(false)
const isChecking = ref(false)
const isDeleting = ref(false)
const operationError = ref('')
let mounted = true

onBeforeUnmount(() => {
    mounted = false
})

const tabCounts = computed(() => {
    let ungrouped = 0
    const byGroup = new Map()
    for (const account of accounts.value.values()) {
        if (!account.groupId) ungrouped++
        else byGroup.set(account.groupId, (byGroup.get(account.groupId) || 0) + 1)
    }
    return { all: accounts.value.size, ungrouped, byGroup }
})

const activeTabInfo = computed(() => {
    if (activeGroupTab.value === 'ungrouped') {
        return { label: text('未分组', 'Ungrouped'), count: tabCounts.value.ungrouped }
    }
    const group = groups.value.get(activeGroupTab.value)
    if (group) {
        return {
            label: group.name,
            count: tabCounts.value.byGroup.get(group.id) || 0,
            color: group.color
        }
    }
    return { label: text('全部', 'All'), count: tabCounts.value.all }
})

const selectedGroupCounts = computed(() => {
    const counts = new Map()
    for (const account of selectedAccounts.value) {
        counts.set(account.groupId, (counts.get(account.groupId) || 0) + 1)
    }
    return counts
})

const selectedTagCounts = computed(() => {
    const counts = new Map()
    for (const account of selectedAccounts.value) {
        for (const tagId of account.tags) counts.set(tagId, (counts.get(tagId) || 0) + 1)
    }
    return counts
})

const selectedProxyCounts = computed(() => {
    const counts = new Map()
    for (const account of selectedAccounts.value) {
        const proxyId = accountProxyBindings.value[account.id] || 'none'
        counts.set(proxyId, (counts.get(proxyId) || 0) + 1)
    }
    return counts
})

function text(zh, en) {
    return isEn.value ? en : zh
}

function search(value) {
    accountsStore.setFilter({ ...accountsStore.filter, search: value || undefined })
}

function switchGroup(groupId) {
    accountsStore.setActiveGroupTab(groupId)
    showGroupMenu.value = false
}

function moveSelected(groupId) {
    if (!selectedCount.value) return
    accountsStore.moveAccountsToGroup([...selectedIds.value], groupId)
    showGroupMenu.value = false
}

function toggleTag(tagId) {
    if (!selectedCount.value) return
    const ids = [...selectedIds.value]
    if (selectedTagCounts.value.get(tagId) === selectedAccounts.value.length) {
        accountsStore.removeTagFromAccounts(ids, tagId)
    } else {
        accountsStore.addTagToAccounts(ids, tagId)
    }
}

function bindSelected(proxyId) {
    if (!selectedCount.value) return
    proxyPoolStore.bindAccountsToProxy([...selectedIds.value], proxyId)
    showProxyMenu.value = false
}

function unbindSelected() {
    if (!selectedCount.value) return
    for (const id of selectedIds.value) proxyPoolStore.unbindAccountFromProxy(id)
    showProxyMenu.value = false
}

function togglePrivacy() {
    settingsStore.setPrivacyMode(!privacyMode.value)
}

function toggleSelectAll() {
    if (selectedCount.value === filteredCount.value && filteredCount.value > 0)
        accountsStore.deselectAll()
    else accountsStore.selectAll()
}

function batchLiveness() {
    if (!selectedCount.value) return
    window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'diagnose' }))
}

function resultError(result, zh, en) {
    if (result.failed <= 0) return ''
    const detail = result.errors[0]?.error || ''
    return text(
        `${zh}：${result.failed} 个失败${detail ? `，${detail}` : ''}`,
        `${en}: ${result.failed} failed${detail ? `, ${detail}` : ''}`
    )
}

async function batchRefresh() {
    if (isRefreshing.value || !selectedCount.value) return
    isRefreshing.value = true
    operationError.value = ''
    try {
        const result = await accountsStore.batchRefreshTokens([...selectedIds.value])
        if (mounted) operationError.value = resultError(result, '刷新 Token', 'Refresh tokens')
    } catch (error) {
        if (mounted)
            operationError.value =
                text('刷新 Token 失败', 'Failed to refresh tokens') + `: ${String(error)}`
    } finally {
        if (mounted) isRefreshing.value = false
    }
}

async function batchCheck() {
    if (isChecking.value || !selectedCount.value) return
    isChecking.value = true
    operationError.value = ''
    try {
        const result = await accountsStore.batchCheckStatus([...selectedIds.value])
        if (mounted) operationError.value = resultError(result, '检查账号', 'Check accounts')
    } catch (error) {
        if (mounted)
            operationError.value =
                text('检查账号失败', 'Failed to check accounts') + `: ${String(error)}`
    } finally {
        if (mounted) isChecking.value = false
    }
}

async function batchDelete() {
    if (isDeleting.value || !selectedCount.value) return
    isDeleting.value = true
    const ids = [...selectedIds.value]
    try {
        const confirmed = await confirmDialog({
            title: text('删除账号', 'Delete accounts'),
            message: text(
                `确定要删除选中的 ${ids.length} 个账号吗？`,
                `Delete ${ids.length} selected accounts?`
            ),
            confirmText: text('删除', 'Delete'),
            tone: 'danger'
        })
        if (confirmed && mounted) accountsStore.removeAccounts(ids)
    } finally {
        if (mounted) isDeleting.value = false
    }
}
</script>

<template>
    <div class="account-toolbar" data-testid="account-toolbar">
        <div class="account-toolbar-primary">
            <div class="account-toolbar-search">
                <UiInput
                    :model-value="filter.search ?? ''"
                    :placeholder="text('搜索账号...', 'Search accounts...')"
                    :aria-label="text('搜索账号', 'Search accounts')"
                    data-testid="toolbar-search"
                    @update:model-value="search"
                />
            </div>
            <div class="kam-actions account-toolbar-main-actions">
                <UiButton
                    :variant="viewMode === 'grid' ? 'secondary' : 'ghost'"
                    size="sm"
                    :aria-label="text('卡片视图', 'Grid view')"
                    :aria-pressed="viewMode === 'grid'"
                    data-testid="toolbar-grid"
                    @click="emit('update:viewMode', 'grid')"
                    ><LayoutGrid :size="16" aria-hidden="true"
                /></UiButton>
                <UiButton
                    :variant="viewMode === 'list' ? 'secondary' : 'ghost'"
                    size="sm"
                    :aria-label="text('列表视图', 'List view')"
                    :aria-pressed="viewMode === 'list'"
                    data-testid="toolbar-list"
                    @click="emit('update:viewMode', 'list')"
                    ><List :size="16" aria-hidden="true"
                /></UiButton>
                <UiButton data-testid="toolbar-add" @click="emit('add')"
                    ><Plus :size="16" aria-hidden="true" />{{ text('添加账号', 'Add') }}</UiButton
                >
                <UiButton
                    variant="secondary"
                    :loading="importing"
                    data-testid="toolbar-import"
                    @click="emit('import')"
                    ><Upload :size="16" aria-hidden="true" />{{ text('导入', 'Import') }}</UiButton
                >
                <UiButton variant="secondary" data-testid="toolbar-export" @click="emit('export')"
                    ><Download :size="16" aria-hidden="true" />{{
                        text('导出', 'Export')
                    }}</UiButton
                >
            </div>
        </div>

        <div class="account-toolbar-secondary">
            <div class="kam-actions account-toolbar-stats">
                <span class="kam-muted">{{
                    text(`共 ${stats.total} 个账号`, `${stats.total} accounts`)
                }}</span>
                <span v-if="filteredCount !== stats.total" class="kam-muted">{{
                    text(`已筛选 ${filteredCount} 个`, `${filteredCount} filtered`)
                }}</span>
                <UiBadge v-if="stats.expiringSoonCount > 0" tone="warning" dense>{{
                    text(
                        `${stats.expiringSoonCount} 个即将到期`,
                        `${stats.expiringSoonCount} expiring`
                    )
                }}</UiBadge>
            </div>
            <div class="kam-actions account-toolbar-controls">
                <UiMenu v-model:open="showGroupMenu" :label="text('分组', 'Groups')">
                    <template #activator="{ props: triggerProps }"
                        ><UiButton
                            v-bind="triggerProps"
                            variant="ghost"
                            size="sm"
                            data-testid="toolbar-groups"
                            ><span
                                v-if="activeTabInfo.color"
                                class="account-toolbar-color"
                                :style="{ backgroundColor: toRgba(activeTabInfo.color) }"
                            /><FolderPlus v-else :size="16" aria-hidden="true" />{{
                                activeTabInfo.label
                            }}<UiBadge dense>{{ activeTabInfo.count }}</UiBadge></UiButton
                        ></template
                    >
                    <UiMenuItem
                        :checked="activeGroupTab === 'all'"
                        data-testid="toolbar-group-all"
                        @click="switchGroup('all')"
                        >{{ text('全部', 'All') }}
                        <UiBadge dense>{{ tabCounts.all }}</UiBadge></UiMenuItem
                    >
                    <UiMenuItem
                        :checked="activeGroupTab === 'ungrouped'"
                        data-testid="toolbar-group-ungrouped"
                        @click="switchGroup('ungrouped')"
                        >{{ text('未分组', 'Ungrouped') }}
                        <UiBadge dense>{{ tabCounts.ungrouped }}</UiBadge></UiMenuItem
                    >
                    <UiMenuItem
                        v-if="selectedCount"
                        :disabled="selectedGroupCounts.get(undefined) === selectedAccounts.length"
                        data-testid="toolbar-move-ungrouped"
                        @click="moveSelected(undefined)"
                        >{{
                            text('将选中账号移至未分组', 'Move selected to ungrouped')
                        }}</UiMenuItem
                    >
                    <template v-for="group in sortedGroups" :key="group.id">
                        <UiMenuItem
                            :checked="activeGroupTab === group.id"
                            :data-testid="`toolbar-group-${group.id}`"
                            @click="switchGroup(group.id)"
                            ><UiBadge
                                :color="group.color ? toRgba(group.color) : undefined"
                                dense
                                >{{ group.name }}</UiBadge
                            ><UiBadge dense>{{
                                tabCounts.byGroup.get(group.id) || 0
                            }}</UiBadge></UiMenuItem
                        >
                        <UiMenuItem
                            v-if="selectedCount"
                            :disabled="
                                selectedGroupCounts.get(group.id) === selectedAccounts.length
                            "
                            :data-testid="`toolbar-move-${group.id}`"
                            @click="moveSelected(group.id)"
                            >{{
                                text(`移动选中到 ${group.name}`, `Move selected to ${group.name}`)
                            }}</UiMenuItem
                        >
                    </template>
                    <UiMenuItem
                        data-testid="toolbar-manage-groups"
                        @click="emit('manage-groups')"
                        >{{ text('管理分组', 'Manage groups') }}</UiMenuItem
                    >
                </UiMenu>

                <UiMenu
                    v-if="selectedCount"
                    v-model:open="showTagMenu"
                    :label="text('批量标签', 'Batch tags')"
                >
                    <template #activator="{ props: triggerProps }"
                        ><UiButton
                            v-bind="triggerProps"
                            variant="ghost"
                            size="sm"
                            :aria-label="text('批量设置标签', 'Set selected tags')"
                            data-testid="toolbar-tags"
                            ><Tag :size="16" aria-hidden="true" /><UiBadge dense>{{
                                selectedCount
                            }}</UiBadge></UiButton
                        ></template
                    >
                    <UiMenuItem
                        v-for="tag in tags.values()"
                        :key="tag.id"
                        :checked="selectedTagCounts.get(tag.id) === selectedAccounts.length"
                        keep-open
                        :data-testid="`toolbar-tag-${tag.id}`"
                        @click="toggleTag(tag.id)"
                        ><UiBadge :color="toRgba(tag.color)" dense>{{ tag.name }}</UiBadge
                        ><template #trailing
                            ><span
                                v-if="
                                    selectedTagCounts.get(tag.id) &&
                                    selectedTagCounts.get(tag.id) !== selectedAccounts.length
                                "
                                >{{ selectedTagCounts.get(tag.id) }}/{{
                                    selectedAccounts.length
                                }}</span
                            ></template
                        ></UiMenuItem
                    >
                    <UiMenuItem data-testid="toolbar-manage-tags" @click="emit('manage-tags')">{{
                        text('管理标签', 'Manage tags')
                    }}</UiMenuItem>
                </UiMenu>
                <UiButton
                    v-else
                    variant="ghost"
                    size="sm"
                    :aria-label="text('管理标签', 'Manage tags')"
                    data-testid="toolbar-tags"
                    @click="emit('manage-tags')"
                    ><Tag :size="16" aria-hidden="true"
                /></UiButton>

                <UiMenu
                    v-model:open="showProxyMenu"
                    :label="text('代理绑定', 'Proxy bindings')"
                    placement="bottom-end"
                >
                    <template #activator="{ props: triggerProps }"
                        ><UiButton
                            v-bind="triggerProps"
                            variant="ghost"
                            size="sm"
                            :aria-label="text('代理绑定', 'Proxy bindings')"
                            data-testid="toolbar-proxies"
                            ><Network :size="16" aria-hidden="true" /><UiBadge
                                v-if="selectedCount"
                                dense
                                >{{ selectedCount }}</UiBadge
                            ></UiButton
                        ></template
                    >
                    <p v-if="!selectedCount" class="kam-muted account-toolbar-menu-note">
                        {{
                            text(
                                '请先选择账号，再点击要绑定的代理',
                                'Select accounts first, then choose a proxy.'
                            )
                        }}
                    </p>
                    <template v-else>
                        <p v-if="!aliveProxies.length" class="kam-muted account-toolbar-menu-note">
                            {{
                                text(
                                    '没有可用代理，请先在代理池添加并验活',
                                    'No alive proxies. Add and validate proxies first.'
                                )
                            }}
                        </p>
                        <UiMenuItem
                            v-for="proxy in aliveProxies"
                            :key="proxy.id"
                            :checked="selectedProxyCounts.get(proxy.id) === selectedAccounts.length"
                            :data-testid="`toolbar-bind-${proxy.id}`"
                            @click="bindSelected(proxy.id)"
                        >
                            <span class="kam-mono">{{ proxy.host }}:{{ proxy.port }}</span>
                            <span v-if="proxy.label">({{ proxy.label }})</span>
                            <template #trailing
                                ><UiBadge v-if="selectedProxyCounts.get(proxy.id)" dense
                                    >{{ selectedProxyCounts.get(proxy.id) }}/{{
                                        selectedAccounts.length
                                    }}</UiBadge
                                ></template
                            >
                        </UiMenuItem>
                        <UiMenuItem
                            :disabled="selectedProxyCounts.get('none') === selectedAccounts.length"
                            danger
                            data-testid="toolbar-unbind"
                            @click="unbindSelected"
                            >{{
                                text(
                                    `解绑选中 (${selectedCount})`,
                                    `Unbind selected (${selectedCount})`
                                )
                            }}</UiMenuItem
                        >
                    </template>
                </UiMenu>

                <UiButton
                    :variant="privacyMode ? 'secondary' : 'ghost'"
                    size="sm"
                    :aria-label="
                        privacyMode
                            ? text('关闭隐私模式', 'Disable privacy mode')
                            : text('开启隐私模式', 'Enable privacy mode')
                    "
                    :aria-pressed="privacyMode"
                    data-testid="toolbar-privacy"
                    @click="togglePrivacy"
                    ><EyeOff v-if="privacyMode" :size="16" aria-hidden="true" /><Eye
                        v-else
                        :size="16"
                        aria-hidden="true"
                /></UiButton>
                <UiMenu
                    v-model:open="showFilterMenu"
                    panel
                    :label="text('高级筛选', 'Advanced filter')"
                    placement="bottom-end"
                >
                    <template #activator="{ props: triggerProps }"
                        ><UiButton
                            v-bind="triggerProps"
                            :variant="isFilterExpanded ? 'secondary' : 'ghost'"
                            size="sm"
                            :aria-label="text('展开/收起高级筛选', 'Toggle advanced filter')"
                            data-testid="toolbar-filter"
                            ><Filter :size="16" aria-hidden="true" /></UiButton
                    ></template>
                    <AccountFilter />
                </UiMenu>

                <UiButton
                    variant="ghost"
                    size="sm"
                    :disabled="isChecking || !selectedCount"
                    :loading="isChecking"
                    :aria-label="text('检查账户信息', 'Check account info')"
                    data-testid="toolbar-check"
                    @click="batchCheck"
                    ><Activity :size="16" aria-hidden="true"
                /></UiButton>
                <UiButton
                    variant="ghost"
                    size="sm"
                    :disabled="!selectedCount"
                    :aria-label="text('账号测活', 'Liveness test')"
                    data-testid="toolbar-liveness"
                    @click="batchLiveness"
                    ><Zap :size="16" aria-hidden="true"
                /></UiButton>
                <UiButton
                    variant="ghost"
                    size="sm"
                    :disabled="isDeleting || !selectedCount"
                    :aria-label="text('删除选中账号', 'Delete selected accounts')"
                    data-testid="toolbar-delete"
                    @click="batchDelete"
                    ><Trash2 :size="16" aria-hidden="true"
                /></UiButton>
                <UiButton
                    variant="ghost"
                    size="sm"
                    :disabled="isRefreshing || !selectedCount"
                    :loading="isRefreshing"
                    :aria-label="text('刷新 Token', 'Refresh tokens')"
                    data-testid="toolbar-refresh"
                    @click="batchRefresh"
                    ><KeyRound :size="16" aria-hidden="true"
                /></UiButton>
                <UiButton
                    variant="ghost"
                    size="sm"
                    :aria-label="
                        selectedCount === filteredCount && filteredCount > 0
                            ? text('取消全选', 'Deselect all')
                            : text('全选', 'Select all')
                    "
                    data-testid="toolbar-select-all"
                    @click="toggleSelectAll"
                    ><CheckSquare
                        v-if="selectedCount === filteredCount && filteredCount > 0"
                        :size="16"
                        aria-hidden="true"
                    /><Square v-else :size="16" aria-hidden="true" />{{
                        selectedCount
                            ? text(`已选 ${selectedCount}`, `${selectedCount} sel`)
                            : text('全选', 'All')
                    }}</UiButton
                >
                <UiButton
                    v-if="selectedCount"
                    variant="ghost"
                    size="sm"
                    :aria-label="text('清除选中', 'Clear selection')"
                    data-testid="toolbar-clear-selection"
                    @click="accountsStore.deselectAll()"
                    ><X :size="16" aria-hidden="true"
                /></UiButton>
            </div>
        </div>
        <UiAlert
            v-if="operationError"
            tone="error"
            :title="text('批量操作失败', 'Batch operation failed')"
            data-testid="toolbar-error"
            >{{ operationError }}</UiAlert
        >
    </div>
</template>

<style scoped>
.account-toolbar {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.account-toolbar-primary,
.account-toolbar-secondary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
}
.account-toolbar-search {
    flex: 1 1 220px;
    max-width: 420px;
}
.account-toolbar-main-actions,
.account-toolbar-controls {
    justify-content: flex-end;
}
.account-toolbar-stats {
    font-size: 13px;
}
.account-toolbar-color {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex: none;
}
.account-toolbar-menu-note {
    padding: 8px 12px;
    font-size: 12px;
}
</style>
