<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { UiBadge, UiButton, UiCard, UiInput, UiSelect, UiSpinner, snackbar } from '@lingyzh/ui'
import { ArrowDown, Download, RefreshCw, Search, Trash2 } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'

const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const logs = ref([])
const totalCount = ref(0)
const filter = ref('')
const levelFilter = ref('ALL')
const categoryFilter = ref('all')
const timeRange = ref('all')
const displayLimit = ref(localStorage.getItem('systemLogs_displayLimit') || '5000')
const isAtBottom = ref(true)
const isLoading = ref(true)
const isClearing = ref(false)
const expandedIdx = ref(null)
const newLogCount = ref(0)
const scrollElement = ref(null)

let pollTimer
let followFrame = 0
let scrollResizeObserver
let active = true
let requestRevision = 0
let inFlight = false
let pendingFetch = false
let previousLogCount = 0

const levels = ['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR']
const categories = computed(() => [...new Set(logs.value.map((log) => log.category))].sort())
const levelCounts = computed(() =>
    Object.fromEntries(
        levels.map((level) => [
            level,
            level === 'ALL'
                ? logs.value.length
                : logs.value.filter((log) => log.level === level).length
        ])
    )
)
const filteredLogs = computed(() => {
    const now = Date.now()
    const rangeMs =
        { '1h': 3600000, '6h': 21600000, '1d': 86400000, '7d': 604800000 }[timeRange.value] || 0
    const query = filter.value.toLowerCase()
    let result = logs.value.filter((log) => {
        if (rangeMs && now - new Date(log.timestamp).getTime() > rangeMs) return false
        if (levelFilter.value !== 'ALL' && log.level !== levelFilter.value) return false
        if (categoryFilter.value !== 'all' && log.category !== categoryFilter.value) return false
        return (
            !query ||
            log.message.toLowerCase().includes(query) ||
            log.category.toLowerCase().includes(query) ||
            (typeof log.data === 'string' && log.data.toLowerCase().includes(query))
        )
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
        estimateSize: (index) => (expandedIdx.value === index ? 120 : 32),
        overscan: 20
    }))
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())

function levelTone(level) {
    return { DEBUG: 'neutral', INFO: 'accent', WARN: 'warning', ERROR: 'error' }[level] || 'neutral'
}

function formatTime(timestamp) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return timestamp
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

function formatData(data) {
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2)
}

async function fetchLogs() {
    if (!active) return
    if (inFlight || isClearing.value) {
        pendingFetch = true
        return
    }
    inFlight = true
    const revision = requestRevision
    const count =
        displayLimit.value === 'all' ? undefined : parseInt(displayLimit.value, 10) || undefined
    try {
        const [entries, countTotal] = await Promise.all([
            window.api.proxyGetLogs(count),
            window.api.proxyGetLogsCount()
        ])
        if (!active || revision !== requestRevision) return
        if (!isAtBottom.value && entries.length > previousLogCount) {
            newLogCount.value += entries.length - previousLogCount
        }
        previousLogCount = entries.length
        logs.value = entries
        totalCount.value = countTotal
    } catch {
        // Polling is best effort; the next interval retries.
    } finally {
        inFlight = false
        if (active) isLoading.value = false
        if (pendingFetch && active && !isClearing.value) {
            pendingFetch = false
            void fetchLogs()
        }
    }
}

async function clearLogs() {
    if (isClearing.value) return
    isClearing.value = true
    requestRevision++
    pendingFetch = false
    try {
        const result = await window.api.proxyClearLogs()
        if (!active) return
        if (result.success) {
            logs.value = []
            totalCount.value = 0
            newLogCount.value = 0
            previousLogCount = 0
            expandedIdx.value = null
            isAtBottom.value = true
        } else {
            snackbar.show(isEn.value ? 'Could not clear logs' : '清空日志失败', { tone: 'error' })
        }
    } catch {
        if (active)
            snackbar.show(isEn.value ? 'Could not clear logs' : '清空日志失败', { tone: 'error' })
    } finally {
        isClearing.value = false
        if (active) void fetchLogs()
    }
}

