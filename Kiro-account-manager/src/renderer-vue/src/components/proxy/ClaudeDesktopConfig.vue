<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { UiAlert, UiButton, UiCard, UiField, UiInput, UiRadio, UiSelect } from '@lingyzh/ui'
import { Plus, RotateCcw, Trash2 } from 'lucide-vue-next'
import {
    defaultDesktopRoutes,
    desktopModelName,
    desktopClientModelId,
    DESKTOP_ROLE_IDS
} from '../../../../shared/desktopConfig'
import { toIpcData } from '../../lib/ipcData'

const props = defineProps({
    models: { type: Array, required: true },
    loading: { type: Boolean, required: true },
    isEn: { type: Boolean, required: true },
    busy: { type: Boolean, required: true }
})
const emit = defineEmits(['busy-change', 'reload'])
const input = ref(defaultDesktopRoutes([]))
const ready = ref(false)
const preview = ref(null)
const operations = ref([])
const error = ref('')
const message = ref('')
const restoreId = ref('')
const working = ref(false)
const modelKey = computed(() => JSON.stringify(props.models))
const missingModels = computed(() =>
    input.value.routes.some((route) => !props.models.some((model) => model.id === route.modelId))
)
const recoverable = computed(() =>
    operations.value.filter((operation) => operation.status !== 'restored')
)
const pending = computed(() =>
    recoverable.value.some((operation) => operation.status === 'pending')
)
const selectedOperation = computed(() =>
    recoverable.value.find((operation) => operation.id === restoreId.value)
)
let initialized = false
let generation = 0
let mounted = true

function change(next) {
    initialized = true
    input.value = next
    preview.value = null
    error.value = ''
    message.value = ''
}

function updateRoute(routeId, updates) {
    change({
        ...input.value,
        routes: input.value.routes.map((route) =>
            route.id === routeId ? { ...route, ...updates } : route
        )
    })
}

function changeFamily(route, family) {
    const id = `${DESKTOP_ROLE_IDS[family]}-kam-${crypto.randomUUID().slice(0, 8)}`
    change({
        ...input.value,
        routes: input.value.routes.map((item) =>
            item.id === route.id ? { ...item, family, id } : item
        ),
        defaultRouteId: input.value.defaultRouteId === route.id ? id : input.value.defaultRouteId
    })
}

function addRoute() {
    if (input.value.routes.length >= 50) return
    let suffix = 2
    while (
        input.value.routes.some((route) => route.id === `${DESKTOP_ROLE_IDS.sonnet}-kam-${suffix}`)
    )
        suffix += 1
    change({
        ...input.value,
        routes: [
            ...input.value.routes,
            {
                id: `${DESKTOP_ROLE_IDS.sonnet}-kam-${suffix}`,
                family: 'sonnet',
                label: props.isEn ? `Model ${suffix}` : `模型 ${suffix}`,
                modelId: ''
            }
        ]
    })
}

function removeRoute(routeId) {
    const routes = input.value.routes.filter((route) => route.id !== routeId)
    change({
        ...input.value,
        routes,
        defaultRouteId:
            input.value.defaultRouteId === routeId ? routes[0].id : input.value.defaultRouteId
    })
}

async function refreshOperations(refreshInput = false, current = generation) {
    const result = await window.api.proxyDesktopState()
    if (!mounted || current !== generation) return
    if (!result.success) throw new Error(result.error)
    operations.value = result.data.operations || []
    if (refreshInput) {
        input.value = result.data.input || defaultDesktopRoutes(props.models)
        initialized = true
        preview.value = null
    }
}

