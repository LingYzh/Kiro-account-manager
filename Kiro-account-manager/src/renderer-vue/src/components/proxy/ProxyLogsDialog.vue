<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { UiAlert, UiBadge, UiButton, UiDialog } from '@lingyzh/ui'
import { Download, RotateCcw, Trash2 } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'

const props = defineProps({
    open: { type: Boolean, required: true },
    logs: { type: Array, required: true },
    totalCredits: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    onClear: { type: Function, required: true },
    onResetCredits: { type: Function, default: undefined },
    onResetTokens: { type: Function, default: undefined },
    isEn: { type: Boolean, default: undefined }
})
const emit = defineEmits(['update:open'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => props.isEn ?? actualLanguage.value === 'en')
const successCount = computed(() => props.logs.filter((log) => log.status < 400).length)
const errorCount = computed(() => props.logs.filter((log) => log.status >= 400).length)
const recentCredits = computed(() => props.logs.reduce((sum, log) => sum + (log.credits || 0), 0))
const recentTokens = computed(() => props.logs.reduce((sum, log) => sum + (log.tokens || 0), 0))
const expandedError = ref(-1)
const pending = ref('')
const error = ref('')
let generation = 0
let mounted = true

watch(
    () => props.open,
    (open) => {
        generation += 1
        if (!open) {
            pending.value = ''
            error.value = ''
        }
    }
)

onBeforeUnmount(() => {
    mounted = false
    generation += 1
})

function exportLogs() {
    const content = props.logs
        .map(
            (log) =>
                `${log.time}\t${log.path}\t${log.status}${log.credits ? `\t${log.credits.toFixed(6)} credits` : ''}`
        )
        .join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `proxy-logs-${new Date().toISOString().slice(0, 10)}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
}

async function invokeAction(action, callback) {
    if (pending.value) return
    pending.value = action
    error.value = ''
    const current = generation
    try {
        const result = await callback()
        if (result === false) throw new Error(isEn.value ? 'Operation failed' : '操作失败')
    } catch (cause) {
        if (mounted && props.open && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && props.open && current === generation) pending.value = ''
    }
}

function toggleError(index) {
    expandedError.value = expandedError.value === index ? -1 : index
}

function displayModel(model) {
    return model ? model.replace('anthropic.', '').replace('-v1:0', '') : '-'
}
</script>

<template>
    <UiDialog
        :open="open"
        size="xl"
        scrollable
        :aria-label="isEn ? 'Request Logs' : '请求日志'"
        :content-label="isEn ? 'Proxy request history' : '反代请求历史'"
        data-testid="proxy-logs-dialog"
        @update:open="emit('update:open', $event)"
    >
        <template #header
            ><h2>{{ isEn ? 'Request Logs' : '请求日志' }}</h2></template
        >
        <div class="kam-dialog-content">
            <div class="kam-actions">
                <UiButton
                    variant="secondary"
                    :disabled="!logs.length || Boolean(pending)"
                    data-testid="proxy-logs-export"
                    @click="exportLogs"
                    ><Download :size="16" />{{ isEn ? 'Export' : '导出' }}</UiButton
                >
                <UiButton
                    variant="secondary"
                    :loading="pending === 'clear'"
                    :disabled="!logs.length || Boolean(pending)"
                    data-testid="proxy-logs-clear"
                    @click="invokeAction('clear', onClear)"
                    ><Trash2 :size="16" />{{ isEn ? 'Clear' : '清空' }}</UiButton
                >
            </div>
            <UiAlert
                v-if="error"
                tone="error"
                :title="isEn ? 'Operation failed' : '操作失败'"
                data-testid="proxy-logs-error"
                >{{ error }}</UiAlert
            >
            <div class="kam-logs-stats">
                <span
                    >{{ isEn ? 'Total' : '总计' }}
                    <UiBadge tone="neutral">{{ logs.length }}</UiBadge></span
                >
                <span
                    >{{ isEn ? 'Success' : '成功' }}
                    <UiBadge tone="success">{{ successCount }}</UiBadge></span
                >
                <span
                    >{{ isEn ? 'Error' : '错误' }}
                    <UiBadge tone="error">{{ errorCount }}</UiBadge></span
                >
                <span
                    >Tokens {{ isEn ? 'Recent' : '最近' }}
                    <UiBadge tone="neutral">{{ recentTokens.toLocaleString() }}</UiBadge></span
                >
                <span
                    >Tokens {{ isEn ? 'Total' : '总计' }}
                    <UiBadge tone="neutral">{{ totalTokens.toLocaleString() }}</UiBadge
                    ><UiButton
                        v-if="onResetTokens"
                        icon
                        size="sm"
                        variant="ghost"
                        :disabled="Boolean(pending)"
                        :aria-label="isEn ? 'Reset total tokens' : '重置 Token 总计'"
                        data-testid="proxy-logs-reset-tokens"
                        @click="invokeAction('tokens', onResetTokens)"
                        ><RotateCcw :size="14" /></UiButton
                ></span>
                <span
                    >Credits {{ isEn ? 'Recent' : '最近' }}
                    <UiBadge tone="neutral">{{ recentCredits.toFixed(4) }}</UiBadge></span
                >
                <span
                    >Credits {{ isEn ? 'Total' : '总计' }}
                    <UiBadge tone="neutral">{{ totalCredits.toFixed(4) }}</UiBadge
                    ><UiButton
                        v-if="onResetCredits"
                        icon
                        size="sm"
                        variant="ghost"
                        :disabled="Boolean(pending)"
                        :aria-label="isEn ? 'Reset total credits' : '重置 Credits 总计'"
                        data-testid="proxy-logs-reset-credits"
                        @click="invokeAction('credits', onResetCredits)"
                        ><RotateCcw :size="14" /></UiButton
                ></span>
            </div>
            <p v-if="!logs.length" class="kam-muted">{{ isEn ? 'No logs yet' : '暂无日志' }}</p>
            <div v-else class="kam-proxy-log-table">
                <table>
                    <thead>
                        <tr>
                            <th>{{ isEn ? 'Time' : '时间' }}</th>
                            <th>{{ isEn ? 'Path' : '路径' }}</th>
                            <th>{{ isEn ? 'Model' : '模型' }}</th>
                            <th>{{ isEn ? 'Status' : '状态' }}</th>
                            <th>In</th>
                            <th>Out</th>
                            <th>Cache</th>
                            <th>Credits</th>
                            <th>{{ isEn ? 'Time' : '耗时' }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="(log, index) in logs"
                            :key="index"
                            :data-testid="`proxy-log-row-${index}`"
                        >
                            <td class="kam-mono">{{ log.time }}</td>
                            <td class="kam-mono" :title="log.path">{{ log.path }}</td>
                            <td class="kam-mono" :title="log.model">
                                {{ displayModel(log.model) }}
                            </td>
                            <td>
                                <UiButton
                                    v-if="log.status >= 400 && log.error"
                                    variant="ghost"
                                    size="sm"
                                    :aria-expanded="expandedError === index"
                                    :data-testid="`proxy-log-error-${index}`"
                                    @click="toggleError(index)"
                                    ><UiBadge tone="error">{{ log.status }}</UiBadge></UiButton
                                ><UiBadge v-else :tone="log.status >= 400 ? 'error' : 'success'">{{
                                    log.status
                                }}</UiBadge>
                                <pre
                                    v-if="expandedError === index && log.error"
                                    class="kam-proxy-log-error"
                                    >{{ log.error }}</pre
                                >
                            </td>
                            <td>{{ log.inputTokens ? log.inputTokens.toLocaleString() : '-' }}</td>
                            <td>
                                {{ log.outputTokens ? log.outputTokens.toLocaleString() : '-' }}
                            </td>
                            <td>
                                {{
                                    log.cacheReadTokens ? log.cacheReadTokens.toLocaleString() : '-'
                                }}
                            </td>
                            <td>{{ log.credits ? log.credits.toFixed(6) : '-' }}</td>
                            <td>
                                {{
                                    log.responseTime
                                        ? `${(log.responseTime / 1000).toFixed(1)}s`
                                        : '-'
                                }}
                            </td>
                        </tr>
                    </tbody>
                </table>
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
.kam-logs-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
}
.kam-logs-stats > span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}
.kam-proxy-log-table {
    overflow: auto;
    max-height: 52vh;
}
.kam-proxy-log-table table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}
.kam-proxy-log-table th,
.kam-proxy-log-table td {
    text-align: left;
    padding: 7px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
}
.kam-proxy-log-table td {
    overflow-wrap: anywhere;
}
.kam-proxy-log-error {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-width: 300px;
}
</style>
