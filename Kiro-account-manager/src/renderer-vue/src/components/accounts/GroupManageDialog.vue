<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { UiBadge, UiButton, UiCard, UiDialog, UiField, UiInput, confirmDialog } from '@lingyzh/ui'
import { Edit2, FolderOpen, Plus, Trash2, Users, X } from 'lucide-vue-next'
import { useAccountsStore } from '../../stores/accounts'
import { useTranslation } from '../../composables/useTranslation'

const props = defineProps({ open: { type: Boolean, required: true } })
const emit = defineEmits(['update:open'])
const accountsStore = useAccountsStore()
const { accounts, groups } = storeToRefs(accountsStore)
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const groupList = computed(() => [...groups.value.values()].sort((a, b) => a.order - b.order))
const ungroupedCount = computed(
    () => [...accounts.value.values()].filter((account) => !account.groupId).length
)

const editingId = ref(null)
const editName = ref('')
const editDescription = ref('')
const editColor = ref('#3b82f6')
const isCreating = ref(false)
const newName = ref('')
const newDescription = ref('')
const newColor = ref('#3b82f6')
const assigningGroupId = ref(null)
const confirmingDelete = ref(false)

function text(zh, en) {
    return isEn.value ? en : zh
}

function closeDialog() {
    emit('update:open', false)
}

function groupAccounts(groupId) {
    return [...accounts.value.values()].filter((account) => account.groupId === groupId)
}

function assignableAccounts(groupId) {
    return [...accounts.value.values()].filter((account) => account.groupId !== groupId)
}

function createGroup() {
    if (!newName.value.trim()) return
    accountsStore.addGroup({
        name: newName.value.trim(),
        description: newDescription.value.trim() || undefined,
        color: newColor.value
    })
    newName.value = ''
    newDescription.value = ''
    newColor.value = '#3b82f6'
    isCreating.value = false
}

function startEdit(group) {
    editingId.value = group.id
    editName.value = group.name
    editDescription.value = group.description || ''
    editColor.value = group.color || '#3b82f6'
}

function saveEdit() {
    if (!editingId.value || !editName.value.trim()) return
    accountsStore.updateGroup(editingId.value, {
        name: editName.value.trim(),
        description: editDescription.value.trim() || undefined,
        color: editColor.value
    })
    editingId.value = null
}

async function deleteGroup(group) {
    if (confirmingDelete.value) return
    confirmingDelete.value = true
    try {
        const count = groupAccounts(group.id).length
        const message =
            count > 0
                ? text(
                      `确定要删除分组「${group.name}」吗？\n该分组包含 ${count} 个账号，删除后这些账号将变为未分组状态。`,
                      `Delete group “${group.name}”?\nIts ${count} accounts will become ungrouped.`
                  )
                : text(`确定要删除分组「${group.name}」吗？`, `Delete group “${group.name}”?`)
        const confirmed = await confirmDialog({
            title: text('删除分组', 'Delete group'),
            message,
            confirmText: text('删除', 'Delete'),
            tone: 'danger'
        })
        if (confirmed && props.open) accountsStore.removeGroup(group.id)
    } finally {
        confirmingDelete.value = false
    }
}

function assignAccount(groupId, accountId) {
    accountsStore.moveAccountsToGroup([accountId], groupId)
}
</script>