async function loadState() {
    const current = ++generation
    try {
        const result = await window.api.proxyDesktopState()
        if (!mounted || current !== generation) return
        if (!result.success) throw new Error(result.error)
        if (result.data.input) {
            initialized = true
            input.value = result.data.input
        }
        operations.value = result.data.operations || []
        ready.value = true
    } catch (cause) {
        if (mounted && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    }
}

async function run(action) {
    if (working.value || !ready.value) return
    if (action === 'apply' && !preview.value) return
    if (action === 'restore' && !restoreId.value) return
    const current = generation
    const inputRevision = input.value
    const catalogRevision = modelKey.value
    working.value = true
    emit('busy-change', true)
    error.value = ''
    message.value = ''
    try {
        if (action === 'preview') {
            const result = await window.api.proxyDesktopPreview(toIpcData(input.value))
            if (!mounted || current !== generation) return
            if (!result.success) throw new Error(result.error)
            if (inputRevision === input.value && catalogRevision === modelKey.value)
                preview.value = result.data
        } else if (action === 'apply') {
            const token = preview.value.token
            const result = await window.api.proxyDesktopApply(token)
            if (!mounted || current !== generation) return
            preview.value = null
            if (!result.success) throw new Error(result.error)
            message.value = props.isEn
                ? 'Configuration written. Start the KAM proxy, then launch Claude Desktop. Live inference has not been tested.'
                : '配置已写入。先启动 KAM 反代，再启动 Claude Desktop；尚未验证真实推理请求。'
            await refreshOperations(false, current)
        } else {
            const operationId = restoreId.value
            const result = await window.api.proxyDesktopRestore(operationId)
            if (!mounted || current !== generation) return
            if (!result.success) throw new Error(result.error)
            restoreId.value = ''
            preview.value = null
            message.value = props.isEn
                ? 'Restored the files to their state before this operation.'
                : '已恢复到此次操作之前的文件状态。'
            await refreshOperations(true, current)
        }
    } catch (cause) {
        if (mounted && current === generation) {
            error.value = cause instanceof Error ? cause.message : String(cause)
            await refreshOperations(false, current).catch(() => {})
        }
    } finally {
        working.value = false
        if (mounted && current === generation) emit('busy-change', false)
    }
}

watch(modelKey, () => {
    preview.value = null
    if (ready.value && props.models.length && !initialized) {
        initialized = true
        input.value = defaultDesktopRoutes(props.models)
    }
})
watch(ready, (value) => {
    if (value && props.models.length && !initialized) {
        initialized = true
        input.value = defaultDesktopRoutes(props.models)
    }
})
void loadState()
onBeforeUnmount(() => {
    mounted = false
    generation += 1
    emit('busy-change', false)
})
</script>

<template>
    <div class="kam-desktop-config" data-testid="desktop-config">
        <UiCard density="compact">
            <h3>
                {{
                    isEn
                        ? 'Claude Desktop · First-launch gateway setup'
                        : 'Claude Desktop · 首次启动网关配置'
                }}
            </h3>
            <p class="kam-muted">
                {{
                    isEn
                        ? 'Creates and activates a dedicated KAM 3P profile. Each menu entry maps to the actual target model below; other clients are unaffected.'
                        : '创建并选中独立的 KAM 3P 配置。每个菜单条目映射到下方实际目标模型，不影响其他客户端。'
                }}
            </p>
            <p class="kam-muted">
                {{
                    isEn
                        ? 'Apply before first launch, or fully quit Desktop first. Existing MCP, preferences and other gateway profiles are preserved.'
                        : '可在首次启动前配置；已运行时请先完全退出 Desktop。保留已有 MCP、偏好和其他网关配置。'
                }}
            </p>
        </UiCard>
        <fieldset :disabled="busy || !ready" class="kam-desktop-routes">
            <div class="kam-actions">
                <strong>{{ isEn ? 'Desktop model menu' : 'Desktop 模型菜单' }}</strong>
                <UiButton
                    variant="secondary"
                    size="sm"
                    :disabled="loading || busy"
                    data-testid="desktop-reload"
                    @click="emit('reload')"
                    >{{ isEn ? 'Reload models' : '刷新模型' }}</UiButton
                >
            </div>
            <UiCard
                v-for="(route, index) in input.routes"
                :key="route.id"
                density="compact"
                :data-testid="`desktop-route-${index}`"
            >
                <div class="kam-actions">
                    <UiRadio
                        :model-value="input.defaultRouteId"
                        :value="route.id"
                        name="desktop-default-model"
                        @update:model-value="change({ ...input, defaultRouteId: route.id })"
                        >{{
                            input.defaultRouteId === route.id
                                ? isEn
                                    ? 'Default model'
                                    : '默认模型'
                                : isEn
                                  ? 'Set as default'
                                  : '设为默认'
                        }}</UiRadio
                    >
                    <UiButton
                        v-if="index >= 3"
                        variant="ghost"
                        size="sm"
                        :aria-label="isEn ? 'Remove model' : '删除模型'"
                        :data-testid="`desktop-remove-${index}`"
                        @click="removeRoute(route.id)"
                        ><Trash2 :size="16"
                    /></UiButton>
                </div>
                <div class="kam-desktop-route-fields">
                    <UiField :label="isEn ? 'Role' : '档位'">
                        <UiSelect
                            :model-value="route.family"
                            :disabled="index < 3"
                            :data-testid="`desktop-family-${index}`"
                            @update:model-value="changeFamily(route, $event)"
                            ><option value="opus">Opus</option>
                            <option value="sonnet">Sonnet</option>
                            <option value="haiku">Haiku</option></UiSelect
                        >
                    </UiField>
                    <UiField :label="isEn ? 'Menu label' : '菜单名称'"
                        ><UiInput
                            :model-value="desktopModelName(route.modelId)"
                            readonly
                            :data-testid="`desktop-label-${index}`"
                    /></UiField>
                </div>
                <UiField :label="isEn ? 'Actual target model' : '实际调用的模型'">
                    <UiSelect
                        :model-value="route.modelId"
                        :data-testid="`desktop-target-${index}`"
                        @update:model-value="updateRoute(route.id, { modelId: $event })"
                    >
                        <option value="">{{ isEn ? 'Select a model' : '请选择模型' }}</option>
                        <option
                            v-if="
                                route.modelId && !models.some((model) => model.id === route.modelId)
                            "
                            :value="route.modelId"
                        >
                            {{ route.modelId }} · {{ isEn ? 'not in catalog' : '当前列表中不可用' }}
                        </option>
                        <option v-for="model in models" :key="model.id" :value="model.id">
                            {{ model.id
                            }}{{ model.name && model.name !== model.id ? ` · ${model.name}` : '' }}
                        </option>
                    </UiSelect>
                </UiField>
                <p class="kam-muted kam-mono">
                    {{ isEn ? 'Client request ID: ' : '客户端请求 ID：'
                    }}{{ desktopClientModelId(route) }}
                </p>
            </UiCard>
            <UiButton
                variant="secondary"
                :disabled="input.routes.length >= 50"
                data-testid="desktop-add-route"
                @click="addRoute"
                ><Plus :size="16" />{{ isEn ? 'Add model entry' : '添加模型条目' }}</UiButton
            >
        </fieldset>
        <UiAlert
            v-if="missingModels && !loading"
            tone="warning"
            :title="isEn ? 'Missing target models' : '缺少目标模型'"
            >{{
                isEn
                    ? 'Select an available target for each role. Missing roles are not silently substituted.'
                    : '请为每档选择可用模型；缺少对应档位时不会自动替换为其他模型。'
            }}</UiAlert
        >
        <UiAlert
            v-if="error"
            tone="error"
            :title="isEn ? 'Configuration failed' : '配置失败'"
            data-testid="desktop-error"
            >{{ error }}</UiAlert
        >
        <UiButton
            v-if="!ready && error"
            variant="secondary"
            data-testid="desktop-retry-state"
            @click="loadState"
            >{{ isEn ? 'Retry loading' : '重试加载' }}</UiButton
        >
        <UiAlert v-if="message" tone="success" :title="isEn ? 'Completed' : '已完成'">{{
            message
        }}</UiAlert>
        <UiCard v-if="preview" density="compact" data-testid="desktop-preview">
            <h4>{{ isEn ? 'Review changes' : '确认写入内容' }}</h4>
            <p class="kam-mono">{{ preview.proxyOrigin }}</p>
            <p v-for="model in preview.models" :key="model">{{ model }}</p>
            <div v-for="file in preview.files" :key="file.path">
                <p class="kam-mono">{{ file.path }}</p>
                <p class="kam-muted">
                    {{
                        !file.changed
                            ? isEn
                                ? 'Unchanged'
                                : '无需更改'
                            : file.exists
                              ? isEn
                                  ? 'Update with backup'
                                  : '备份后更新'
                              : isEn
                                ? 'Create'
                                : '新建'
                    }}
                    · {{ file.fields.join(', ') }}
                </p>
            </div>
            <UiAlert v-for="warning in preview.warnings" :key="warning" tone="warning">{{
                warning
            }}</UiAlert>
        </UiCard>
        <div class="kam-actions kam-desktop-actions">
            <UiButton
                variant="secondary"
                :disabled="busy || loading || !ready || missingModels || pending"
                data-testid="desktop-preview-action"
                @click="run('preview')"
                >{{ isEn ? 'Preview configuration' : '预览配置' }}</UiButton
            >
            <UiButton
                :disabled="busy || loading || !preview || pending"
                data-testid="desktop-apply"
                @click="run('apply')"
                >{{ isEn ? 'Apply 3P gateway' : '应用 3P 网关配置' }}</UiButton
            >
        </div>
        <details
            v-if="recoverable.length"
            :open="pending || undefined"
            data-testid="desktop-operations"
        >
            <summary>
                {{ isEn ? 'Backups and recovery' : '备份与恢复' }} ({{ recoverable.length }})
            </summary>
            <p class="kam-muted">
                {{
                    isEn
                        ? 'Restores all files changed by the selected operation, including model routes. External edits block restoration.'
                        : '恢复所选操作修改的全部文件（含模型映射）。文件若被外部改动，会阻止恢复。'
                }}
            </p>
            <UiSelect
                v-model="restoreId"
                :aria-label="isEn ? 'Operation to restore' : '选择恢复记录'"
                data-testid="desktop-restore-operation"
                ><option value="">{{ isEn ? 'Select an operation' : '选择操作记录' }}</option>
                <option v-for="operation in recoverable" :key="operation.id" :value="operation.id">
                    {{ operation.createdAt }} · {{ operation.status }}
                </option></UiSelect
            >
            <div v-if="selectedOperation">
                <p v-for="path in selectedOperation.paths" :key="path" class="kam-mono">
                    {{ path }}
                </p>
                <UiButton
                    variant="secondary"
                    size="sm"
                    :disabled="busy"
                    data-testid="desktop-restore"
                    @click="run('restore')"
                    ><RotateCcw :size="16" />{{
                        isEn ? 'Restore these files' : '恢复上述文件'
                    }}</UiButton
                >
            </div>
        </details>
    </div>
</template>

<style scoped>
.kam-desktop-config,
.kam-desktop-routes {
    display: grid;
    gap: 16px;
    min-width: 0;
}
.kam-desktop-route-fields {
    display: grid;
    grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr);
    gap: 12px;
}
.kam-desktop-actions {
    justify-content: flex-end;
}
.kam-desktop-config :deep(p) {
    overflow-wrap: anywhere;
}
@media (max-width: 700px) {
    .kam-desktop-route-fields {
        grid-template-columns: 1fr;
    }
}
</style>
