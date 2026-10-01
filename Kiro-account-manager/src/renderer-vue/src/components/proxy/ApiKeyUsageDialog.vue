<script setup>
import { computed, ref } from 'vue'
import { UiBadge, UiButton, UiCard, UiDialog, UiProgress } from '@lingyzh/ui'
import { useTranslation } from '../../composables/useTranslation'

const props = defineProps({
    open: { type: Boolean, required: true },
    apiKey: { type: Object, default: null },
    isEn: { type: Boolean, default: undefined }
})
const emit = defineEmits(['update:open'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => props.isEn ?? actualLanguage.value === 'en')
const activeTab = ref('history')
const dailyChartData = computed(() =>
    Object.entries(props.apiKey?.usage?.daily || {})
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 7)
        .reverse()
        .map(([date, stats]) => ({ date: date.slice(5), ...stats }))
)
const dailyRows = computed(() =>
    Object.entries(props.apiKey?.usage?.daily || {})
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 30)
)
const modelStats = computed(() =>
    Object.entries(props.apiKey?.usage?.byModel || {})
        .map(([model, stats]) => ({ model: formatModel(model), ...stats }))
        .sort((a, b) => b.requests - a.requests)
)
const maxDailyCredits = computed(() =>
    Math.max(...dailyChartData.value.map((item) => item.credits), 0.001)
)
const maxModelRequests = computed(() =>
    Math.max(...modelStats.value.map((item) => item.requests), 1)
)

function formatModel(model) {
    return model.replace('anthropic.', '').replace('-v1:0', '')
}
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString()
}
</script>

