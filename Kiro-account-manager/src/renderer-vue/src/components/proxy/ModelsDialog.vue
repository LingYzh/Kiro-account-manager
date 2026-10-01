<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { UiAlert, UiBadge, UiButton, UiCard, UiDialog } from '@lingyzh/ui'
import { RefreshCw, Shuffle } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import ModelIdentityDetails from './ModelIdentityDetails.vue'
import ModelIdentitySettings from './ModelIdentitySettings.vue'

const props = defineProps({
    open: { type: Boolean, required: true },
    mappingEnabled: { type: Boolean, required: true },
    mappingCount: { type: Number, default: 0 },
    onMappingEnabledChange: { type: Function, required: true },
    isEn: { type: Boolean, default: undefined }
})
const emit = defineEmits(['update:open', 'open-model-mapping'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => props.isEn ?? actualLanguage.value === 'en')
const models = ref([])
const loading = ref(false)
const fromCache = ref(false)
const error = ref('')
const showIpTip = ref(localStorage.getItem('models_dialog_ip_tip_dismissed') !== '1')
let sequence = 0
let mounted = true

function formatTokens(value) {
    if (value === null || value === undefined) return '-'
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`
    return String(value)
}

function dismissIpTip() {
    localStorage.setItem('models_dialog_ip_tip_dismissed', '1')
    showIpTip.value = false
}

async function fetchModels() {
    if (!props.open) return
    const current = ++sequence
    loading.value = true
    error.value = ''
    try {
        const result = await window.api.proxyGetModels()
        if (!mounted || !props.open || current !== sequence) return
        if (result.success) {
            models.value = result.models || []
            fromCache.value = Boolean(result.fromCache)
        } else {
            error.value = result.error || (isEn.value ? 'Failed to fetch models' : '获取模型失败')
        }
    } catch (cause) {
        if (mounted && props.open && current === sequence)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && props.open && current === sequence) loading.value = false
    }
}

watch(
    () => [props.open, props.mappingEnabled],
    ([open]) => {
        sequence += 1
        if (open) void fetchModels()
        else loading.value = false
    },
    { immediate: true }
)

onBeforeUnmount(() => {
    mounted = false
    sequence += 1
})
</script>

<template>
    <UiDialog
        :open="open"
        size="xl"
        scrollable
        :aria-label="isEn ? 'Available Models' : '可用模型'"
        :content-label="isEn ? 'Model catalog' : '模型目录'"
        data-testid="proxy-models-dialog"
        @update:open="emit('update:open', $event)"
    >
        <template #header
            ><h2>{{ isEn ? 'Available Models' : '可用模型' }}</h2>
            <UiBadge tone="accent">{{ models.length }} {{ isEn ? 'models' : '个模型' }}</UiBadge
            ><UiBadge v-if="fromCache" tone="warning">{{
                isEn ? 'Cached' : '缓存'
            }}</UiBadge></template
        >
        <div v-if="open" class="kam-dialog-content">
            <div class="kam-actions">
                <UiButton
                    variant="secondary"
                    data-testid="proxy-model-mapping-open"
                    @click="emit('open-model-mapping')"
                    ><Shuffle :size="16" />{{ isEn ? 'Mapping' : '映射'
                    }}<UiBadge v-if="mappingCount" tone="accent">{{
                        mappingCount
                    }}</UiBadge></UiButton
                >
                <UiButton
                    variant="secondary"
                    :loading="loading"
                    :disabled="loading"
                    data-testid="proxy-models-refresh"
                    @click="fetchModels"
                    ><RefreshCw :size="16" />{{ isEn ? 'Refresh' : '刷新' }}</UiButton
                >
            </div>
            <ModelIdentitySettings
                :enabled="mappingEnabled"
                :on-enabled-change="onMappingEnabledChange"
                :is-en="isEn"
            />
            <UiAlert
                v-if="showIpTip"
                tone="warning"
                :title="
                    isEn
                        ? 'Pro subscription but missing advanced models?'
                        : '订阅 Pro 但看不到高级模型？'
                "
                data-testid="proxy-models-ip-tip"
            >
                {{
                    isEn
                        ? 'Regional IP restrictions may hide models. Try a VPN or app proxy, choose a suitable outbound IP, then refresh.'
                        : '可能受到国内 IP 区域限制。请尝试系统或应用代理，切换优质外网 IP 后刷新。'
                }}
                <template #actions
                    ><UiButton
                        variant="ghost"
                        size="sm"
                        data-testid="proxy-models-dismiss-ip-tip"
                        @click="dismissIpTip"
                        >{{ isEn ? "Don't show again" : '不再显示' }}</UiButton
                    ></template
                >
            </UiAlert>
            <UiAlert
                v-if="error"
                tone="error"
                :title="isEn ? 'Could not load models' : '模型加载失败'"
                data-testid="proxy-models-error"
                >{{ error }}</UiAlert
            >
            <p v-if="loading && !models.length" class="kam-muted">
                {{ isEn ? 'Loading models…' : '加载模型中…' }}
            </p>
            <p v-else-if="!error && !models.length" class="kam-muted">
                {{ isEn ? 'No models available' : '暂无可用模型' }}
            </p>
            <div v-if="models.length" class="kam-model-grid">
                <UiCard
                    v-for="model in models"
                    :key="model.id"
                    density="compact"
                    :data-testid="`proxy-model-${model.id}`"
                >
                    <strong>{{ model.name || model.id }}</strong>
                    <p class="kam-muted">
                        {{ model.description || (isEn ? 'No description' : '无描述') }}
                    </p>
                    <ModelIdentityDetails
                        :source-id="model.upstreamId || model.id"
                        :client-id="model.clientId || model.id"
                        :is-en="isEn"
                    />
                    <div class="kam-model-meta">
                        <UiBadge v-if="model.inputTypes?.includes('TEXT')" tone="neutral"
                            >TEXT</UiBadge
                        >
                        <UiBadge v-if="model.inputTypes?.includes('IMAGE')" tone="neutral"
                            >IMAGE</UiBadge
                        >
                        <UiBadge
                            v-if="model.supportsThinking"
                            tone="success"
                            :title="model.thinkingEfforts?.join(', ')"
                            >{{ isEn ? 'Thinking' : '推理' }}
                            {{ model.thinkingEfforts?.join(', ') }}</UiBadge
                        >
                        <UiBadge v-if="model.supportsPromptCaching" tone="accent">{{
                            isEn ? 'Cache' : '缓存'
                        }}</UiBadge>
                        <UiBadge v-if="model.rateMultiplier !== undefined" tone="warning"
                            >{{ model.rateMultiplier }}x {{ model.rateUnit || 'credit' }}</UiBadge
                        >
                        <span class="kam-mono kam-muted"
                            >{{ formatTokens(model.maxInputTokens) }} /
                            {{ formatTokens(model.maxOutputTokens) }}</span
                        >
                    </div>
                </UiCard>
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
.kam-model-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
}
.kam-model-grid > * {
    min-width: 0;
}
.kam-model-grid strong {
    display: block;
    overflow-wrap: anywhere;
}
.kam-model-grid p {
    margin: 4px 0 10px;
}
.kam-model-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
}
@media (max-width: 740px) {
    .kam-model-grid {
        grid-template-columns: 1fr;
    }
}
</style>
