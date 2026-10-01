<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiCheckbox,
    UiDialog,
    UiField,
    UiSelect
} from '@lingyzh/ui'
import { Check, RefreshCw } from 'lucide-vue-next'
import { useAccountsStore } from '../../stores/accounts'
import { useTranslation } from '../../composables/useTranslation'
import { toIpcData } from '../../lib/ipcData'
import ClaudeDesktopConfig from './ClaudeDesktopConfig.vue'

const props = defineProps({
    open: { type: Boolean, required: true },
    isEn: { type: Boolean, default: undefined }
})
const emit = defineEmits(['update:open'])
const accounts = useAccountsStore()
const { actualLanguage } = useTranslation()
const isEn = computed(() => props.isEn ?? actualLanguage.value === 'en')
const desktopTab = ref(true)
const desktopBusy = ref(false)
const models = ref([])
const selectedModelId = ref('')
const selectedClients = ref([])
const loadingModels = ref(false)
const applying = ref(false)
const error = ref('')
const results = ref([])
const proxyBase = ref('')
const selectedModel = computed(() =>
    models.value.find((model) => model.id === selectedModelId.value)
)
const clientOptions = computed(() => [
    {
        id: 'claudeCode',
        name: 'Claude Code',
        description: isEn.value
            ? 'Writes ANTHROPIC_BASE_URL, API key and default model'
            : '写入 ANTHROPIC_BASE_URL、API Key 和默认模型'
    },
    {
        id: 'opencode',
        name: 'OpenCode',
        description: isEn.value
            ? 'Adds Kiro provider and model metadata to opencode.json'
            : '向 opencode.json 添加 Kiro provider 和模型元数据'
    },
    {
        id: 'codex',
        name: 'Codex CLI',
        description: isEn.value
            ? 'Adds Kiro OpenAI Responses provider'
            : '添加 Kiro OpenAI Responses provider'
    },
    {
        id: 'gemini',
        name: 'Gemini CLI',
        description: isEn.value
            ? 'Writes .env and settings.json for Gemini v1beta'
            : '写入 .env 和 settings.json 配置 Gemini v1beta'
    },
    {
        id: 'hermes',
        name: 'Hermes',
        description: isEn.value
            ? 'Adds Kiro provider to config.yaml'
            : '向 config.yaml 添加 Kiro provider'
    },
    {
        id: 'openclaw',
        name: 'OpenClaw',
        description: isEn.value
            ? 'Adds Kiro provider to openclaw.json'
            : '向 openclaw.json 添加 Kiro provider'
    }
])
let generation = 0
let mounted = true

function close() {
    if (desktopBusy.value || applying.value) return
    emit('update:open', false)
}

function changeTab(next) {
    if (desktopBusy.value || applying.value) return
    desktopTab.value = next
}

function toggleClient(id) {
    if (applying.value) return
    results.value = []
    selectedClients.value = selectedClients.value.includes(id)
        ? selectedClients.value.filter((client) => client !== id)
        : [...selectedClients.value, id]
}

function chooseModel(id) {
    selectedModelId.value = id
    results.value = []
}

function chooseLoadedModels(entries) {
    models.value = entries
    if (!entries.some((model) => model.id === selectedModelId.value))
        selectedModelId.value = entries[0]?.id || ''
}

async function loadModels() {
    if (!props.open || loadingModels.value) return
    const current = generation
    loadingModels.value = true
    error.value = ''
    results.value = []
    try {
        const proxyModels = await window.api.proxyGetModels()
        if (!mounted || !props.open || current !== generation) return
        if (proxyModels.success && proxyModels.models?.length) {
            chooseLoadedModels(proxyModels.models)
            return
        }
        const active = accounts.activeAccountId
            ? accounts.accounts.get(accounts.activeAccountId)
            : undefined
        const eligible = (item) => item?.status === 'active' && item.credentials?.accessToken
        const account = eligible(active)
            ? active
            : Array.from(accounts.accounts.values()).find(eligible)
        if (account) {
            const accountModels = await window.api.accountGetModels(
                account.credentials.accessToken,
                account.credentials.region || 'us-east-1',
                account.profileArn,
                account.machineId,
                account.credentials.provider || account.idp,
                account.credentials.authMethod,
                account.id
            )
            if (!mounted || !props.open || current !== generation) return
            if (accountModels.success && accountModels.models?.length) {
                chooseLoadedModels(accountModels.models)
                return
            }
        }
        models.value = []
        selectedModelId.value = ''
        error.value = isEn.value
            ? 'No models were loaded. Please check whether the account is active and try reloading.'
            : '未加载到模型，请确认账号已激活后重新加载。'
    } catch (cause) {
        if (mounted && props.open && current === generation) {
            models.value = []
            selectedModelId.value = ''
            error.value = cause instanceof Error ? cause.message : String(cause)
        }
    } finally {
        if (mounted && props.open && current === generation) loadingModels.value = false
    }
}

