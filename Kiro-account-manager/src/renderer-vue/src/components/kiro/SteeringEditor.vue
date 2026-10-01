<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { UiButton, UiDialog, UiTextarea, confirmDialog } from '@lingyzh/ui'
import { RefreshCw } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { toIpcData } from '../../lib/ipcData'

const props = defineProps({ filename: { type: String, required: true } })
const emit = defineEmits(['close', 'saved'])
const { t } = useTranslation()
const isEn = computed(() => t('common.unknown') === 'Unknown')
const content = ref('')
const loading = ref(false)
const saving = ref(false)
const confirmingClose = ref(false)
const dirty = ref(false)
const error = ref('')
let active = true
let generation = 0

function loadContent() {
    if (!active || loading.value || saving.value) return
    const request = ++generation
    loading.value = true
    error.value = ''
    Promise.resolve()
        .then(() => {
            if (!active || request !== generation) return null
            return window.api.readKiroSteeringFile(props.filename)
        })
        .then((result) => {
            if (!active || request !== generation) return
            if (!result.success || result.content === undefined) {
                error.value = result.error || (isEn.value ? 'Failed to read file' : '读取文件失败')
                return
            }
            content.value = result.content
            dirty.value = false
        })
        .catch((cause) => {
            if (active && request === generation)
                error.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (active && request === generation) loading.value = false
        })
}

function saveContent() {
    if (!active || saving.value || loading.value || !dirty.value) return
    const request = ++generation
    saving.value = true
    error.value = ''
    const value = content.value
    Promise.resolve()
        .then(() => {
            if (!active || request !== generation) return null
            return window.api.saveKiroSteeringFile(props.filename, toIpcData(value))
        })
        .then((result) => {
            if (!active || request !== generation) return
            if (!result.success) {
                error.value = result.error || (isEn.value ? 'Failed to save file' : '保存文件失败')
                return
            }
            dirty.value = false
            emit('saved')
        })
        .catch((cause) => {
            if (active && request === generation)
                error.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (active && request === generation) saving.value = false
        })
}

function requestClose() {
    if (saving.value || confirmingClose.value) return
    if (!dirty.value) {
        emit('close')
        return
    }
    confirmingClose.value = true
    confirmDialog({
        title: isEn.value ? 'Discard changes?' : '放弃更改？',
        message: isEn.value
            ? 'File modified. Close anyway? Unsaved changes will be lost.'
            : '文件已修改，确定要关闭吗？未保存的更改将丢失。',
        confirmText: isEn.value ? 'Discard' : '放弃更改',
        cancelText: isEn.value ? 'Keep editing' : '继续编辑',
        tone: 'danger'
    })
        .then((confirmed) => {
            if (active && confirmed) emit('close')
        })
        .finally(() => {
            if (active) confirmingClose.value = false
        })
}

function markDirty() {
    dirty.value = true
}

onMounted(loadContent)
onBeforeUnmount(() => {
    active = false
    generation += 1
})
</script>

<template>
    <UiDialog
        :open="true"
        size="xl"
        scrollable
        :aria-label="isEn ? 'Edit Steering File' : '编辑 Steering 文件'"
        :content-label="isEn ? 'Steering file content' : 'Steering 文件内容'"
        :error="error"
        @update:open="requestClose"
    >
        <template #header
            ><div class="steering-heading">
                <h2 class="ui-card-title">
                    {{ isEn ? 'Edit Steering File' : '编辑 Steering 文件' }}
                </h2>
                <code class="kam-mono">{{ filename }}</code
                ><span v-if="dirty" class="steering-dirty">{{ isEn ? 'Modified' : '已修改' }}</span>
            </div></template
        >
        <div class="kam-dialog-content">
            <p v-if="loading" class="kam-muted">
                <RefreshCw :size="16" aria-hidden="true" /> {{ isEn ? 'Loading...' : '加载中...' }}
            </p>
            <UiTextarea
                v-else
                v-model="content"
                :disabled="saving"
                :rows="18"
                :aria-label="isEn ? 'Steering file content' : 'Steering 文件内容'"
                :placeholder="isEn ? 'Edit steering rules here...' : '在此编辑 Steering 规则...'"
                spellcheck="false"
                data-testid="kiro-steering-content"
                @update:model-value="markDirty"
            />
            <p class="kam-muted">
                {{
                    isEn
                        ? 'Steering files use Markdown to define assistant behavior rules.'
                        : 'Steering 文件使用 Markdown 定义助手的行为规则。'
                }}
            </p>
        </div>
        <template #footer
            ><div class="kam-actions">
                <UiButton
                    :disabled="loading || saving"
                    data-testid="kiro-steering-refresh"
                    @click="loadContent"
                    ><RefreshCw :size="16" /> {{ isEn ? 'Refresh' : '刷新' }}</UiButton
                ><UiButton
                    variant="primary"
                    :loading="saving"
                    :disabled="loading || !dirty"
                    data-testid="kiro-steering-save"
                    @click="saveContent"
                    >{{ isEn ? 'Save' : '保存' }}</UiButton
                ><UiButton
                    :disabled="saving"
                    data-testid="kiro-steering-close"
                    @click="requestClose"
                    >{{ isEn ? 'Close' : '关闭' }}</UiButton
                >
            </div></template
        >
    </UiDialog>
</template>

<style scoped>
.steering-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
}
.steering-heading h2 {
    margin: 0;
}
.steering-heading code {
    color: var(--muted);
}
.steering-dirty {
    color: var(--amber);
    font-size: 12px;
}
</style>
