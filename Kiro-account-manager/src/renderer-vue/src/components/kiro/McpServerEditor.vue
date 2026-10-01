<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { UiButton, UiDialog, UiField, UiInput } from '@lingyzh/ui'
import { Plus, Trash2 } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { toIpcData } from '../../lib/ipcData'

const props = defineProps({
    serverName: { type: String, default: '' },
    server: { type: Object, default: null }
})
const emit = defineEmits(['close', 'saved'])
const { t } = useTranslation()
const isEn = computed(() => t('common.unknown') === 'Unknown')
const name = ref(props.serverName)
const command = ref(props.server?.command || '')
const args = ref([...(props.server?.args || [])])
const envVars = ref(Object.entries(props.server?.env || {}).map(([key, value]) => ({ key, value })))
const newArg = ref('')
const saving = ref(false)
const error = ref('')
let active = true

function close() {
    if (!saving.value) emit('close')
}

function addArg() {
    const value = newArg.value.trim()
    if (!value) return
    args.value.push(value)
    newArg.value = ''
}

function removeArg(index) {
    args.value.splice(index, 1)
}

function addEnvVar() {
    envVars.value.push({ key: '', value: '' })
}

function removeEnvVar(index) {
    envVars.value.splice(index, 1)
}

function save() {
    if (!active || saving.value) return
    if (!name.value.trim()) {
        error.value = isEn.value ? 'Please enter server name' : '请输入服务器名称'
        return
    }
    if (!command.value.trim()) {
        error.value = isEn.value ? 'Please enter command' : '请输入命令'
        return
    }
    const config = { ...(props.server || {}), command: command.value.trim() }
    const nextArgs = args.value.filter((arg) => arg.trim())
    if (nextArgs.length) config.args = nextArgs
    else delete config.args
    const nextEnv = {}
    for (const item of envVars.value) {
        if (item.key.trim()) nextEnv[item.key.trim()] = item.value
    }
    if (Object.keys(nextEnv).length) config.env = nextEnv
    else delete config.env
    saving.value = true
    error.value = ''
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.saveMcpServer(
                name.value.trim(),
                toIpcData(config),
                props.serverName || undefined
            )
        })
        .then((result) => {
            if (!active) return
            if (!result.success) {
                error.value = result.error || (isEn.value ? 'Save failed' : '保存失败')
                return
            }
            emit('saved')
            emit('close')
        })
        .catch((cause) => {
            if (active) error.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (active) saving.value = false
        })
}

onBeforeUnmount(() => {
    active = false
})
</script>

