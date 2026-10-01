<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { UiBadge, UiButton, UiCheckbox, UiInput } from '@lingyzh/ui'
import { Copy, Pencil, RefreshCw, Trash2 } from 'lucide-vue-next'

const props = defineProps({
    proxy: { type: Object, required: true },
    selected: Boolean,
    isEn: Boolean
})
const emit = defineEmits(['select', 'toggle', 'test', 'delete', 'save-label'])
const editing = ref(false)
const labelDraft = ref('')
const labelInput = ref(null)
const copied = ref(false)
const copyError = ref('')
let copyTimer
let alive = true
let cancelBlur = false
const displayUrl = computed(() =>
    props.proxy.password ? props.proxy.url.replace(/:([^:@/]+)@/, ':***@') : props.proxy.url
)
const tone = computed(
    () =>
        ({
            alive: 'success',
            slow: 'warning',
            dead: 'error',
            testing: 'accent',
            untested: 'neutral'
        })[props.proxy.status] || 'neutral'
)
const statusLabel = computed(
    () =>
        ({
            alive: props.isEn ? 'Alive' : '可用',
            slow: props.isEn ? 'Slow' : '较慢',
            dead: props.isEn ? 'Dead' : '失效',
            testing: props.isEn ? 'Testing' : '测试中',
            untested: props.isEn ? 'Untested' : '未测试'
        })[props.proxy.status]
)

function startEdit() {
    cancelBlur = false
    labelDraft.value = props.proxy.label || ''
    editing.value = true
    nextTick(() => labelInput.value?.focus?.())
}
function saveLabel() {
    if (!editing.value) return
    if (cancelBlur) {
        cancelBlur = false
        return
    }
    const value = labelDraft.value.trim()
    if (value !== (props.proxy.label || '')) emit('save-label', value || undefined)
    editing.value = false
}
function labelKeydown(event) {
    if (event.key === 'Enter') saveLabel()
    if (event.key === 'Escape') {
        cancelBlur = true
        labelDraft.value = props.proxy.label || ''
        editing.value = false
    }
}
async function copyUrl() {
    if (copied.value) return
    copyError.value = ''
    try {
        await navigator.clipboard.writeText(props.proxy.url)
        if (!alive) return
        copied.value = true
        clearTimeout(copyTimer)
        copyTimer = setTimeout(() => {
            if (alive) copied.value = false
        }, 1500)
    } catch (error) {
        if (alive) copyError.value = error instanceof Error ? error.message : String(error)
    }
}
function select() {
    emit('select', props.proxy.id)
}
function toggle() {
    emit('toggle', props.proxy.id)
}
function test() {
    emit('test', props.proxy.id)
}
function remove() {
    emit('delete', props.proxy.id)
}
onBeforeUnmount(() => {
    alive = false
    clearTimeout(copyTimer)
})
</script>

<template>
    <div
        class="proxy-pool-row"
        :class="{ 'is-selected': selected }"
        :data-testid="`proxy-row-${proxy.id}`"
    >
        <UiCheckbox
            :model-value="selected"
            :aria-label="isEn ? 'Select proxy' : '选择代理'"
            :data-testid="`proxy-select-${proxy.id}`"
            @update:model-value="select"
        />
        <UiButton
            variant="ghost"
            dense
            :aria-label="proxy.enabled ? (isEn ? 'Disable' : '停用') : isEn ? 'Enable' : '启用'"
            :data-testid="`proxy-toggle-${proxy.id}`"
            @click="toggle"
            >{{ proxy.enabled ? '●' : '○' }}</UiButton
        >
        <div class="proxy-pool-identity" :title="displayUrl">
            <span class="kam-mono"
                >{{ proxy.protocol }}://{{ proxy.host }}:{{ proxy.port
                }}<span v-if="proxy.username"> @{{ proxy.username }}</span></span
            >
            <template v-if="editing">
                <UiInput
                    ref="labelInput"
                    v-model="labelDraft"
                    :aria-label="isEn ? 'Proxy note' : '代理备注'"
                    :data-testid="`proxy-label-input-${proxy.id}`"
                    @blur="saveLabel"
                    @keydown="labelKeydown"
                />
            </template>
            <UiBadge
                v-else-if="proxy.label"
                dense
                :data-testid="`proxy-label-${proxy.id}`"
                @click="startEdit"
                >{{ proxy.label }}</UiBadge
            >
        </div>
        <UiBadge :tone="tone" dense :data-testid="`proxy-status-${proxy.id}`"
            >{{ statusLabel
            }}<span
                v-if="
                    proxy.latencyMs !== undefined &&
                    (proxy.status === 'alive' || proxy.status === 'slow')
                "
            >
                {{ proxy.latencyMs }}ms</span
            ></UiBadge
        >
        <span class="kam-mono">{{ proxy.usedCount }}</span>
        <span class="kam-mono">{{ proxy.failCount }}</span>
        <span class="proxy-pool-last kam-muted" :title="proxy.lastBoundEmail || ''">{{
            proxy.lastBoundEmail ||
            (proxy.lastTestedAt ? `${Math.round((Date.now() - proxy.lastTestedAt) / 60000)}m` : '-')
        }}</span>
        <div class="kam-actions proxy-pool-row-actions">
            <UiButton
                icon
                variant="ghost"
                dense
                :disabled="proxy.status === 'testing'"
                :aria-label="isEn ? 'Test' : '测试'"
                :data-testid="`proxy-test-${proxy.id}`"
                @click="test"
                ><RefreshCw :size="15"
            /></UiButton>
            <UiButton
                icon
                variant="ghost"
                dense
                :aria-label="isEn ? 'Edit note' : '编辑备注'"
                :data-testid="`proxy-edit-${proxy.id}`"
                @click="startEdit"
                ><Pencil :size="15"
            /></UiButton>
            <UiButton
                icon
                variant="ghost"
                dense
                :aria-label="copied ? (isEn ? 'Copied' : '已复制') : isEn ? 'Copy URL' : '复制 URL'"
                :data-testid="`proxy-copy-${proxy.id}`"
                @click="copyUrl"
                ><Copy :size="15"
            /></UiButton>
            <UiButton
                icon
                variant="ghost"
                dense
                :aria-label="isEn ? 'Delete' : '删除'"
                :data-testid="`proxy-delete-${proxy.id}`"
                @click="remove"
                ><Trash2 :size="15"
            /></UiButton>
        </div>
        <small v-if="copyError" class="proxy-pool-row-error">{{ copyError }}</small>
    </div>
</template>

<style scoped>
.proxy-pool-row {
    display: grid;
    grid-template-columns: 28px 50px minmax(240px, 1fr) 110px 55px 55px 135px 150px;
    align-items: center;
    gap: 8px;
    min-width: 900px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
}
.proxy-pool-row.is-selected {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}
.proxy-pool-identity {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
    overflow-wrap: anywhere;
}
.proxy-pool-identity .kam-mono {
    overflow-wrap: anywhere;
}
.proxy-pool-identity :deep(.ui-input) {
    max-width: 190px;
}
.proxy-pool-last {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.proxy-pool-row-actions {
    gap: 0;
    flex-wrap: nowrap;
}
.proxy-pool-row-error {
    grid-column: 3 / -1;
    color: var(--red);
}
</style>
