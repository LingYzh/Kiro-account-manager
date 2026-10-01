<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { UiAlert, UiSpinner } from '@lingyzh/ui'
import { Users } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { useAccountsStore } from '../../stores/accounts'
import { usePersistenceStore } from '../../stores/persistence'
import { AccountImportParseError, parseAccountFile } from '../../lib/accountFileImport'
import AccountToolbar from './AccountToolbar.vue'
import AccountCollection from './AccountCollection.vue'
import AddAccountDialog from './AddAccountDialog.vue'
import EditAccountDialog from './EditAccountDialog.vue'
import GroupManageDialog from './GroupManageDialog.vue'
import TagManageDialog from './TagManageDialog.vue'
import ExportDialog from './ExportDialog.vue'

const accountsStore = useAccountsStore()
const { accounts, selectedIds, activeGroupTab, groups } = storeToRefs(accountsStore)
const { isLoading } = storeToRefs(usePersistenceStore())
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')

function initialViewMode() {
    try {
        return localStorage.getItem('accounts_viewMode') === 'list' ? 'list' : 'grid'
    } catch {
        return 'grid'
    }
}

const viewMode = ref(initialViewMode())
const showAddDialog = ref(false)
const editingAccount = ref(null)
const showGroupDialog = ref(false)
const showTagDialog = ref(false)
const showExportDialog = ref(false)
const isFilterExpanded = ref(false)
const importing = ref(false)
const importError = ref('')
const importSuccess = ref('')
let mounted = true
let importGeneration = 0

const exportAccounts = computed(() => {
    const all = [...accounts.value.values()]
    return selectedIds.value.size ? all.filter((account) => selectedIds.value.has(account.id)) : all
})

watch(viewMode, (value) => {
    try {
        localStorage.setItem('accounts_viewMode', value)
    } catch {
        // View mode remains available for this session.
    }
})

onBeforeUnmount(() => {
    mounted = false
    importGeneration++
})

function text(zh, en) {
    return isEn.value ? en : zh
}

function changeViewMode(value) {
    viewMode.value = value === 'list' ? 'list' : 'grid'
}

function toggleFilter() {
    isFilterExpanded.value = !isFilterExpanded.value
}

function startEdit(account) {
    editingAccount.value = account
}

function updateEditOpen(open) {
    if (!open) editingAccount.value = null
}

function parseErrorMessage(error) {
    if (!(error instanceof AccountImportParseError)) {
        return text('解析导入文件失败', 'Failed to parse import file')
    }
    const messages = {
        'invalid-json': text('无效的 JSON 文件格式', 'Invalid JSON export format'),
        'empty-csv': text('CSV 文件为空或只有标题行', 'CSV is empty or has only a header'),
        'empty-csv-accounts': text(
            '未找到有效的账号数据（需要邮箱和 RefreshToken）',
            'No valid accounts with email and RefreshToken'
        ),
        'empty-kami-accounts': text('未找到有效的卡密数据', 'No valid credential lines found'),
        'empty-txt-accounts': text('未找到有效的账号数据', 'No valid accounts found'),
        'unsupported-format': text(
            `不支持的文件格式：${error.format}`,
            `Unsupported file format: ${error.format}`
        )
    }
    return messages[error.code]
}

async function importFile() {
    if (importing.value) return
    importing.value = true
    importError.value = ''
    importSuccess.value = ''
    const generation = ++importGeneration
    const currentGroupId =
        activeGroupTab.value !== 'all' &&
        activeGroupTab.value !== 'ungrouped' &&
        groups.value.has(activeGroupTab.value)
            ? activeGroupTab.value
            : undefined
    const groupName = currentGroupId
        ? (groups.value.get(currentGroupId)?.name ?? '未分组')
        : '未分组'
    try {
        const fileData = await window.api.importFromFile()
        if (!mounted || generation !== importGeneration || !fileData) return
        const parsed = parseAccountFile(fileData.content, fileData.format, currentGroupId)
        if (!mounted || generation !== importGeneration) return
        if (parsed.kind === 'export') {
            const result = accountsStore.importFromExportData(parsed.data)
            const skipped = result.errors.find((error) => error.id === 'skipped')
            importSuccess.value = text(
                `导入完成：成功 ${result.success} 个${skipped ? `，${skipped.error}` : ''}`,
                `Import complete: ${result.success} succeeded${skipped ? `, ${skipped.error}` : ''}`
            )
        } else {
            const result = accountsStore.importAccounts(parsed.items)
            const prefix =
                parsed.source === 'kami'
                    ? text('卡密导入完成', 'Credentials imported')
                    : text('导入完成', 'Import complete')
            importSuccess.value = text(
                `${prefix}：成功 ${result.success} 个，失败 ${result.failed} 个（分组：${groupName}）`,
                `${prefix}: ${result.success} succeeded, ${result.failed} failed (group: ${groupName})`
            )
        }
    } catch (error) {
        if (mounted && generation === importGeneration) importError.value = parseErrorMessage(error)
    } finally {
        if (mounted && generation === importGeneration) importing.value = false
    }
}
</script>

<template>
    <div class="kam-page account-manager" data-testid="page-accounts">
        <header class="kam-page-header">
            <div class="account-manager-title">
                <Users :size="20" aria-hidden="true" />
                <h1>{{ text('账户管理', 'Accounts') }}</h1>
            </div>
        </header>
        <AccountToolbar
            :view-mode="viewMode"
            :is-filter-expanded="isFilterExpanded"
            :importing="importing"
            @add="showAddDialog = true"
            @import="importFile"
            @export="showExportDialog = true"
            @manage-groups="showGroupDialog = true"
            @manage-tags="showTagDialog = true"
            @update:view-mode="changeViewMode"
            @toggle-filter="toggleFilter"
        />
        <UiAlert
            v-if="importError"
            tone="error"
            :title="text('导入失败', 'Import failed')"
            data-testid="account-import-error"
            >{{ importError }}</UiAlert
        >
        <UiAlert
            v-if="importSuccess"
            tone="success"
            :title="text('导入完成', 'Import complete')"
            data-testid="account-import-success"
            >{{ importSuccess }}</UiAlert
        >
        <div v-if="isLoading" class="account-manager-loading">
            <UiSpinner :label="text('加载账号数据...', 'Loading accounts...')" />
        </div>
        <div v-else class="account-manager-collection">
            <AccountCollection
                :view-mode="viewMode"
                @add="showAddDialog = true"
                @edit="startEdit"
            />
        </div>

        <AddAccountDialog :open="showAddDialog" @update:open="showAddDialog = $event" />
        <EditAccountDialog
            :open="Boolean(editingAccount)"
            :account="editingAccount"
            @update:open="updateEditOpen"
        />
        <GroupManageDialog :open="showGroupDialog" @update:open="showGroupDialog = $event" />
        <TagManageDialog :open="showTagDialog" @update:open="showTagDialog = $event" />
        <ExportDialog
            :open="showExportDialog"
            :accounts="exportAccounts"
            :selected-count="selectedIds.size"
            @update:open="showExportDialog = $event"
        />
    </div>
</template>

<style scoped>
.account-manager {
    min-height: 100%;
    height: 100%;
    box-sizing: border-box;
}
.account-manager-title {
    display: flex;
    align-items: center;
    gap: 10px;
}
.account-manager-loading {
    display: flex;
    justify-content: center;
    padding: 48px 0;
}
.account-manager-collection {
    display: flex;
    min-height: 240px;
    flex: 1;
}
</style>
