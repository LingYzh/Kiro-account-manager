<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { UiAlert, UiBadge, UiButton, UiDialog, UiInput, UiSelect } from '@lingyzh/ui'
import { ArrowDown, Copy, Download, RefreshCw, Trash2 } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'

const props = defineProps({
    open: { type: Boolean, required: true },
    isEn: { type: Boolean, default: undefined }
})
const emit = defineEmits(['update:open'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => props.isEn ?? actualLanguage.value === 'en')
const logs = ref([])
const loading = ref(false)
const clearing = ref(false)
const error = ref('')
const searchText = ref('')
const levelFilter = ref('all')
const categoryFilter = ref('all')
const timeRange = ref(localStorage.getItem('proxyLogs_timeRange') || 'all')
const displayLimit = ref(localStorage.getItem('proxyLogs_displayLimit') || 'all')
const isAtBottom = ref(true)
const newLogCount = ref(0)
const expanded = ref(new Set())
const scrollElement = ref(null)
let pollTimer
let followFrame = 0
let observer
let requestRevision = 0
let inFlight = false
let pendingFetch = false
let previousLogCount = 0
let mounted = true

const categories = computed(() => [...new Set(logs.value.map((log) => log.category))].sort())
const filteredLogs = computed(() => {
    const now = Date.now()
    const span =
        {
            '1h': 3600000,
            '6h': 21600000,
            '12h': 43200000,
            '1d': 86400000,
            '3d': 259200000,
            '7d': 604800000,
            '30d': 2592000000,
            '180d': 15552000000,
            '1y': 31536000000
        }[timeRange.value] || 0
    const query = searchText.value.toLowerCase()
    let result = logs.value.filter((log) => {
        if (span && now - new Date(log.timestamp).getTime() > span) return false
        if (levelFilter.value !== 'all' && log.level !== levelFilter.value) return false
        if (categoryFilter.value !== 'all' && log.category !== categoryFilter.value) return false
        if (!query) return true
        if (log.message.toLowerCase().includes(query) || log.category.toLowerCase().includes(query))
            return true
        try {
            return log.data && JSON.stringify(log.data).toLowerCase().includes(query)
        } catch {
            return false
        }
    })
    if (displayLimit.value !== 'all') {
        const limit = parseInt(displayLimit.value, 10)
        if (limit > 0) result = result.slice(-limit)
    }
    return result
})
const virtualizer = useVirtualizer(
    computed(() => ({
        count: filteredLogs.value.length,
        getScrollElement: () => scrollElement.value,
        estimateSize: (index) => (expanded.value.has(index) ? 120 : 32),
        overscan: 20
    }))
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())

function levelTone(level) {
    return { ERROR: 'error', WARN: 'warning', INFO: 'accent', DEBUG: 'neutral' }[level] || 'neutral'
}

function formatTime(timestamp) {
    if (!timestamp) return '-'
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return timestamp
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

async function fetchLogs() {
    if (!mounted || !props.open) return
    if (inFlight || clearing.value) {
        pendingFetch = true
        return
    }
    inFlight = true
    loading.value = true
    const current = requestRevision
    try {
        const entries = await window.api.proxyGetLogs()
        if (!mounted || !props.open || current !== requestRevision) return
        if (!isAtBottom.value && entries.length > previousLogCount)
            newLogCount.value += entries.length - previousLogCount
        previousLogCount = entries.length
        logs.value = entries
        error.value = ''
    } catch (cause) {
        if (mounted && props.open && current === requestRevision)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        inFlight = false
        if (mounted && props.open) loading.value = false
        if (pendingFetch && mounted && props.open && !clearing.value) {
            pendingFetch = false
            void fetchLogs()
        }
    }
}

async function clearLogs() {
    if (clearing.value) return
    clearing.value = true
    const current = ++requestRevision
    pendingFetch = false
    try {
        const result = await window.api.proxyClearLogs()
        if (!mounted || !props.open || current !== requestRevision) return
        if (!result.success) throw new Error(isEn.value ? 'Could not clear logs' : '清空日志失败')
        logs.value = []
        previousLogCount = 0
        newLogCount.value = 0
        expanded.value = new Set()
        isAtBottom.value = true
        error.value = ''
    } catch (cause) {
        if (mounted && props.open && current === requestRevision)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && props.open && current === requestRevision) {
            clearing.value = false
            void fetchLogs()
        }
    }
}

function exportLogs() {
    const content = logs.value
        .map(
            (log) =>
                `[${log.timestamp}] [${log.level}] [${log.category}] ${log.message}${log.data ? ` | ${JSON.stringify(log.data)}` : ''}`
        )
        .join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `proxy-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    anchor.click()
    URL.revokeObjectURL(url)
}

async function copyLog(log) {
    const content = `[${log.timestamp}] [${log.level}] [${log.category}]\n${log.message}${log.data ? `\nData: ${JSON.stringify(log.data, null, 2)}` : ''}`
    try {
        await navigator.clipboard.writeText(content)
    } catch (cause) {
        if (mounted && props.open)
            error.value = cause instanceof Error ? cause.message : String(cause)
    }
}

function toggleExpanded(index) {
    const values = new Set(expanded.value)
    if (values.has(index)) values.delete(index)
    else values.add(index)
    expanded.value = values
}

function handleScroll() {
    const element = scrollElement.value
    if (!element) return
    isAtBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 40
    if (isAtBottom.value) newLogCount.value = 0
    else cancelAnimationFrame(followFrame)
}

function scrollToBottom() {
    if (!scrollElement.value?.clientHeight || !filteredLogs.value.length) return
    isAtBottom.value = true
    newLogCount.value = 0
    virtualizer.value.scrollToIndex(filteredLogs.value.length - 1, { align: 'end' })
}

function scheduleFollow() {
    cancelAnimationFrame(followFrame)
    if (!mounted || !props.open || !isAtBottom.value || !filteredLogs.value.length) return
    followFrame = requestAnimationFrame(() => {
        if (mounted && props.open && isAtBottom.value && scrollElement.value?.clientHeight)
            scrollToBottom()
    })
}

function measureRow(element) {
    if (element) virtualizer.value.measureElement(element)
}

watch(
    () => props.open,
    (open) => {
        requestRevision += 1
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = undefined
        if (open) {
            void fetchLogs()
            pollTimer = setInterval(() => {
                void fetchLogs()
            }, 1500)
            void nextTick(scheduleFollow)
        } else {
            pendingFetch = false
            loading.value = false
            clearing.value = false
            cancelAnimationFrame(followFrame)
        }
    },
    { immediate: true }
)
watch(timeRange, (value) => localStorage.setItem('proxyLogs_timeRange', value), { immediate: true })
watch(displayLimit, (value) => localStorage.setItem('proxyLogs_displayLimit', value), {
    immediate: true
})
watch([searchText, levelFilter, categoryFilter, timeRange], () => {
    expanded.value = new Set()
})
watch(
    [filteredLogs, isAtBottom],
    async () => {
        if (!props.open || !isAtBottom.value) return
        await nextTick()
        scheduleFollow()
    },
    { flush: 'post' }
)
watch(scrollElement, (element) => {
    observer?.disconnect()
    observer = undefined
    if (element) {
        observer = new ResizeObserver(() => {
            if (props.open) scheduleFollow()
        })
        observer.observe(element)
    }
})
onBeforeUnmount(() => {
    mounted = false
    requestRevision += 1
    if (pollTimer) clearInterval(pollTimer)
    cancelAnimationFrame(followFrame)
    observer?.disconnect()
})
</script>

<template>
    <UiDialog
        :open="open"
        size="xl"
        scrollable
        :aria-label="isEn ? 'Proxy Detailed Logs' : '反代详细日志'"
        :content-label="isEn ? 'Detailed proxy logs' : '详细日志'"
        data-testid="proxy-detailed-logs-dialog"
        @update:open="emit('update:open', $event)"
    >
        <template #header
            ><h2>{{ isEn ? 'Proxy Detailed Logs' : '反代详细日志' }}</h2>
            <UiBadge tone="neutral"
                >{{ filteredLogs.length }} / {{ logs.length }}</UiBadge
            ></template
        >
        <div class="kam-dialog-content kam-proxy-detailed-dialog">
            <div class="kam-proxy-log-filters">
                <UiInput
                    v-model="searchText"
                    :placeholder="isEn ? 'Search logs…' : '搜索日志内容…'"
                    data-testid="proxy-detailed-search"
                />
                <UiSelect v-model="levelFilter" data-testid="proxy-detailed-level"
                    ><option value="all">{{ isEn ? 'All levels' : '全部级别' }}</option>
                    <option
                        v-for="level in ['ERROR', 'WARN', 'INFO', 'DEBUG']"
                        :key="level"
                        :value="level"
                    >
                        {{ level }}
                    </option></UiSelect
                >
                <UiSelect v-model="categoryFilter" data-testid="proxy-detailed-category"
                    ><option value="all">{{ isEn ? 'All categories' : '全部类别' }}</option>
                    <option v-for="category in categories" :key="category" :value="category">
                        {{ category }}
                    </option></UiSelect
                >
                <UiSelect v-model="timeRange" data-testid="proxy-detailed-time"
                    ><option
                        v-for="item in [
                            'all',
                            '1h',
                            '6h',
                            '12h',
                            '1d',
                            '3d',
                            '7d',
                            '30d',
                            '180d',
                            '1y'
                        ]"
                        :key="item"
                        :value="item"
                    >
                        {{ item === 'all' ? (isEn ? 'All time' : '全部时间') : item }}
                    </option></UiSelect
                >
                <UiSelect v-model="displayLimit" data-testid="proxy-detailed-limit"
                    ><option
                        v-for="item in [
                            'all',
                            '5000',
                            '10000',
                            '50000',
                            '100000',
                            '200000',
                            '500000',
                            '1000000'
                        ]"
                        :key="item"
                        :value="item"
                    >
                        {{ item === 'all' ? (isEn ? 'All' : '全部') : item }}
                    </option></UiSelect
                >
                <UiButton
                    icon
                    size="sm"
                    variant="ghost"
                    :loading="loading"
                    :disabled="loading"
                    :aria-label="isEn ? 'Refresh' : '刷新'"
                    data-testid="proxy-detailed-refresh"
                    @click="fetchLogs"
                    ><RefreshCw :size="16"
                /></UiButton>
                <UiButton
                    icon
                    size="sm"
                    variant="ghost"
                    :disabled="!logs.length"
                    :aria-label="isEn ? 'Export' : '导出'"
                    data-testid="proxy-detailed-export"
                    @click="exportLogs"
                    ><Download :size="16"
                /></UiButton>
                <UiButton
                    icon
                    size="sm"
                    variant="danger"
                    :loading="clearing"
                    :disabled="!logs.length || clearing"
                    :aria-label="isEn ? 'Clear' : '清空'"
                    data-testid="proxy-detailed-clear"
                    @click="clearLogs"
                    ><Trash2 :size="16"
                /></UiButton>
            </div>
            <UiAlert
                v-if="error"
                tone="error"
                :title="isEn ? 'Could not load logs' : '日志操作失败'"
                data-testid="proxy-detailed-error"
                >{{ error }}</UiAlert
            >
            <div class="kam-proxy-log-list-wrap">
                <div
                    ref="scrollElement"
                    class="kam-proxy-log-scroll kam-mono"
                    data-testid="proxy-detailed-scroll"
                    @scroll="handleScroll"
                >
                    <p v-if="!filteredLogs.length" class="kam-muted">
                        {{
                            logs.length
                                ? isEn
                                    ? 'No matching logs'
                                    : '没有匹配的日志'
                                : isEn
                                  ? 'No logs yet'
                                  : '暂无日志记录'
                        }}
                    </p>
                    <div
                        v-else
                        :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }"
                    >
                        <div
                            v-for="row in virtualRows"
                            :key="row.key"
                            :ref="measureRow"
                            :data-index="row.index"
                            class="kam-proxy-log-row"
                            :style="{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${row.start}px)`
                            }"
                            :data-testid="`proxy-detailed-row-${row.index}`"
                        >
                            <span class="kam-muted">{{
                                formatTime(filteredLogs[row.index].timestamp)
                            }}</span>
                            <UiBadge :tone="levelTone(filteredLogs[row.index].level)">{{
                                filteredLogs[row.index].level
                            }}</UiBadge>
                            <span>{{ filteredLogs[row.index].category }}</span>
                            <span class="kam-proxy-log-message">{{
                                filteredLogs[row.index].message
                            }}</span>
                            <UiButton
                                v-if="
                                    filteredLogs[row.index].data !== undefined &&
                                    filteredLogs[row.index].data !== null
                                "
                                icon
                                size="sm"
                                variant="ghost"
                                :aria-label="isEn ? 'Toggle data' : '展开数据'"
                                :aria-expanded="expanded.has(row.index)"
                                :data-testid="`proxy-detailed-expand-${row.index}`"
                                @click="toggleExpanded(row.index)"
                                >{{ expanded.has(row.index) ? '−' : '+' }}</UiButton
                            >
                            <UiButton
                                icon
                                size="sm"
                                variant="ghost"
                                :aria-label="isEn ? 'Copy log' : '复制日志'"
                                :data-testid="`proxy-detailed-copy-${row.index}`"
                                @click="copyLog(filteredLogs[row.index])"
                                ><Copy :size="14"
                            /></UiButton>
                            <pre
                                v-if="
                                    expanded.has(row.index) &&
                                    filteredLogs[row.index].data !== undefined &&
                                    filteredLogs[row.index].data !== null
                                "
                                >{{ JSON.stringify(filteredLogs[row.index].data, null, 2) }}</pre
                            >
                        </div>
                    </div>
                </div>
                <div v-if="!isAtBottom" class="kam-proxy-follow-placement">
                    <UiButton
                        size="sm"
                        variant="primary"
                        data-testid="proxy-detailed-bottom"
                        @click="scrollToBottom"
                        ><ArrowDown :size="14" />{{
                            newLogCount
                                ? isEn
                                    ? `${newLogCount} new`
                                    : `${newLogCount} 条新`
                                : isEn
                                  ? 'Bottom'
                                  : '底部'
                        }}</UiButton
                    >
                </div>
            </div>
            <div class="kam-proxy-log-footer kam-muted">
                <span
                    >{{ isEn ? 'Showing' : '显示' }} {{ filteredLogs.length.toLocaleString() }} /
                    {{ logs.length.toLocaleString() }}</span
                ><span>{{
                    isAtBottom
                        ? isEn
                            ? 'Following'
                            : '跟随中'
                        : isEn
                          ? 'Scrolled up'
                          : '已暂停跟随'
                }}</span>
            </div>
        </div>
        <template #footer
            ><UiButton variant="ghost" @click="emit('update:open', false)">{{
                isEn ? 'Close' : '关闭'
            }}</UiButton></template
        >
    </UiDialog>
</template>

<style scoped>
.kam-proxy-detailed-dialog {
    height: min(65vh, 700px);
    min-height: 300px;
}
.kam-proxy-log-filters {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}
.kam-proxy-log-filters > :first-child {
    flex: 1;
    min-width: 160px;
}
.kam-proxy-log-list-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
}
.kam-proxy-log-scroll {
    height: 100%;
    overflow: auto;
    font-size: 12px;
}
.kam-proxy-log-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex-wrap: wrap;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
}
.kam-proxy-log-message {
    flex: 1;
    min-width: 120px;
    overflow-wrap: anywhere;
}
.kam-proxy-log-row pre {
    flex-basis: 100%;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
    padding: 8px;
}
.kam-proxy-follow-placement {
    position: absolute;
    right: 12px;
    bottom: 12px;
}
.kam-proxy-log-footer {
    display: flex;
    justify-content: space-between;
    gap: 12px;
}
</style>