function exportLogs() {
    const content = filteredLogs.value
        .map((log) => {
            const data = log.data
                ? ` ${typeof log.data === 'string' ? log.data : JSON.stringify(log.data)}`
                : ''
            return `${log.timestamp} [${log.level}][${log.category}] ${log.message}${data}`
        })
        .join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `kiro-logs-${new Date().toISOString().slice(0, 10)}.log`
    link.click()
    URL.revokeObjectURL(url)
}

function handleScroll() {
    const element = scrollElement.value
    if (!element) return
    isAtBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 40
    if (isAtBottom.value) {
        newLogCount.value = 0
    } else {
        cancelAnimationFrame(followFrame)
    }
}

function scrollToBottom() {
    if (!filteredLogs.value.length) return
    isAtBottom.value = true
    newLogCount.value = 0
    if (!scrollElement.value?.clientHeight) return
    virtualizer.value.scrollToIndex(filteredLogs.value.length - 1, { align: 'end' })
}

function scheduleFollow() {
    cancelAnimationFrame(followFrame)
    if (!active || !isAtBottom.value || !filteredLogs.value.length) return
    followFrame = requestAnimationFrame(() => {
        if (active && isAtBottom.value && scrollElement.value?.clientHeight) scrollToBottom()
    })
}

function toggleExpanded(index) {
    expandedIdx.value = expandedIdx.value === index ? null : index
}

function measureRow(element) {
    if (element) virtualizer.value.measureElement(element)
}

watch(
    displayLimit,
    (limit, previousLimit) => {
        localStorage.setItem('systemLogs_displayLimit', displayLimit.value)
        if (previousLimit === undefined) return
        requestRevision++
        pendingFetch = true
        void fetchLogs()
    },
    { immediate: true }
)

watch([filter, levelFilter, categoryFilter, timeRange], () => {
    expandedIdx.value = null
})

watch(
    [filteredLogs, isAtBottom],
    async () => {
        cancelAnimationFrame(followFrame)
        if (!isAtBottom.value || !filteredLogs.value.length) return
        await nextTick()
        if (!active || !isAtBottom.value) return
        scheduleFollow()
    },
    { flush: 'post' }
)

watch(
    scrollElement,
    (element) => {
        scrollResizeObserver?.disconnect()
        if (!element) return
        scrollResizeObserver = new ResizeObserver(() => scheduleFollow())
        scrollResizeObserver.observe(element)
    },
    { flush: 'post' }
)

onMounted(() => {
    void fetchLogs()
    pollTimer = window.setInterval(fetchLogs, 1500)
})

onBeforeUnmount(() => {
    active = false
    requestRevision++
    clearInterval(pollTimer)
    cancelAnimationFrame(followFrame)
    scrollResizeObserver?.disconnect()
})
</script>