<template>
    <UiDialog
        :open="open"
        size="lg"
        scrollable
        :content-label="text('分组管理内容', 'Group management content')"
        @update:open="emit('update:open', $event)"
    >
        <template #header>
            <h2 class="group-dialog-title">
                <FolderOpen :size="18" aria-hidden="true" />{{
                    text('分组管理', 'Group Management')
                }}
            </h2>
        </template>
        <div class="kam-dialog-content" data-testid="group-dialog">
            <p class="kam-muted">
                {{ text(`共 ${groupList.length} 个分组`, `${groupList.length} groups`) }} ·
                {{ text(`${ungroupedCount} 个未分组账号`, `${ungroupedCount} ungrouped`) }}
            </p>

            <UiCard v-if="isCreating" density="compact">
                <div class="kam-dialog-content">
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="text('分组名称', 'Group name')"
                        for="group-new-name"
                    >
                        <UiInput
                            id="group-new-name"
                            v-model="newName"
                            v-bind="controlAttrs"
                            data-testid="group-new-name"
                        />
                    </UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="text('描述（可选）', 'Description (optional)')"
                        for="group-new-description"
                    >
                        <UiInput
                            id="group-new-description"
                            v-model="newDescription"
                            v-bind="controlAttrs"
                            data-testid="group-new-description"
                        />
                    </UiField>
                    <UiField :label="text('颜色', 'Color')" for="group-new-color">
                        <input
                            id="group-new-color"
                            v-model="newColor"
                            type="color"
                            class="account-color-input"
                            data-testid="group-new-color"
                        />
                    </UiField>
                    <div class="kam-actions group-actions">
                        <UiButton
                            variant="ghost"
                            data-testid="group-cancel-create"
                            @click="isCreating = false"
                            >{{ text('取消', 'Cancel') }}</UiButton
                        >
                        <UiButton
                            :disabled="!newName.trim()"
                            data-testid="group-create"
                            @click="createGroup"
                            >{{ text('创建', 'Create') }}</UiButton
                        >
                    </div>
                </div>
            </UiCard>
            <UiButton v-else variant="secondary" data-testid="group-new" @click="isCreating = true">
                <Plus :size="16" aria-hidden="true" />{{ text('新建分组', 'New Group') }}
            </UiButton>

            <div class="group-list">
                <UiCard
                    v-for="group in groupList"
                    :key="group.id"
                    density="compact"
                    :data-testid="`group-row-${group.id}`"
                >
                    <div v-if="editingId === group.id" class="kam-dialog-content">
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="text('分组名称', 'Group name')"
                            :for="`group-name-${group.id}`"
                        >
                            <UiInput
                                :id="`group-name-${group.id}`"
                                v-model="editName"
                                v-bind="controlAttrs"
                                data-testid="group-edit-name"
                            />
                        </UiField>
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="text('描述（可选）', 'Description (optional)')"
                            :for="`group-description-${group.id}`"
                        >
                            <UiInput
                                :id="`group-description-${group.id}`"
                                v-model="editDescription"
                                v-bind="controlAttrs"
                                data-testid="group-edit-description"
                            />
                        </UiField>
                        <UiField :label="text('颜色', 'Color')" :for="`group-color-${group.id}`">
                            <input
                                :id="`group-color-${group.id}`"
                                v-model="editColor"
                                type="color"
                                class="account-color-input"
                                data-testid="group-edit-color"
                            />
                        </UiField>
                        <div class="kam-actions group-actions">
                            <UiButton
                                variant="ghost"
                                data-testid="group-cancel-edit"
                                @click="editingId = null"
                                >{{ text('取消', 'Cancel') }}</UiButton
                            >
                            <UiButton
                                :disabled="!editName.trim()"
                                data-testid="group-save"
                                @click="saveEdit"
                                >{{ text('保存', 'Save') }}</UiButton
                            >
                        </div>
                    </div>
                    <div v-else-if="assigningGroupId === group.id" class="kam-dialog-content">
                        <div class="group-heading">
                            <span
                                class="group-color"
                                :style="{ backgroundColor: group.color || '#3b82f6' }"
                            />{{ group.name }}
                        </div>
                        <div v-if="groupAccounts(group.id).length">
                            <p class="kam-muted">
                                {{ text('当前分组内的账号：', 'Accounts in this group:') }}
                            </p>
                            <div class="kam-actions">
                                <UiButton
                                    v-for="account in groupAccounts(group.id)"
                                    :key="account.id"
                                    variant="ghost"
                                    size="sm"
                                    :data-testid="`group-remove-account-${account.id}`"
                                    @click="assignAccount(undefined, account.id)"
                                >
                                    {{ account.email }}<X :size="13" aria-hidden="true" />
                                </UiButton>
                            </div>
                        </div>
                        <div v-if="assignableAccounts(group.id).length">
                            <p class="kam-muted">
                                {{ text('点击添加到此分组：', 'Click to add to this group:') }}
                            </p>
                            <div class="kam-actions group-account-list">
                                <UiButton
                                    v-for="account in assignableAccounts(group.id)"
                                    :key="account.id"
                                    variant="ghost"
                                    size="sm"
                                    :data-testid="`group-add-account-${account.id}`"
                                    @click="assignAccount(group.id, account.id)"
                                    >{{ account.email }}</UiButton
                                >
                            </div>
                        </div>
                        <div class="kam-actions group-actions">
                            <UiButton
                                variant="secondary"
                                data-testid="group-finish-assign"
                                @click="assigningGroupId = null"
                                >{{ text('完成', 'Done') }}</UiButton
                            >
                        </div>
                    </div>
                    <div v-else class="group-row">
                        <span
                            class="group-color"
                            :style="{ backgroundColor: group.color || '#3b82f6' }"
                        />
                        <div class="group-main">
                            <strong>{{ group.name }}</strong>
                            <p v-if="group.description" class="kam-muted">
                                {{ group.description }}
                            </p>
                        </div>
                        <UiBadge dense>{{ groupAccounts(group.id).length }}</UiBadge>
                        <UiButton
                            variant="ghost"
                            size="sm"
                            :aria-label="text('管理账号', 'Manage accounts')"
                            :data-testid="`group-assign-${group.id}`"
                            @click="assigningGroupId = group.id"
                            ><Users :size="16" aria-hidden="true"
                        /></UiButton>
                        <UiButton
                            variant="ghost"
                            size="sm"
                            :aria-label="text('编辑', 'Edit')"
                            :data-testid="`group-edit-${group.id}`"
                            @click="startEdit(group)"
                            ><Edit2 :size="16" aria-hidden="true"
                        /></UiButton>
                        <UiButton
                            variant="ghost"
                            size="sm"
                            :aria-label="text('删除', 'Delete')"
                            :disabled="confirmingDelete"
                            :data-testid="`group-delete-${group.id}`"
                            @click="deleteGroup(group)"
                            ><Trash2 :size="16" aria-hidden="true"
                        /></UiButton>
                    </div>
                </UiCard>
                <p v-if="!groupList.length && !isCreating" class="kam-muted">
                    {{
                        text(
                            '暂无分组，点击上方按钮创建第一个分组',
                            'No groups. Create your first group above.'
                        )
                    }}
                </p>
            </div>
        </div>
        <template #footer
            ><UiButton variant="secondary" data-testid="group-close" @click="closeDialog">{{
                text('关闭', 'Close')
            }}</UiButton></template
        >
    </UiDialog>
</template>

<style scoped>
.kam-dialog-content :deep(.ui-field) {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 0;
    border: 0;
}
.kam-dialog-content :deep(.ui-input) {
    width: 100%;
}
.group-dialog-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 16px;
}
.group-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.group-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
}
.group-main {
    flex: 1;
    min-width: 120px;
}
.group-main p {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.group-color {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    flex: none;
    border: 1px solid var(--border);
}
.group-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
}
.group-actions {
    justify-content: flex-end;
}
.group-account-list {
    max-height: 128px;
    overflow: auto;
}
.account-color-input {
    display: block;
    width: 44px;
    height: 36px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
}
</style>