<template>
    <UiDialog
        :open="true"
        size="md"
        scrollable
        :aria-label="
            serverName
                ? isEn
                    ? 'Edit MCP Server'
                    : '编辑 MCP 服务器'
                : isEn
                  ? 'Add MCP Server'
                  : '添加 MCP 服务器'
        "
        :content-label="isEn ? 'MCP server fields' : 'MCP 服务器字段'"
        :error="error"
        @update:open="close"
    >
        <template #header
            ><h2 class="ui-card-title">
                {{
                    serverName
                        ? isEn
                            ? 'Edit MCP Server'
                            : '编辑 MCP 服务器'
                        : isEn
                          ? 'Add MCP Server'
                          : '添加 MCP 服务器'
                }}
            </h2></template
        >
        <div class="kam-dialog-content">
            <UiField
                v-slot="{ controlAttrs }"
                class="kiro-editor-field"
                :label="isEn ? 'Server Name' : '服务器名称'"
                for="kiro-mcp-name"
                ><UiInput
                    v-model="name"
                    v-bind="controlAttrs"
                    :disabled="Boolean(serverName) || saving"
                    :placeholder="isEn ? 'e.g. fetch, exa, context7' : '例如：fetch、exa、context7'"
                    data-testid="kiro-mcp-name"
            /></UiField>
            <UiField
                v-slot="{ controlAttrs }"
                class="kiro-editor-field"
                :label="isEn ? 'Command' : '命令'"
                for="kiro-mcp-command"
                ><UiInput
                    v-model="command"
                    v-bind="controlAttrs"
                    :disabled="saving"
                    :placeholder="isEn ? 'e.g. uvx, npx, node' : '例如：uvx、npx、node'"
                    data-testid="kiro-mcp-command"
            /></UiField>
            <UiField class="kiro-editor-field" :label="isEn ? 'Arguments' : '参数'"
                ><div class="kiro-editor-list">
                    <div v-for="(arg, index) in args" :key="index" class="kiro-editor-row">
                        <code class="kam-mono">{{ arg }}</code
                        ><UiButton
                            icon
                            size="sm"
                            :disabled="saving"
                            :aria-label="isEn ? 'Remove argument' : '删除参数'"
                            :data-testid="`kiro-mcp-remove-arg-${index}`"
                            @click="removeArg(index)"
                            ><Trash2 :size="15"
                        /></UiButton>
                    </div>
                    <div class="kiro-editor-row">
                        <UiInput
                            v-model="newArg"
                            :disabled="saving"
                            :aria-label="isEn ? 'New argument' : '新参数'"
                            :placeholder="isEn ? 'Add argument' : '添加参数'"
                            data-testid="kiro-mcp-new-arg"
                            @keydown.enter="addArg"
                        /><UiButton
                            icon
                            size="sm"
                            :disabled="saving || !newArg.trim()"
                            :aria-label="isEn ? 'Add argument' : '添加参数'"
                            data-testid="kiro-mcp-add-arg"
                            @click="addArg"
                            ><Plus :size="15"
                        /></UiButton>
                    </div></div
            ></UiField>
            <UiField class="kiro-editor-field" :label="isEn ? 'Environment Variables' : '环境变量'"
                ><div class="kiro-editor-list">
                    <div v-for="(item, index) in envVars" :key="index" class="kiro-editor-row">
                        <UiInput
                            v-model="item.key"
                            :disabled="saving"
                            :aria-label="isEn ? 'Variable name' : '变量名'"
                            :data-testid="`kiro-mcp-env-key-${index}`"
                        /><UiInput
                            v-model="item.value"
                            :disabled="saving"
                            :aria-label="isEn ? 'Variable value' : '变量值'"
                            :data-testid="`kiro-mcp-env-value-${index}`"
                        /><UiButton
                            icon
                            size="sm"
                            :disabled="saving"
                            :aria-label="isEn ? 'Remove environment variable' : '删除环境变量'"
                            :data-testid="`kiro-mcp-remove-env-${index}`"
                            @click="removeEnvVar(index)"
                            ><Trash2 :size="15"
                        /></UiButton>
                    </div>
                    <div class="kam-actions">
                        <UiButton
                            size="sm"
                            :disabled="saving"
                            data-testid="kiro-mcp-add-env"
                            @click="addEnvVar"
                            ><Plus :size="15" />
                            {{ isEn ? 'Add Env Var' : '添加环境变量' }}</UiButton
                        >
                    </div>
                </div></UiField
            >
        </div>
        <template #footer
            ><div class="kam-actions">
                <UiButton :disabled="saving" data-testid="kiro-mcp-cancel" @click="close">{{
                    isEn ? 'Cancel' : '取消'
                }}</UiButton
                ><UiButton
                    variant="primary"
                    :loading="saving"
                    data-testid="kiro-mcp-save"
                    @click="save"
                    >{{ isEn ? 'Save' : '保存' }}</UiButton
                >
            </div></template
        >
    </UiDialog>
</template>

<style scoped>
.kiro-editor-field {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
}
.kiro-editor-field :deep(.ui-input) {
    width: 100%;
}
.kiro-editor-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
}
.kiro-editor-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.kiro-editor-row code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
}
.kiro-editor-row :deep(.ui-input) {
    min-width: 0;
    flex: 1;
}
</style>