<template>
    <div class="kam-page kam-logs-page" data-testid="page-logs">
        <header class="kam-page-header">
            <div>
                <h1>{{ isEn ? 'System Logs' : '系统日志' }}</h1>
                <p class="kam-muted">
                    {{ isEn ? 'Inspect proxy activity and errors' : '查看代理活动与错误记录' }}
                </p>
            </div>
            <div class="kam-actions">
                <UiBadge dense>{{ totalCount.toLocaleString() }}</UiBadge>
                <UiSpinner
                    v-if="isLoading"
                    :size="16"
                    :label="isEn ? 'Loading logs' : '加载日志'"
                />
                <UiButton
                    dense
                    ghost
                    :aria-label="isEn ? 'Refresh' : '刷新'"
                    :title="isEn ? 'Refresh' : '刷新'"
                    @click="fetchLogs"
                    ><RefreshCw :size="16"
                /></UiButton>
                <UiButton
                    dense
                    ghost
                    :aria-label="isEn ? 'Export' : '导出'"
                    :title="isEn ? 'Export' : '导出'"
                    @click="exportLogs"
                    ><Download :size="16"
                /></UiButton>
                <UiButton
                    dense
                    ghost
                    variant="danger"
                    :loading="isClearing"
                    :aria-label="isEn ? 'Clear all' : '清空'"
                    :title="isEn ? 'Clear all' : '清空'"
                    @click="clearLogs"
                    ><Trash2 :size="16"
                /></UiButton>
            </div>
        </header>

        <UiCard density="compact" class="kam-logs-filters">
            <div class="kam-actions">
                <UiInput
                    v-model="filter"
                    class="kam-logs-search"
                    :placeholder="isEn ? 'Filter by message, category...' : '按消息、分类搜索...'"
                    :aria-label="isEn ? 'Search logs' : '搜索日志'"
                >
                    <template #leading><Search :size="16" /></template>
                </UiInput>
                <UiSelect
                    v-model="timeRange"
                    compact
                    :aria-label="isEn ? 'Time range' : '时间范围'"
                >
                    <option value="all">{{ isEn ? 'All Time' : '全部时间' }}</option>
                    <option value="1h">1h</option>
                    <option value="6h">6h</option>
                    <option value="1d">1d</option>
                    <option value="7d">7d</option>
                </UiSelect>
                <UiSelect v-model="categoryFilter" compact :aria-label="isEn ? 'Category' : '分类'">
                    <option value="all">{{ isEn ? 'All Categories' : '全部分类' }}</option>
                    <option v-for="category in categories" :key="category" :value="category">
                        {{ category }}
                    </option>
                </UiSelect>
                <UiSelect
                    v-model="displayLimit"
                    compact
                    :aria-label="isEn ? 'Display limit' : '显示条数'"
                >
                    <option value="all">{{ isEn ? 'All' : '全部' }}</option>
                    <option value="5000">5K</option>
                    <option value="10000">10K</option>
                    <option value="50000">50K</option>
                    <option value="100000">100K</option>
                </UiSelect>
            </div>
            <div class="kam-actions kam-logs-levels" :aria-label="isEn ? 'Log level' : '日志等级'">
                <UiButton
                    v-for="level in levels"
                    :key="level"
                    dense
                    :variant="levelFilter === level ? 'secondary' : 'ghost'"
                    :aria-pressed="levelFilter === level"
                    @click="levelFilter = level"
                >
                    {{ level === 'ALL' ? (isEn ? 'All' : '全部') : level }}
                    <span class="kam-mono">{{ levelCounts[level] }}</span>
                </UiButton>
            </div>
        </UiCard>

        <UiCard density="compact" class="kam-logs-list" data-testid="log-list">
            <div v-if="!filteredLogs.length" class="kam-logs-empty kam-muted">
                {{ isEn ? 'No logs to display' : '暂无日志' }}
                <small v-if="filter">{{
                    isEn ? 'Try adjusting your filter' : '尝试调整搜索条件'
                }}</small>
            </div>
            <div
                v-else
                ref="scrollElement"
                class="kam-logs-scroll kam-mono"
                data-testid="log-scroll"
                :aria-label="isEn ? 'Logs' : '日志列表'"
                @scroll="handleScroll"
            >
                <div
                    class="kam-logs-virtual"
                    :style="{ height: `${virtualizer.getTotalSize()}px` }"
                >
                    <div
                        v-for="row in virtualRows"
                        :key="row.key"
                        :ref="measureRow"
                        class="kam-logs-row"
                        :data-index="row.index"
                        data-testid="log-row"
                        role="button"
                        tabindex="0"
                        :aria-expanded="expandedIdx === row.index"
                        :style="{ transform: `translateY(${row.start}px)` }"
                        @click="toggleExpanded(row.index)"
                        @keydown.enter.prevent="toggleExpanded(row.index)"
                        @keydown.space.prevent="toggleExpanded(row.index)"
                    >
                        <div class="kam-logs-row-main">
                            <time class="kam-muted" :datetime="filteredLogs[row.index].timestamp">{{
                                formatTime(filteredLogs[row.index].timestamp)
                            }}</time>
                            <UiBadge dense :tone="levelTone(filteredLogs[row.index].level)">{{
                                filteredLogs[row.index].level
                            }}</UiBadge>
                            <span
                                class="kam-logs-category kam-muted"
                                :title="filteredLogs[row.index].category"
                                >{{ filteredLogs[row.index].category }}</span
                            >
                            <span class="kam-logs-message">{{
                                filteredLogs[row.index].message
                            }}</span>
                        </div>
                        <pre
                            v-if="expandedIdx === row.index && filteredLogs[row.index].data != null"
                            class="kam-logs-data"
                            >{{ formatData(filteredLogs[row.index].data) }}</pre
                        >
                    </div>
                </div>
            </div>
            <div v-if="!isAtBottom && filteredLogs.length" class="kam-logs-follow-placement">
                <UiButton dense class="kam-logs-follow" @click="scrollToBottom">
                    <ArrowDown :size="14" />
                    {{
                        newLogCount
                            ? isEn
                                ? `${newLogCount} new`
                                : `${newLogCount} 条新日志`
                            : isEn
                              ? 'Bottom'
                              : '回到底部'
                    }}
                </UiButton>
            </div>
        </UiCard>

        <footer class="kam-logs-footer kam-muted">
            <span
                >{{ isEn ? 'Showing' : '显示' }}
                <span class="kam-mono">{{ filteredLogs.length.toLocaleString() }}</span> /
                <span class="kam-mono">{{ logs.length.toLocaleString() }}</span></span
            >
            <UiBadge v-if="levelCounts.ERROR" dense tone="error"
                >{{ levelCounts.ERROR }} {{ isEn ? 'errors' : '错误' }}</UiBadge
            >
            <UiBadge v-if="levelCounts.WARN" dense tone="warning"
                >{{ levelCounts.WARN }} {{ isEn ? 'warnings' : '警告' }}</UiBadge
            >
            <span class="kam-logs-follow-status"
                ><ArrowDown :size="14" />
                {{
                    isAtBottom
                        ? isEn
                            ? 'Following'
                            : '跟随中'
                        : isEn
                          ? 'Scrolled up'
                          : '已暂停跟随'
                }}</span
            >
        </footer>
    </div>
