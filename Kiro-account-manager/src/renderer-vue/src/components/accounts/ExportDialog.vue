<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { UiAlert, UiBadge, UiButton, UiCheckbox, UiDialog, UiRadio, snackbar } from '@lingyzh/ui'
import { Clipboard, Download } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { useAccountsStore } from '../../stores/accounts'
import { formatAccountExport } from '../../lib/accountExport'
import { toIpcData } from '../../lib/ipcData'

const props = defineProps({
    open: { type: Boolean, required: true },
    accounts: { type: Array, required: true },
    selectedCount: { type: Number, required: true }
})
const emit = defineEmits(['update:open'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const accountsStore = useAccountsStore()
const selectedFormat = ref('json')
const includeCredentials = ref(true)
const copied = ref(false)
const busy = ref(false)
const error = ref('')
let closeTimer
let generation = 0

const formats = computed(() => [
    {
        id: 'json',
        name: 'JSON',
        description: isEn.value ? 'Full data, can be imported' : '完整数据，可用于导入'
    },
    {
        id: 'oidc',
        name: 'OIDC JSON',
        description: isEn.value
            ? 'Minimal JSON for OIDC batch import'
            : 'OIDC 精简 JSON，可粘贴到批量添加'
    },
    {
        id: 'kami',
        name: isEn.value ? 'Card Key' : '卡密',
        description: isEn.value ? 'Six fields separated by ----' : '六字段卡密格式，以 ---- 分隔'
    },
    {
        id: 'txt',
        name: 'TXT',
        description: isEn.value
            ? 'Text format'
            : includeCredentials.value
              ? '可导入格式：邮箱,Token,昵称,登录方式'
              : '纯文本格式，每行一个账号'
    },
    {
        id: 'csv',
        name: 'CSV',
        description: isEn.value
            ? 'Excel compatible'
            : includeCredentials.value
              ? '可导入格式，Excel 兼容'
              : 'Excel 兼容格式'
    },
    {
        id: 'clipboard',
        name: isEn.value ? 'Clipboard' : '剪贴板',
        description: isEn.value
            ? 'Copy to clipboard'
            : includeCredentials.value
              ? '可导入格式：邮箱,Token'
              : '复制到剪贴板'
    }
])

function cancelCloseTimer() {
    if (closeTimer !== undefined) clearTimeout(closeTimer)
    closeTimer = undefined
}

function requestClose() {
    if (busy.value) return
    cancelCloseTimer()
    generation += 1
    copied.value = false
    error.value = ''
    emit('update:open', false)
}

function handleOpenChange(value) {
    if (!value) requestClose()
}

function contentFor(format) {
    const data =
        format === 'json'
            ? accountsStore.exportAccounts(props.accounts.map((account) => account.id))
            : undefined
    return formatAccountExport(format, props.accounts, includeCredentials.value, data)
}

async function copyContent(format) {
    if (busy.value || copied.value) return
    busy.value = true
    error.value = ''
    const currentGeneration = generation
    try {
        await navigator.clipboard.writeText(contentFor(format))
        if (currentGeneration !== generation) return
        copied.value = true
        cancelCloseTimer()
        closeTimer = setTimeout(() => {
            if (currentGeneration === generation) requestClose()
        }, 1500)
    } catch (cause) {
        if (currentGeneration === generation) error.value = String(cause)
    } finally {
        if (currentGeneration === generation) busy.value = false
    }
}

async function exportSelected() {
    if (busy.value || copied.value) return
    if (selectedFormat.value === 'clipboard') {
        await copyContent('clipboard')
        return
    }
    busy.value = true
    error.value = ''
    const currentGeneration = generation
    try {
        const extension = { json: 'json', oidc: 'json', txt: 'txt', csv: 'csv', kami: 'txt' }[
            selectedFormat.value
        ]
        const filename = `kiro-accounts-${new Date().toISOString().slice(0, 10)}.${extension}`
        const success = await window.api.exportToFile(
            toIpcData(contentFor(selectedFormat.value)),
            toIpcData(filename)
        )
        if (currentGeneration !== generation) return
        if (success) {
            snackbar.show(
                isEn.value
                    ? `Exported ${props.accounts.length} accounts`
                    : `已导出 ${props.accounts.length} 个账号`,
                { tone: 'success' }
            )
            requestCloseAfterExport()
        }
    } catch (cause) {
        if (currentGeneration === generation) error.value = String(cause)
    } finally {
        if (currentGeneration === generation) busy.value = false
    }
}

function requestCloseAfterExport() {
    cancelCloseTimer()
    generation += 1
    busy.value = false
    emit('update:open', false)
}

watch(
    () => props.open,
    (open) => {
        if (!open) {
            cancelCloseTimer()
            generation += 1
            copied.value = false
            error.value = ''
        }
    }
)

onBeforeUnmount(() => {
    cancelCloseTimer()
    generation += 1
})
</script>

<template>
    <UiDialog
        :open="open"
        size="md"
        scrollable
        :aria-label="isEn ? 'Export Accounts' : '导出账号'"
        :content-label="isEn ? 'Choose export format' : '选择导出格式'"
        @update:open="handleOpenChange"
    >
        <template #header>
            <h2 class="ui-card-title">{{ isEn ? 'Export Accounts' : '导出账号' }}</h2>
            <UiBadge tone="neutral">{{
                selectedCount > 0
                    ? isEn
                        ? `${selectedCount} selected`
                        : `${selectedCount} 个选中`
                    : isEn
                      ? `All ${accounts.length}`
                      : `全部 ${accounts.length} 个`
            }}</UiBadge>
        </template>
        <div class="kam-dialog-content" data-testid="account-export-dialog">
            <div
                class="kam-export-formats"
                role="radiogroup"
                :aria-label="isEn ? 'Format' : '格式'"
            >
                <div v-for="format in formats" :key="format.id" class="kam-export-format">
                    <UiRadio
                        v-model="selectedFormat"
                        name="account-export-format"
                        :value="format.id"
                        :data-testid="`export-format-${format.id}`"
                        >{{ format.name }}</UiRadio
                    >
                    <span class="kam-muted">{{ format.description }}</span>
                </div>
            </div>
            <p v-if="selectedFormat === 'oidc'" class="kam-muted">
                {{
                    isEn
                        ? 'Minimal JSON array (email / password / refreshToken / clientId / clientSecret / provider). Paste into OIDC batch import.'
                        : '精简 JSON 数组，含邮箱、密码、RefreshToken、ClientId、ClientSecret 和 provider，可直接粘贴到 OIDC 批量添加。'
                }}
            </p>
            <p v-if="selectedFormat === 'kami'" class="kam-muted">
                {{
                    isEn
                        ? 'One account per line. Fields: email----password----refreshToken----clientId----clientSecret----provider.'
                        : '每行一个账号：邮箱----密码----RefreshToken----ClientId----ClientSecret----登录方式。'
                }}
            </p>
            <UiCheckbox
                v-if="selectedFormat === 'json'"
                v-model="includeCredentials"
                data-testid="export-include-credentials"
            >
                {{ isEn ? 'Include credentials for full import' : '包含凭证信息，可用于完整导入' }}
            </UiCheckbox>
            <UiAlert
                v-if="error"
                tone="error"
                :title="isEn ? 'Export failed' : '导出失败'"
                data-testid="account-export-error"
                >{{ error }}</UiAlert
            >
        </div>
        <template #footer>
            <UiButton variant="ghost" :disabled="busy" @click="requestClose">{{
                isEn ? 'Cancel' : '取消'
            }}</UiButton>
            <UiButton
                v-if="selectedFormat === 'oidc' || selectedFormat === 'kami'"
                variant="secondary"
                :disabled="busy || copied"
                data-testid="export-copy"
                @click="copyContent(selectedFormat)"
                ><Clipboard :size="16" />{{
                    copied ? (isEn ? 'Copied' : '已复制') : isEn ? 'Copy' : '复制到剪贴板'
                }}</UiButton
            >
            <UiButton
                variant="primary"
                :loading="busy"
                :disabled="busy || copied"
                data-testid="export-submit"
                @click="exportSelected"
            >
                <Clipboard v-if="selectedFormat === 'clipboard'" :size="16" /><Download
                    v-else
                    :size="16"
                />
                {{
                    copied
                        ? isEn
                            ? 'Copied'
                            : '已复制'
                        : selectedFormat === 'clipboard'
                          ? isEn
                              ? 'Copy'
                              : '复制到剪贴板'
                          : isEn
                            ? 'Export'
                            : '导出'
                }}
            </UiButton>
        </template>
    </UiDialog>
</template>

<style scoped>
.kam-export-formats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
}
.kam-export-format {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
}
.kam-export-format:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}
.kam-export-format .kam-muted {
    font-size: 12px;
}
@media (max-width: 520px) {
    .kam-export-formats {
        grid-template-columns: 1fr;
    }
}
</style>