async function applyConfig() {
    if (applying.value || desktopBusy.value) return
    if (!selectedModelId.value || !selectedClients.value.length) {
        error.value = !selectedModelId.value
            ? isEn.value
                ? 'Please select a model'
                : '请选择模型'
            : isEn.value
              ? 'Please select at least one client'
              : '请至少选择一个客户端'
        return
    }
    const current = generation
    applying.value = true
    error.value = ''
    results.value = []
    try {
        const result = await window.api.proxyConfigureClients(
            toIpcData({
                clients: selectedClients.value,
                modelId: selectedModelId.value,
                modelName: selectedModel.value?.name,
                models: models.value.map((model) => ({
                    id: model.id,
                    name: model.name,
                    inputTypes: model.inputTypes,
                    maxInputTokens: model.maxInputTokens,
                    maxOutputTokens: model.maxOutputTokens
                }))
            })
        )
        if (!mounted || !props.open || current !== generation) return
        proxyBase.value = result.openaiBaseUrl || result.proxyOrigin || ''
        results.value = result.results || []
        if (!result.success)
            error.value =
                result.error ||
                (isEn.value ? 'Some clients failed to configure' : '部分客户端配置失败')
    } catch (cause) {
        if (mounted && props.open && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && props.open && current === generation) applying.value = false
    }
}

watch(
    () => props.open,
    (open) => {
        generation += 1
        if (open) void loadModels()
        else {
            loadingModels.value = false
            applying.value = false
            desktopBusy.value = false
        }
    },
    { immediate: true }
)
onBeforeUnmount(() => {
    mounted = false
    generation += 1
})
</script>