</template>

<style scoped>
.kam-logs-page {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
}
.kam-logs-filters {
    flex: none;
}
.kam-logs-filters :deep(.ui-card-content) {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.kam-logs-search {
    flex: 1 1 240px;
    min-width: 180px;
}
.kam-logs-levels {
    gap: 4px;
}
.kam-logs-list {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
}
.kam-logs-list :deep(.ui-card-content) {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 0;
}
.kam-logs-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    font-size: 11px;
}
.kam-logs-virtual {
    position: relative;
    width: 100%;
}
.kam-logs-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
}
.kam-logs-row:hover {
    background: var(--hover);
}
.kam-logs-row-main {
    display: grid;
    grid-template-columns: 100px 64px 100px minmax(0, 1fr);
    align-items: start;
    gap: 8px;
    padding: 5px 12px;
}
.kam-logs-row-main time {
    white-space: nowrap;
}
.kam-logs-category {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kam-logs-message,
.kam-logs-data {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
.kam-logs-data {
    margin: 0 12px 8px 284px;
    padding: 8px;
    border-radius: 6px;
    background: var(--soft);
    color: var(--muted);
}
.kam-logs-empty {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}
.kam-logs-follow-placement {
    position: absolute;
    right: 12px;
    bottom: 12px;
}
.kam-logs-footer {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 12px;
}
.kam-logs-follow-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
}
@media (max-width: 760px) {
    .kam-logs-row-main {
        grid-template-columns: 85px 60px minmax(0, 1fr);
    }
    .kam-logs-category {
        display: none;
    }
    .kam-logs-data {
        margin-left: 12px;
    }
}
</style>
