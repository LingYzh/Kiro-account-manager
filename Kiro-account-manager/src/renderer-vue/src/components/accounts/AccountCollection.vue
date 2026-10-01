<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { UiAlert, UiButton } from '@lingyzh/ui'
import { Plus } from 'lucide-vue-next'
import { useAccountsStore } from '../../stores/accounts'
import { useTranslation } from '../../composables/useTranslation'
import AccountItem from './AccountItem.vue'
import AccountDetailDialog from './AccountDetailDialog.vue'
import AccountSubscriptionDialog from './AccountSubscriptionDialog.vue'

const props = defineProps({ viewMode: { type: String, required: true } })
const emit = defineEmits(['add', 'edit'])
const accounts = useAccountsStore()
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const compact = computed(() => props.viewMode === 'list')
const scrollElement = ref(null)
const columns = ref(1)
const filtered = computed(() => accounts.getFilteredAccounts())
const rows = computed(() => {
    const items = compact.value ? filtered.value : [...filtered.value, null]
    const result = []
    const size = compact.value ? 1 : columns.value
    for (let index = 0; index < items.length; index += size)
        result.push(items.slice(index, index + size))
    return result
})
const detailId = ref(null)
const subscriptionId = ref(null)
const detailAccount = computed(() => accounts.accounts.get(detailId.value) || null)
const subscriptionAccount = computed(() => accounts.accounts.get(subscriptionId.value) || null)
const refreshing = ref(false)
const error = ref('')
const virtualizer = useVirtualizer(
    computed(() => ({
        count: rows.value.length,
        getScrollElement: () => scrollElement.value,
        getItemKey: (index) =>
            `${props.viewMode}-${rows.value[index]?.map((account) => account?.id || 'add').join('-')}`,
        estimateSize: () => (compact.value ? 180 : 370),
        overscan: compact.value ? 8 : 2,
        gap: 16,
        paddingStart: 4,
        paddingEnd: compact.value ? 80 : 4,
        useAnimationFrameWithResizeObserver: true
    }))
)
const visibleRows = computed(() => virtualizer.value.getVirtualItems())
let observer
let frame = 0
let measuredWidth = 0
let active = true
let refreshGeneration = 0

function measure(element) {
    if (element) virtualizer.value.measureElement(element)
}
function add() {
    emit('add')
}
function edit(account) {
    emit('edit', account)
}
function detail(account) {
    detailId.value = account.id
}
function subscription(account) {
    subscriptionId.value = account.id
}
function closeDetail(value) {
    if (!value) {
        detailId.value = null
        refreshGeneration += 1
        refreshing.value = false
    }
}
function closeSubscription(value) {
    if (!value) subscriptionId.value = null
}
function refreshDetail() {
    if (!active || refreshing.value || !detailAccount.value) return
    const id = detailId.value
    const current = ++refreshGeneration
    refreshing.value = true
    error.value = ''
    Promise.resolve()
        .then(() =>
            active && current === refreshGeneration ? accounts.checkAccountStatus(id) : undefined
        )
        .catch((cause) => {
            if (active && current === refreshGeneration)
                error.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (active && current === refreshGeneration) refreshing.value = false
        })
}
function updateLayout(force = false) {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
        if (!active) return
        const width = scrollElement.value?.clientWidth || 0
        if (!width || (!force && width === measuredWidth)) return
        measuredWidth = width
        columns.value = Math.max(1, Math.floor((width + 16) / 316))
        nextTick(() => {
            if (active) virtualizer.value.measure()
        })
    })
}
watch(
    () => props.viewMode,
    () => {
        detailId.value = null
        subscriptionId.value = null
        refreshGeneration += 1
        refreshing.value = false
        nextTick(() => updateLayout(true))
    }
)
watch(
    () => rows.value.length,
    () => nextTick(() => updateLayout(true))
)
onMounted(() => {
    observer = new ResizeObserver(() => updateLayout())
    observer.observe(scrollElement.value)
    updateLayout()
})
onBeforeUnmount(() => {
    active = false
    refreshGeneration += 1
    observer?.disconnect()
    cancelAnimationFrame(frame)
})
</script>

<template>
    <div ref="scrollElement" class="account-collection" data-testid="account-collection">
        <UiAlert v-if="error" tone="error">{{ error }}</UiAlert>
        <div class="account-virtual-space" :style="{ height: `${virtualizer.getTotalSize()}px` }">
            <div
                v-for="row in visibleRows"
                :key="row.key"
                :ref="measure"
                :data-index="row.index"
                class="account-virtual-row"
                :style="{ transform: `translateY(${row.start}px)` }"
            >
                <div
                    class="account-row-grid"
                    :style="{
                        gridTemplateColumns: `repeat(${compact ? 1 : columns}, minmax(0, 1fr))`
                    }"
                >
                    <template v-for="account in rows[row.index]" :key="account?.id || 'add'">
                        <AccountItem
                            v-if="account"
                            :key="`${viewMode}-${account.id}`"
                            :account="account"
                            :compact="compact"
                            @edit="edit"
                            @detail="detail"
                            @subscription="subscription"
                        />
                        <div v-else class="account-add-tile">
                            <UiButton variant="ghost" data-testid="account-add-tile" @click="add"
                                ><Plus :size="20" />{{
                                    isEn ? 'Add Account' : '添加账号'
                                }}</UiButton
                            >
                        </div>
                    </template>
                </div>
            </div>
        </div>
        <UiButton
            v-if="compact"
            class="account-list-add"
            data-testid="account-list-add"
            @click="add"
            ><Plus :size="16" />{{ isEn ? 'Add Account' : '添加账号' }}</UiButton
        >
        <p v-if="!filtered.length" class="kam-muted account-empty">
            {{ isEn ? 'No accounts yet' : '暂无账号' }}
        </p>
    </div>
    <AccountDetailDialog
        :open="Boolean(detailAccount)"
        :account="detailAccount"
        :is-refreshing="refreshing"
        @update:open="closeDetail"
        @refresh="refreshDetail"
    />
    <AccountSubscriptionDialog
        :open="Boolean(subscriptionAccount)"
        :account="subscriptionAccount"
        @update:open="closeSubscription"
    />
</template>

<style scoped>
.account-collection {
    overflow: auto;
    flex: 1;
    min-height: 240px;
    position: relative;
    padding: 4px;
}
.account-virtual-space {
    width: 100%;
    position: relative;
}
.account-virtual-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
}
.account-row-grid {
    display: grid;
    gap: 16px;
    align-items: start;
}
.account-add-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--border);
    border-radius: 12px;
    min-height: 240px;
}
.account-list-add {
    margin-top: 16px;
}
.account-empty {
    margin: 16px 0;
    text-align: center;
}
</style>
