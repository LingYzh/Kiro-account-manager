<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCheckbox,
    UiDialog,
    UiField,
    UiInput,
    UiSelect,
    UiSwitch
} from '@lingyzh/ui'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-vue-next'
import { toIpcData } from '../../lib/ipcData'

const props = defineProps({
    open: { type: Boolean, required: true },
    mappings: { type: Array, required: true },
    availableModels: { type: Array, required: true },
    apiKeys: { type: Array, required: true },
    onMappingsChange: { type: Function, required: true },
    isEn: { type: Boolean, required: true }
})
const emit = defineEmits(['update:open'])
const localMappings = ref([])
const expandedId = ref('')
const saving = ref(false)
const error = ref('')
let generation = 0
let mounted = true

watch(
    () => props.open,
    (open) => {
        generation += 1
        if (open) {
            localMappings.value = toIpcData(props.mappings)
            expandedId.value = ''
            error.value = ''
        } else saving.value = false
    },
    { immediate: true }
)

onBeforeUnmount(() => {
    mounted = false
    generation += 1
})

function addRule() {
    const id = `mapping_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    localMappings.value.push({
        id,
        name: props.isEn ? 'New Rule' : '新规则',
        enabled: true,
        type: 'replace',
        sourceModel: '',
        targetModels: [''],
        priority: localMappings.value.length,
        apiKeyIds: []
    })
    expandedId.value = id
}

function deleteRule(id) {
    localMappings.value = localMappings.value.filter((rule) => rule.id !== id)
    if (expandedId.value === id) expandedId.value = ''
}

function moveRule(id, direction) {
    const index = localMappings.value.findIndex((rule) => rule.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= localMappings.value.length) return
    ;[localMappings.value[index], localMappings.value[target]] = [
        localMappings.value[target],
        localMappings.value[index]
    ]
    localMappings.value.forEach((rule, position) => {
        rule.priority = position
    })
}

function addTarget(rule) {
    rule.targetModels.push('')
    if (rule.weights) rule.weights.push(1)
}

function removeTarget(rule, index) {
    if (rule.targetModels.length < 2) return
    rule.targetModels.splice(index, 1)
    if (rule.weights) rule.weights.splice(index, 1)
}

function updateWeight(rule, index, value) {
    if (!rule.weights) rule.weights = rule.targetModels.map(() => 1)
    rule.weights[index] = Number.parseInt(value, 10) || 1
}

function toggleKey(rule, id, checked) {
    const existing = rule.apiKeyIds || []
    rule.apiKeyIds = checked ? [...existing, id] : existing.filter((item) => item !== id)
}

function close() {
    if (saving.value) return
    emit('update:open', false)
}

async function save() {
    if (saving.value) return
    const current = generation
    saving.value = true
    error.value = ''
    try {
        const result = await props.onMappingsChange(toIpcData(localMappings.value))
        if (!mounted || !props.open || current !== generation) return
        if (result === false)
            throw new Error(props.isEn ? 'Could not save model mappings' : '模型映射保存失败')
        emit('update:open', false)
    } catch (cause) {
        if (mounted && props.open && current === generation)
            error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (mounted && current === generation) saving.value = false
    }
}

function typeLabel(type) {
    return type === 'replace'
        ? props.isEn
            ? 'Replace'
            : '替换'
        : type === 'alias'
          ? props.isEn
              ? 'Alias'
              : '别名'
          : props.isEn
            ? 'Load Balance'
            : '负载均衡'
}
</script>

<template>
    <UiDialog
        :open="open"
        size="xl"
        scrollable
        :aria-label="isEn ? 'Model Mapping' : '模型映射'"
        :content-label="isEn ? 'Mapping rules' : '映射规则'"
        data-testid="proxy-mapping-dialog"
        @update:open="
            (value) => {
                if (!value) close()
            }
        "
    >
        <template #header
            ><h2>{{ isEn ? 'Model Mapping' : '模型映射' }}</h2>
            <UiBadge tone="accent"
                >{{ localMappings.length }} {{ isEn ? 'rules' : '条规则' }}</UiBadge
            ></template
        >
        <div class="kam-dialog-content">
            <div class="kam-actions">
                <UiButton variant="secondary" data-testid="mapping-add" @click="addRule"
                    ><Plus :size="16" />{{ isEn ? 'Add Rule' : '添加规则' }}</UiButton
                >
            </div>
            <UiAlert
                v-if="error"
                tone="error"
                :title="isEn ? 'Save failed' : '保存失败'"
                data-testid="mapping-error"
                >{{ error }}</UiAlert
            >
            <p v-if="!localMappings.length" class="kam-muted">
                {{ isEn ? 'No mapping rules' : '暂无映射规则' }}
            </p>
            <div
                v-for="(rule, index) in localMappings"
                :key="rule.id"
                class="kam-mapping-rule"
                :data-testid="`mapping-rule-${index}`"
            >
                <div class="kam-mapping-heading">
                    <UiSwitch
                        v-model="rule.enabled"
                        :aria-label="isEn ? 'Enable rule' : '启用规则'"
                        :data-testid="`mapping-enabled-${index}`"
                    />
                    <UiBadge tone="neutral">{{ typeLabel(rule.type) }}</UiBadge>
                    <UiButton
                        variant="ghost"
                        class="kam-mapping-title"
                        :aria-expanded="expandedId === rule.id"
                        :data-testid="`mapping-expand-${index}`"
                        @click="expandedId = expandedId === rule.id ? '' : rule.id"
                        >{{ rule.name }}:
                        <code class="kam-mono"
                            >{{ rule.sourceModel || '…' }} →
                            {{ rule.targetModels.filter(Boolean).join(', ') || '…' }}</code
                        ></UiButton
                    >
                    <UiButton
                        icon
                        size="sm"
                        variant="ghost"
                        :disabled="index === 0"
                        :aria-label="isEn ? 'Move up' : '上移'"
                        :data-testid="`mapping-up-${index}`"
                        @click="moveRule(rule.id, -1)"
                        ><ChevronUp :size="16"
                    /></UiButton>
                    <UiButton
                        icon
                        size="sm"
                        variant="ghost"
                        :disabled="index === localMappings.length - 1"
                        :aria-label="isEn ? 'Move down' : '下移'"
                        :data-testid="`mapping-down-${index}`"
                        @click="moveRule(rule.id, 1)"
                        ><ChevronDown :size="16"
                    /></UiButton>
                    <UiButton
                        icon
                        size="sm"
                        variant="danger"
                        :aria-label="isEn ? 'Delete rule' : '删除规则'"
                        :data-testid="`mapping-delete-${index}`"
                        @click="deleteRule(rule.id)"
                        ><Trash2 :size="16"
                    /></UiButton>
                </div>
                <div v-if="expandedId === rule.id" class="kam-mapping-fields">
                    <UiField :label="isEn ? 'Rule Name' : '规则名称'"
                        ><UiInput v-model="rule.name" :data-testid="`mapping-name-${index}`"
                    /></UiField>
                    <UiField :label="isEn ? 'Mapping Type' : '映射类型'"
                        ><UiSelect v-model="rule.type" :data-testid="`mapping-type-${index}`"
                            ><option value="replace">{{ isEn ? 'Replace' : '替换' }}</option>
                            <option value="alias">{{ isEn ? 'Alias' : '别名' }}</option>
                            <option value="loadbalance">
                                {{ isEn ? 'Load Balance' : '负载均衡' }}
                            </option></UiSelect
                        ></UiField
                    >
                    <UiField :label="isEn ? 'Default Reasoning Effort' : '默认推理等级'"
                        ><UiSelect
                            :model-value="rule.defaultReasoningEffort ?? ''"
                            :data-testid="`mapping-effort-${index}`"
                            @update:model-value="rule.defaultReasoningEffort = $event || undefined"
                            ><option value="">{{ isEn ? 'Upstream default' : '上游默认' }}</option>
                            <option
                                v-for="effort in ['none', 'low', 'medium', 'high', 'xhigh', 'max']"
                                :key="effort"
                                :value="effort"
                            >
                                {{ effort }}
                            </option></UiSelect
                        ><small class="kam-muted">{{
                            isEn
                                ? 'Only when the client omits reasoning; target capability still applies.'
                                : '仅在客户端未指定推理参数时使用，仍受目标模型能力约束。'
                        }}</small></UiField
                    >
                    <UiField :label="isEn ? 'Source Model' : '源模型'"
                        ><UiInput
                            v-model="rule.sourceModel"
                            :list="`mapping-models-${index}`"
                            :data-testid="`mapping-source-${index}`"
                        /><datalist :id="`mapping-models-${index}`">
                            <option
                                v-for="model in availableModels"
                                :key="model.id"
                                :value="model.id"
                            /></datalist
                        ><small class="kam-muted">{{
                            isEn
                                ? 'Arbitrary IDs and * wildcards are accepted.'
                                : '允许任意模型 ID 和 * 通配符。'
                        }}</small></UiField
                    >
                    <div>
                        <div class="kam-actions">
                            <strong>{{ isEn ? 'Target Models' : '目标模型' }}</strong
                            ><UiButton
                                variant="secondary"
                                size="sm"
                                :data-testid="`mapping-add-target-${index}`"
                                @click="addTarget(rule)"
                                ><Plus :size="14" />{{ isEn ? 'Add' : '添加' }}</UiButton
                            >
                        </div>
                        <div
                            v-for="(target, targetIndex) in rule.targetModels"
                            :key="targetIndex"
                            class="kam-mapping-target"
                        >
                            <UiInput
                                :model-value="target"
                                :list="`mapping-models-${index}`"
                                :data-testid="`mapping-target-${index}-${targetIndex}`"
                                @update:model-value="rule.targetModels[targetIndex] = $event"
                            />
                            <UiInput
                                v-if="rule.type === 'loadbalance'"
                                type="number"
                                min="1"
                                :model-value="rule.weights?.[targetIndex] ?? 1"
                                :aria-label="isEn ? 'Weight' : '权重'"
                                :data-testid="`mapping-weight-${index}-${targetIndex}`"
                                @update:model-value="updateWeight(rule, targetIndex, $event)"
                            />
                            <UiButton
                                v-if="rule.targetModels.length > 1"
                                icon
                                size="sm"
                                variant="danger"
                                :aria-label="isEn ? 'Remove target' : '删除目标'"
                                :data-testid="`mapping-remove-target-${index}-${targetIndex}`"
                                @click="removeTarget(rule, targetIndex)"
                                ><Trash2 :size="14"
                            /></UiButton>
                        </div>
                    </div>
                    <UiField
                        v-if="apiKeys.length"
                        :label="
                            isEn
                                ? 'Apply to API Keys (empty = all)'
                                : '适用 API Key（空 = 所有 Key）'
                        "
                        ><div class="kam-actions">
                            <UiCheckbox
                                v-for="key in apiKeys"
                                :key="key.id"
                                :model-value="rule.apiKeyIds?.includes(key.id) ?? false"
                                :data-testid="`mapping-key-${index}-${key.id}`"
                                @update:model-value="toggleKey(rule, key.id, $event)"
                                >{{ key.name }}</UiCheckbox
                            >
                        </div></UiField
                    >
                </div>
            </div>
        </div>
        <template #footer
            ><UiButton
                variant="ghost"
                :disabled="saving"
                data-testid="mapping-cancel"
                @click="close"
                >{{ isEn ? 'Cancel' : '取消' }}</UiButton
            ><UiButton
                variant="primary"
                :loading="saving"
                :disabled="saving"
                data-testid="mapping-save"
                @click="save"
                >{{ isEn ? 'Save' : '保存' }}</UiButton
            ></template
        >
    </UiDialog>
</template>

<style scoped>
.kam-mapping-rule {
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
}
.kam-mapping-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px;
}
.kam-mapping-title {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: left;
}
.kam-mapping-fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px;
    border-top: 1px solid var(--border);
}
.kam-mapping-target {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
}
.kam-mapping-target > :first-child {
    flex: 1;
    min-width: 0;
}
.kam-mapping-target > :nth-child(2) {
    width: 76px;
}
</style>