<template>
    <UiDialog
        :open="open"
        size="xl"
        scrollable
        :aria-label="isEn ? 'One-Click Client Configuration' : '一键配置客户端'"
        :content-label="isEn ? 'Client configuration' : '客户端配置'"
        data-testid="client-config-dialog"
        @update:open="
            (value) => {
                if (!value) close()
            }
        "
    >
        <template #header
            ><h2>{{ isEn ? 'One-Click Client Configuration' : '一键配置客户端' }}</h2>
            <UiBadge tone="accent"
                >{{ selectedClients.length }} {{ isEn ? 'selected' : '个已选择' }}</UiBadge
            ><UiBadge v-if="proxyBase" tone="neutral">{{ proxyBase }}</UiBadge></template
        >
        <div v-if="open" class="kam-dialog-content">
            <div class="kam-actions">
                <UiButton
                    :variant="desktopTab ? 'primary' : 'secondary'"
                    :disabled="desktopBusy || applying"
                    data-testid="client-tab-desktop"
                    @click="changeTab(true)"
                    >Claude Desktop</UiButton
                >
                <UiButton
                    :variant="!desktopTab ? 'primary' : 'secondary'"
                    :disabled="desktopBusy || applying"
                    data-testid="client-tab-others"
                    @click="changeTab(false)"
                    >{{ isEn ? 'Other clients' : '其他客户端' }}</UiButton
                >
            </div>
            <ClaudeDesktopConfig
                v-if="desktopTab"
                :models="models"
                :loading="loadingModels"
                :is-en="isEn"
                :busy="desktopBusy"
                @busy-change="desktopBusy = $event"
                @reload="loadModels"
            />
            <template v-else>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'The selected model becomes the client default model.'
                            : '此处选择的模型会写入客户端配置，作为客户端默认模型。'
                    }}
                </p>
                <UiCard density="compact">
                    <div class="kam-actions">
                        <strong>{{ isEn ? 'Model' : '模型' }}</strong
                        ><UiButton
                            variant="secondary"
                            size="sm"
                            :loading="loadingModels"
                            :disabled="loadingModels"
                            data-testid="client-reload-models"
                            @click="loadModels"
                            ><RefreshCw :size="16" />{{ isEn ? 'Reload' : '重新加载' }}</UiButton
                        >
                    </div>
                    <p v-if="loadingModels" class="kam-muted">
                        {{ isEn ? 'Loading models…' : '加载模型中…' }}
                    </p>
                    <UiField
                        v-else-if="models.length"
                        :label="isEn ? 'Available model' : '可用模型'"
                        ><UiSelect
                            :model-value="selectedModelId"
                            data-testid="client-model"
                            @update:model-value="chooseModel"
                            ><option v-for="model in models" :key="model.id" :value="model.id">
                                {{ model.id
                                }}{{
                                    model.name && model.name !== model.id ? ` · ${model.name}` : ''
                                }}
                            </option></UiSelect
                        ></UiField
                    >
                    <p v-else class="kam-muted">{{ isEn ? 'No models loaded' : '暂无模型' }}</p>
                    <div v-if="selectedModel" class="kam-actions">
                        <UiBadge tone="neutral">{{
                            selectedModel.name || selectedModel.id
                        }}</UiBadge
                        ><UiBadge
                            v-for="type in selectedModel.inputTypes || []"
                            :key="type"
                            tone="neutral"
                            >{{ type }}</UiBadge
                        >
                    </div>
                </UiCard>
                <div class="kam-client-grid">
                    <UiCard v-for="option in clientOptions" :key="option.id" density="compact"
                        ><UiCheckbox
                            :model-value="selectedClients.includes(option.id)"
                            :disabled="applying"
                            :data-testid="`client-select-${option.id}`"
                            @update:model-value="toggleClient(option.id)"
                            ><strong>{{ option.name }}</strong></UiCheckbox
                        >
                        <p class="kam-muted">{{ option.description }}</p></UiCard
                    >
                </div>
                <UiAlert tone="warning">{{
                    isEn
                        ? 'Existing client files are merged and backed up before writing.'
                        : '写入时会合并原配置并先创建备份。'
                }}</UiAlert>
                <UiAlert
                    v-if="error"
                    tone="error"
                    :title="isEn ? 'Configuration failed' : '配置失败'"
                    data-testid="client-config-error"
                    >{{ error }}</UiAlert
                >
                <div v-if="results.length" class="kam-client-results">
                    <UiCard v-for="result in results" :key="result.client" density="compact"
                        ><div class="kam-actions">
                            <strong>{{
                                clientOptions.find((option) => option.id === result.client)?.name ||
                                result.client
                            }}</strong
                            ><UiBadge :tone="result.success ? 'success' : 'error'">{{
                                result.success
                                    ? isEn
                                        ? 'Configured'
                                        : '已配置'
                                    : isEn
                                      ? 'Failed'
                                      : '失败'
                            }}</UiBadge>
                        </div>
                        <p v-if="result.error">{{ result.error }}</p>
                        <template v-else
                            ><p v-for="path in result.paths || []" :key="path" class="kam-mono">
                                {{ path }}
                            </p>
                            <p v-if="result.backupPaths?.length" class="kam-muted">
                                {{ isEn ? 'Backups created' : '已创建备份' }}:
                                {{ result.backupPaths.length }}
                            </p></template
                        ></UiCard
                    >
                </div>
                <div class="kam-actions kam-client-footer">
                    <UiButton variant="secondary" :disabled="applying" @click="close">{{
                        isEn ? 'Close' : '关闭'
                    }}</UiButton
                    ><UiButton
                        :loading="applying"
                        :disabled="
                            loadingModels || applying || !selectedModelId || !selectedClients.length
                        "
                        data-testid="client-apply"
                        @click="applyConfig"
                        ><Check :size="16" />{{
                            applying
                                ? isEn
                                    ? 'Configuring…'
                                    : '配置中…'
                                : isEn
                                  ? 'Apply Configuration'
                                  : '应用配置'
                        }}</UiButton
                    >
                </div>
            </template>
        </div>
        <template #footer
            ><UiButton variant="ghost" :disabled="desktopBusy || applying" @click="close">{{
                isEn ? 'Close' : '关闭'
            }}</UiButton></template
        >
    </UiDialog>
</template>

<style scoped>
.kam-client-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
}
.kam-client-results {
    display: grid;
    gap: 8px;
}
.kam-client-footer {
    justify-content: flex-end;
}
.kam-client-results :deep(p) {
    overflow-wrap: anywhere;
}
</style>
