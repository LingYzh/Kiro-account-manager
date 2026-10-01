<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiDialog,
    UiField,
    UiInput,
    UiSelect,
    UiSwitch,
    confirmDialog
} from '@lingyzh/ui'
import { Check, Copy, Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { toIpcData } from '../../lib/ipcData'
import ApiKeyUsageDialog from './ApiKeyUsageDialog.vue'

const props = defineProps({
    open: { type: Boolean, required: true },
    isEn: { type: Boolean, default: undefined }
})
const emit = defineEmits(['update:open'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => props.isEn ?? actualLanguage.value === 'en')
const apiKeys = ref([])
const loading = ref(false)
const pending = ref('')
const error = ref('')
const newKeyName = ref('')
const newKeyFormat = ref('sk')
const newKeyCreditsLimit = ref('')
const copiedId = ref('')
const showKeys = ref(new Set())
const selectedKey = ref('')
const usageOpen = ref(false)
const limitDraft = ref('')
const selectedKeyData = computed(() => apiKeys.value.find((key) => key.id === selectedKey.value))
let generation = 0
let mounted = true
let copyTimer

function clearCopyTimer() {
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = undefined
}

function maskKey(key) {
    return key.slice(0, 8) + '...' + key.slice(-4)
}
function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString()
}

function selectKey(id) {
    selectedKey.value = selectedKey.value === id ? '' : id
    limitDraft.value = selectedKeyData.value?.creditsLimit
        ? String(selectedKeyData.value.creditsLimit)
        : ''
}

function toggleShowKey(id) {
    const next = new Set(showKeys.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    showKeys.value = next
}

async function copyToClipboard(id, key) {
    const current = generation
    try {
        await navigator.clipboard.writeText(key)
        if (!mounted || !props.open || current !== generation) return
        copiedId.value = id
        clearCopyTimer()
        copyTimer = setTimeout(() => {
            if (mounted) copiedId.value = ''
        }, 2000)
    } catch (cause) {
        if (mounted && props.open && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    }
}

async function loadApiKeys() {
    if (!props.open || loading.value) return
    const current = generation
    loading.value = true
    error.value = ''
    try {
        const result = await window.api.proxyGetApiKeys()
        if (!mounted || !props.open || current !== generation) return
        if (!result.success)
            throw new Error(
                result.error || (isEn.value ? 'Could not load API keys' : '无法加载 API 密钥')
            )
        apiKeys.value = result.apiKeys || []
        if (selectedKey.value && !apiKeys.value.some((key) => key.id === selectedKey.value))
            selectedKey.value = ''
    } catch (cause) {
        if (mounted && props.open && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && props.open && current === generation) loading.value = false
    }
}

async function addKey() {
    if (pending.value || !newKeyName.value.trim()) return
    const current = generation
    pending.value = 'add'
    error.value = ''
    try {
        const creditsLimit = newKeyCreditsLimit.value
            ? Number.parseFloat(newKeyCreditsLimit.value)
            : undefined
        const result = await window.api.proxyAddApiKey(
            toIpcData({
                name: newKeyName.value.trim(),
                format: newKeyFormat.value,
                creditsLimit: creditsLimit && creditsLimit > 0 ? creditsLimit : undefined
            })
        )
        if (!mounted || !props.open || current !== generation) return
        if (!result.success || !result.apiKey)
            throw new Error(
                result.error || (isEn.value ? 'Could not add API key' : '添加 API 密钥失败')
            )
        apiKeys.value = [...apiKeys.value, result.apiKey]
        newKeyName.value = ''
        newKeyCreditsLimit.value = ''
    } catch (cause) {
        if (mounted && props.open && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && props.open && current === generation) pending.value = ''
    }
}

async function deleteKey(id) {
    if (pending.value) return
    const current = generation
    const confirmed = await confirmDialog({
        title: isEn.value ? 'Delete API key' : '删除 API 密钥',
        message: isEn.value ? 'Delete this API key?' : '确定删除此 API Key？',
        tone: 'danger'
    })
    if (!confirmed || !mounted || !props.open || current !== generation || pending.value) return
    pending.value = id
    error.value = ''
    try {
        const result = await window.api.proxyDeleteApiKey(id)
        if (!mounted || !props.open || current !== generation) return
        if (!result.success)
            throw new Error(
                result.error || (isEn.value ? 'Could not delete API key' : '删除 API 密钥失败')
            )
        apiKeys.value = apiKeys.value.filter((key) => key.id !== id)
        if (selectedKey.value === id) {
            selectedKey.value = ''
            usageOpen.value = false
        }
    } catch (cause) {
        if (mounted && props.open && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && props.open && current === generation) pending.value = ''
    }
}

async function updateKey(id, updates, operation) {
    if (pending.value) return
    const current = generation
    pending.value = id
    error.value = ''
    try {
        const result = await window.api.proxyUpdateApiKey(id, toIpcData(updates))
        if (!mounted || !props.open || current !== generation) return
        if (!result.success)
            throw new Error(
                result.error || (isEn.value ? 'Could not update API key' : '更新 API 密钥失败')
            )
        apiKeys.value = apiKeys.value.map((key) => (key.id === id ? { ...key, ...operation } : key))
    } catch (cause) {
        if (mounted && props.open && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && props.open && current === generation) pending.value = ''
    }
}

async function saveLimit() {
    if (!selectedKeyData.value || pending.value) return
    const parsed = limitDraft.value ? Number.parseFloat(limitDraft.value) : null
    const limit = parsed && parsed > 0 ? parsed : null
    await updateKey(
        selectedKeyData.value.id,
        { creditsLimit: limit },
        { creditsLimit: limit || undefined }
    )
}

async function resetUsage(id) {
    if (pending.value) return
    const current = generation
    const confirmed = await confirmDialog({
        title: isEn.value ? 'Reset usage' : '重置用量',
        message: isEn.value ? 'Reset usage statistics?' : '确定重置用量统计？',
        tone: 'danger'
    })
    if (!confirmed || !mounted || !props.open || current !== generation || pending.value) return
    pending.value = id
    error.value = ''
    try {
        const result = await window.api.proxyResetApiKeyUsage(id)
        if (!mounted || !props.open || current !== generation) return
        if (!result.success)
            throw new Error(result.error || (isEn.value ? 'Could not reset usage' : '重置用量失败'))
        apiKeys.value = apiKeys.value.map((key) =>
            key.id === id
                ? {
                      ...key,
                      usage: {
                          totalRequests: 0,
                          totalCredits: 0,
                          totalInputTokens: 0,
                          totalOutputTokens: 0,
                          daily: {}
                      },
                      usageHistory: []
                  }
                : key
        )
    } catch (cause) {
        if (mounted && props.open && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && props.open && current === generation) pending.value = ''
    }
}

watch(
    () => props.open,
    (open) => {
        generation += 1
        if (open) void loadApiKeys()
        else {
            loading.value = false
            pending.value = ''
            usageOpen.value = false
            copiedId.value = ''
            clearCopyTimer()
        }
    },
    { immediate: true }
)
onBeforeUnmount(() => {
    mounted = false
    generation += 1
    clearCopyTimer()
})
</script>

<template>
    <UiDialog
        :open="open"
        size="xl"
        scrollable
        :aria-label="isEn ? 'API Keys' : 'API 密钥'"
        :content-label="isEn ? 'API key manager' : 'API 密钥管理'"
        data-testid="api-key-manager"
        @update:open="emit('update:open', $event)"
    >
        <template #header
            ><h2>{{ isEn ? 'API Keys' : 'API 密钥' }}</h2>
            <UiBadge tone="accent"
                >{{ apiKeys.length }} {{ isEn ? 'keys' : '个' }}</UiBadge
            ></template
        >
        <div v-if="open" class="kam-dialog-content">
            <p class="kam-muted">
                {{ isEn ? 'Manage API keys for authentication' : '管理用于身份验证的 API 密钥' }}
            </p>
            <UiAlert
                v-if="error"
                tone="error"
                :title="isEn ? 'Operation failed' : '操作失败'"
                data-testid="api-key-error"
                >{{ error }}</UiAlert
            >
            <UiCard density="compact"
                ><div class="kam-key-form">
                    <UiField :label="isEn ? 'Key name' : '密钥名称'"
                        ><UiInput
                            v-model="newKeyName"
                            :placeholder="isEn ? 'Key name…' : '密钥名称…'"
                            data-testid="api-key-name"
                            @keydown.enter="addKey" /></UiField
                    ><UiField :label="isEn ? 'Format' : '格式'"
                        ><UiSelect v-model="newKeyFormat" data-testid="api-key-format"
                            ><option value="sk">sk-xxx</option>
                            <option value="simple">PROXY_KEY</option>
                            <option value="token">KEY:TOKEN</option></UiSelect
                        ></UiField
                    ><UiButton
                        :loading="pending === 'add'"
                        :disabled="Boolean(pending) || !newKeyName.trim()"
                        data-testid="api-key-add"
                        @click="addKey"
                        >{{ isEn ? 'Add' : '添加' }}</UiButton
                    >
                </div>
                <UiField
                    :label="
                        isEn
                            ? 'Credits limit (optional, 0 = unlimited)'
                            : 'Credits 额度限制（可选，0 = 无限制）'
                    "
                    ><UiInput
                        v-model="newKeyCreditsLimit"
                        type="number"
                        min="0"
                        data-testid="api-key-new-limit" /></UiField
            ></UiCard>
            <div v-if="loading" class="kam-muted">
                {{ isEn ? 'Loading API keys…' : '加载 API 密钥中…' }}
            </div>
            <p v-else-if="!apiKeys.length" class="kam-muted">
                {{ isEn ? 'No API keys yet' : '暂无 API 密钥' }}
            </p>
            <div v-else class="kam-key-list">
                <UiCard
                    v-for="apiKey in apiKeys"
                    :key="apiKey.id"
                    density="compact"
                    :data-testid="`api-key-${apiKey.id}`"
                    :class="{ 'kam-key-disabled': !apiKey.enabled }"
                    ><div class="kam-key-row">
                        <UiSwitch
                            :model-value="apiKey.enabled"
                            :disabled="Boolean(pending)"
                            :aria-label="isEn ? `Enable ${apiKey.name}` : `启用 ${apiKey.name}`"
                            :data-testid="`api-key-enabled-${apiKey.id}`"
                            @update:model-value="
                                updateKey(apiKey.id, { enabled: $event }, { enabled: $event })
                            "
                        />
                        <div class="kam-key-main">
                            <UiButton
                                variant="ghost"
                                :data-testid="`api-key-select-${apiKey.id}`"
                                @click="selectKey(apiKey.id)"
                                >{{ apiKey.name }}</UiButton
                            >
                            <div class="kam-key-secret">
                                <code class="kam-mono">{{
                                    showKeys.has(apiKey.id) ? apiKey.key : maskKey(apiKey.key)
                                }}</code
                                ><UiButton
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="isEn ? 'Show or hide key' : '显示或隐藏密钥'"
                                    :data-testid="`api-key-show-${apiKey.id}`"
                                    @click="toggleShowKey(apiKey.id)"
                                    ><EyeOff v-if="showKeys.has(apiKey.id)" :size="14" /><Eye
                                        v-else
                                        :size="14" /></UiButton
                                ><UiButton
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="isEn ? 'Copy key' : '复制密钥'"
                                    :data-testid="`api-key-copy-${apiKey.id}`"
                                    @click="copyToClipboard(apiKey.id, apiKey.key)"
                                    ><Check v-if="copiedId === apiKey.id" :size="14" /><Copy
                                        v-else
                                        :size="14"
                                /></UiButton>
                            </div>
                        </div>
                        <div class="kam-key-usage">
                            <div>
                                {{ apiKey.usage.totalRequests }} {{ isEn ? 'requests' : '请求' }}
                            </div>
                            <div>
                                {{ apiKey.usage.totalCredits.toFixed(2)
                                }}{{ apiKey.creditsLimit ? `/${apiKey.creditsLimit}` : '' }} credits
                            </div>
                        </div>
                        <UiButton
                            variant="ghost"
                            size="sm"
                            :disabled="Boolean(pending)"
                            :aria-label="isEn ? 'Delete key' : '删除密钥'"
                            :data-testid="`api-key-delete-${apiKey.id}`"
                            @click="deleteKey(apiKey.id)"
                            ><Trash2 :size="16"
                        /></UiButton></div
                ></UiCard>
            </div>
            <UiCard v-if="selectedKeyData" density="compact" data-testid="api-key-selected"
                ><div class="kam-actions">
                    <h3>{{ isEn ? 'Usage Details' : '用量详情' }}: {{ selectedKeyData.name }}</h3>
                    <UiButton
                        variant="secondary"
                        size="sm"
                        data-testid="api-key-view-usage"
                        @click="usageOpen = true"
                        >{{ isEn ? 'View Details' : '查看详情' }}</UiButton
                    ><UiButton
                        variant="secondary"
                        size="sm"
                        :disabled="Boolean(pending)"
                        data-testid="api-key-reset-usage"
                        @click="resetUsage(selectedKeyData.id)"
                        ><RefreshCw :size="16" />{{ isEn ? 'Reset Usage' : '重置用量' }}</UiButton
                    >
                </div>
                <div class="kam-key-stats">
                    <div>
                        <small class="kam-muted">{{ isEn ? 'Total Requests' : '总请求数' }}</small
                        ><strong>{{ selectedKeyData.usage.totalRequests }}</strong>
                    </div>
                    <div>
                        <small class="kam-muted">{{ isEn ? 'Total Credits' : '总 Credits' }}</small
                        ><strong>{{ selectedKeyData.usage.totalCredits.toFixed(2) }}</strong>
                    </div>
                    <div>
                        <small class="kam-muted">{{ isEn ? 'Input Tokens' : '输入 Tokens' }}</small
                        ><strong>{{
                            selectedKeyData.usage.totalInputTokens.toLocaleString()
                        }}</strong>
                    </div>
                    <div>
                        <small class="kam-muted">{{ isEn ? 'Output Tokens' : '输出 Tokens' }}</small
                        ><strong>{{
                            selectedKeyData.usage.totalOutputTokens.toLocaleString()
                        }}</strong>
                    </div>
                </div>
                <div class="kam-actions">
                    <UiField
                        :label="
                            isEn
                                ? 'Credits Limit (0 = unlimited)'
                                : 'Credits 额度限制（0 = 无限制）'
                        "
                        ><UiInput
                            v-model="limitDraft"
                            type="number"
                            min="0"
                            data-testid="api-key-limit"
                            @keydown.enter="saveLimit" /></UiField
                    ><UiButton
                        variant="secondary"
                        :disabled="Boolean(pending)"
                        data-testid="api-key-save-limit"
                        @click="saveLimit"
                        >{{ isEn ? 'Save limit' : '保存额度' }}</UiButton
                    >
                </div>
                <p class="kam-muted">
                    {{ isEn ? 'Created:' : '创建时间:' }}
                    {{ formatDate(selectedKeyData.createdAt) }}
                </p>
                <p v-if="selectedKeyData.lastUsedAt" class="kam-muted">
                    {{ isEn ? 'Last used:' : '最后使用:' }}
                    {{ formatDate(selectedKeyData.lastUsedAt) }}
                </p></UiCard
            >
        </div>
        <template #footer
            ><UiButton variant="secondary" @click="emit('update:open', false)">{{
                isEn ? 'Close' : '关闭'
            }}</UiButton></template
        >
    </UiDialog>
    <ApiKeyUsageDialog
        :open="usageOpen && open"
        :api-key="selectedKeyData || null"
        :is-en="isEn"
        @update:open="usageOpen = $event"
    />
</template>

<style scoped>
.kam-key-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px auto;
    align-items: end;
    gap: 8px;
}
.kam-key-list {
    display: grid;
    gap: 8px;
}
.kam-key-row,
.kam-key-secret,
.kam-key-stats {
    display: flex;
    align-items: center;
    gap: 8px;
}
.kam-key-main {
    min-width: 0;
    flex: 1;
}
.kam-key-secret code {
    overflow: hidden;
    text-overflow: ellipsis;
}
.kam-key-usage {
    text-align: right;
    font-size: 0.8rem;
    white-space: nowrap;
}
.kam-key-disabled {
    opacity: 0.55;
}
.kam-key-stats {
    flex-wrap: wrap;
    justify-content: space-between;
}
.kam-key-stats strong {
    display: block;
}
@media (max-width: 700px) {
    .kam-key-form {
        grid-template-columns: 1fr;
    }
    .kam-key-row {
        flex-wrap: wrap;
    }
    .kam-key-usage {
        text-align: left;
    }
}
</style>