<template>
    <UiDialog
        :open="open"
        size="xl"
        scrollable
        :aria-label="isEn ? 'Usage Details' : '用量详情'"
        :content-label="isEn ? 'API key usage' : 'API 密钥用量'"
        data-testid="api-key-usage-dialog"
        @update:open="emit('update:open', $event)"
    >
        <template #header
            ><h2>{{ isEn ? 'Usage Details' : '用量详情' }} · {{ apiKey?.name }}</h2></template
        >
        <div v-if="open && apiKey" class="kam-dialog-content">
            <div class="kam-key-stats">
                <UiCard density="compact"
                    ><small class="kam-muted">{{ isEn ? 'Total Requests' : '总请求数' }}</small
                    ><strong>{{ apiKey.usage.totalRequests.toLocaleString() }}</strong></UiCard
                ><UiCard density="compact"
                    ><small class="kam-muted">{{ isEn ? 'Total Credits' : '总 Credits' }}</small
                    ><strong>{{ apiKey.usage.totalCredits.toFixed(4) }}</strong></UiCard
                ><UiCard density="compact"
                    ><small class="kam-muted">{{ isEn ? 'Input Tokens' : '输入 Tokens' }}</small
                    ><strong>{{ apiKey.usage.totalInputTokens.toLocaleString() }}</strong></UiCard
                ><UiCard density="compact"
                    ><small class="kam-muted">{{ isEn ? 'Output Tokens' : '输出 Tokens' }}</small
                    ><strong>{{ apiKey.usage.totalOutputTokens.toLocaleString() }}</strong></UiCard
                >
            </div>
            <div class="kam-actions">
                <UiButton
                    :variant="activeTab === 'history' ? 'primary' : 'secondary'"
                    size="sm"
                    data-testid="usage-tab-history"
                    @click="activeTab = 'history'"
                    >{{ isEn ? 'History' : '历史记录' }}</UiButton
                ><UiButton
                    :variant="activeTab === 'model' ? 'primary' : 'secondary'"
                    size="sm"
                    data-testid="usage-tab-model"
                    @click="activeTab = 'model'"
                    >{{ isEn ? 'By Model' : '按模型' }}</UiButton
                ><UiButton
                    :variant="activeTab === 'daily' ? 'primary' : 'secondary'"
                    size="sm"
                    data-testid="usage-tab-daily"
                    @click="activeTab = 'daily'"
                    >{{ isEn ? 'Daily Stats' : '每日统计' }}</UiButton
                >
            </div>
            <template v-if="activeTab === 'history'"
                ><div v-if="apiKey.usageHistory?.length" class="kam-usage-table">
                    <table>
                        <thead>
                            <tr>
                                <th>{{ isEn ? 'Time' : '时间' }}</th>
                                <th>{{ isEn ? 'Model' : '模型' }}</th>
                                <th>{{ isEn ? 'Path' : '路径' }}</th>
                                <th>{{ isEn ? 'In' : '输入' }}</th>
                                <th>{{ isEn ? 'Out' : '输出' }}</th>
                                <th>Credits</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(record, index) in apiKey.usageHistory" :key="index">
                                <td>{{ formatTime(record.timestamp) }}</td>
                                <td :title="record.model">{{ formatModel(record.model) }}</td>
                                <td :title="record.path">{{ record.path }}</td>
                                <td>{{ record.inputTokens.toLocaleString() }}</td>
                                <td>{{ record.outputTokens.toLocaleString() }}</td>
                                <td>{{ record.credits.toFixed(6) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-else class="kam-muted">
                    {{ isEn ? 'No usage history yet' : '暂无用量记录' }}
                </p></template
            >
            <template v-else-if="activeTab === 'model'"
                ><UiCard v-for="stat in modelStats" :key="stat.model" density="compact"
                    ><div class="kam-actions">
                        <strong>{{ stat.model }}</strong
                        ><UiBadge tone="accent"
                            >{{ stat.requests }} {{ isEn ? 'requests' : '次请求' }}</UiBadge
                        >
                    </div>
                    <UiProgress
                        :value="stat.requests"
                        :max="maxModelRequests"
                        tone="accent"
                        :label="stat.model"
                        dense
                    />
                    <div class="kam-actions kam-mono">
                        <span>Credits: {{ stat.credits.toFixed(4) }}</span
                        ><span
                            >{{ isEn ? 'Input' : '输入' }}:
                            {{ stat.inputTokens.toLocaleString() }}</span
                        ><span
                            >{{ isEn ? 'Output' : '输出' }}:
                            {{ stat.outputTokens.toLocaleString() }}</span
                        >
                    </div></UiCard
                >
                <p v-if="!modelStats.length" class="kam-muted">
                    {{ isEn ? 'No model statistics yet' : '暂无模型统计' }}
                </p></template
            >
            <template v-else
                ><UiCard v-if="dailyChartData.length" density="compact"
                    ><strong>{{
                        isEn ? 'Daily Credits (Last 7 Days)' : '每日 Credits（最近7天）'
                    }}</strong>
                    <div class="kam-daily-chart">
                        <div v-for="day in dailyChartData" :key="day.date">
                            <div
                                class="kam-daily-bar"
                                :style="{
                                    height: `${Math.max(4, (day.credits / maxDailyCredits) * 100)}%`
                                }"
                                :title="`${day.credits.toFixed(4)} credits`"
                            ></div>
                            <small>{{ day.date }}</small>
                        </div>
                    </div></UiCard
                >
                <div v-if="dailyRows.length" class="kam-usage-table">
                    <table>
                        <thead>
                            <tr>
                                <th>{{ isEn ? 'Date' : '日期' }}</th>
                                <th>{{ isEn ? 'Requests' : '请求数' }}</th>
                                <th>Credits</th>
                                <th>{{ isEn ? 'Input' : '输入' }}</th>
                                <th>{{ isEn ? 'Output' : '输出' }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="[date, stats] in dailyRows" :key="date">
                                <td>{{ date }}</td>
                                <td>{{ stats.requests }}</td>
                                <td>{{ stats.credits.toFixed(4) }}</td>
                                <td>{{ stats.inputTokens.toLocaleString() }}</td>
                                <td>{{ stats.outputTokens.toLocaleString() }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-if="!dailyRows.length" class="kam-muted">
                    {{ isEn ? 'No daily statistics yet' : '暂无每日统计' }}
                </p></template
            >
        </div>
        <template #footer
            ><UiButton variant="secondary" @click="emit('update:open', false)">{{
                isEn ? 'Close' : '关闭'
            }}</UiButton></template
        >
    </UiDialog>
</template>

<style scoped>
.kam-key-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
}
.kam-key-stats :deep(strong) {
    display: block;
    font-size: 1.25rem;
}
.kam-usage-table {
    overflow-x: auto;
}
.kam-usage-table table {
    width: 100%;
    border-collapse: collapse;
    white-space: nowrap;
}
.kam-usage-table th,
.kam-usage-table td {
    padding: 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
}
.kam-daily-chart {
    display: flex;
    align-items: end;
    gap: 8px;
    height: 140px;
    margin-top: 12px;
}
.kam-daily-chart > div {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: end;
    text-align: center;
}
.kam-daily-bar {
    min-height: 4px;
    background: var(--accent);
    border-radius: 4px 4px 0 0;
}
</style>
