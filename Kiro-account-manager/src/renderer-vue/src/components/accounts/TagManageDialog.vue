<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { UiBadge, UiButton, UiCard, UiDialog, UiField, UiInput, confirmDialog } from '@lingyzh/ui'
import { Edit2, Plus, Tag, Trash2 } from 'lucide-vue-next'
import { toRgba } from '@shared/lib/accountHelpers'
import { TAG_PRESET_COLORS, parseArgb, toArgb } from '../../lib/accountColors'
import { useAccountsStore } from '../../stores/accounts'
import { useTranslation } from '../../composables/useTranslation'

const props = defineProps({ open: { type: Boolean, required: true } })
const emit = defineEmits(['update:open'])
const accountsStore = useAccountsStore()
const { accounts, tags } = storeToRefs(accountsStore)
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const tagList = computed(() => [...tags.value.values()])
const untaggedCount = computed(
    () => [...accounts.value.values()].filter((account) => !account.tags.length).length
)

const editingId = ref(null)
const editName = ref('')
const editColor = ref('#3b82f6')
const editAlpha = ref(255)
const isCreating = ref(false)
const newName = ref('')
const newColor = ref('#3b82f6')
const newAlpha = ref(255)
const assigningTagId = ref(null)
const confirmingDelete = ref(false)

function text(zh, en) {
    return isEn.value ? en : zh
}

function taggedAccounts(tagId) {
    return [...accounts.value.values()].filter((account) => account.tags.includes(tagId))
}

function untaggedByTag(tagId) {
    return [...accounts.value.values()].filter((account) => !account.tags.includes(tagId))
}

function createTag() {
    if (!newName.value.trim()) return
    accountsStore.addTag({
        name: newName.value.trim(),
        color: toArgb(newColor.value, newAlpha.value)
    })
    newName.value = ''
    newColor.value = '#3b82f6'
    newAlpha.value = 255
    isCreating.value = false
}

function startEdit(tag) {
    editingId.value = tag.id
    editName.value = tag.name
    const color = parseArgb(tag.color)
    editColor.value = color.rgb
    editAlpha.value = color.alpha
}

function saveEdit() {
    if (!editingId.value || !editName.value.trim()) return
    accountsStore.updateTag(editingId.value, {
        name: editName.value.trim(),
        color: toArgb(editColor.value, editAlpha.value)
    })
    editingId.value = null
}

function selectPreset(preset, editing) {
    const color = parseArgb(preset.value)
    if (editing) {
        editColor.value = color.rgb
        editAlpha.value = color.alpha
    } else {
        newColor.value = color.rgb
        newAlpha.value = color.alpha
    }
}

async function deleteTag(tag) {
    if (confirmingDelete.value) return
    confirmingDelete.value = true
    try {
        const count = taggedAccounts(tag.id).length
        const message =
            count > 0
                ? text(
                      `确定要删除标签「${tag.name}」吗？\n该标签已应用于 ${count} 个账号，删除后将从这些账号移除。`,
                      `Delete tag “${tag.name}”?\nIt will be removed from ${count} accounts.`
                  )
                : text(`确定要删除标签「${tag.name}」吗？`, `Delete tag “${tag.name}”?`)
        const confirmed = await confirmDialog({
            title: text('删除标签', 'Delete tag'),
            message,
            confirmText: text('删除', 'Delete'),
            tone: 'danger'
        })
        if (confirmed && props.open) accountsStore.removeTag(tag.id)
    } finally {
        confirmingDelete.value = false
    }
}

function addAccountTag(tagId, accountId) {
    accountsStore.addTagToAccounts([accountId], tagId)
}

function removeAccountTag(tagId, accountId) {
    accountsStore.removeTagFromAccounts([accountId], tagId)
}
</script>

<template>
    <UiDialog
        :open="open"
        size="lg"
        scrollable
        :content-label="text('标签管理内容', 'Tag management content')"
        @update:open="emit('update:open', $event)"
    >
        <template #header
            ><h2 class="tag-dialog-title">
                <Tag :size="18" aria-hidden="true" />{{ text('标签管理', 'Tag Management') }}
            </h2></template
        >
        <div class="kam-dialog-content" data-testid="tag-dialog">
            <p class="kam-muted">
                {{ text(`共 ${tagList.length} 个标签`, `${tagList.length} tags`) }} ·
                {{ text(`${untaggedCount} 个未标记账号`, `${untaggedCount} untagged`) }}
            </p>
            <UiCard v-if="isCreating" density="compact">
                <div class="kam-dialog-content">
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="text('标签名称', 'Tag name')"
                        for="tag-new-name"
                    >
                        <UiInput
                            id="tag-new-name"
                            v-model="newName"
                            v-bind="controlAttrs"
                            data-testid="tag-new-name"
                        />
                    </UiField>
                    <UiField :label="text('颜色', 'Color')" for="tag-new-color">
                        <input
                            id="tag-new-color"
                            v-model="newColor"
                            type="color"
                            class="account-color-input"
                            data-testid="tag-new-color"
                        />
                    </UiField>
                    <UiField :label="text('透明度 (0–255)', 'Opacity (0–255)')" for="tag-new-alpha">
                        <div class="tag-opacity">
                            <input
                                id="tag-new-alpha"
                                v-model.number="newAlpha"
                                type="range"
                                min="0"
                                max="255"
                                data-testid="tag-new-alpha"
                            /><output for="tag-new-alpha"
                                >{{ newAlpha }} / 255 ·
                                {{ Math.round((newAlpha / 255) * 100) }}%</output
                            >
                        </div>
                    </UiField>
                    <div class="tag-presets">
                        <UiButton
                            v-for="preset in TAG_PRESET_COLORS"
                            :key="preset.value"
                            variant="ghost"
                            size="sm"
                            class="tag-preset"
                            :aria-label="preset.name"
                            :title="preset.name"
                            :data-testid="`tag-preset-${preset.value.slice(1)}`"
                            @click="selectPreset(preset, false)"
                        >
                            <span
                                class="tag-preset-swatch"
                                :style="{ backgroundColor: toRgba(preset.value) }"
                            />
                        </UiButton>
                    </div>
                    <div class="kam-actions tag-actions">
                        <UiButton
                            variant="ghost"
                            data-testid="tag-cancel-create"
                            @click="isCreating = false"
                            >{{ text('取消', 'Cancel') }}</UiButton
                        >
                        <UiButton
                            :disabled="!newName.trim()"
                            data-testid="tag-create"
                            @click="createTag"
                            >{{ text('创建', 'Create') }}</UiButton
                        >
                    </div>
                </div>
            </UiCard>
            <UiButton v-else variant="secondary" data-testid="tag-new" @click="isCreating = true"
                ><Plus :size="16" aria-hidden="true" />{{ text('新建标签', 'New Tag') }}</UiButton
            >

            <div class="tag-list">
                <UiCard
                    v-for="tag in tagList"
                    :key="tag.id"
                    density="compact"
                    :data-testid="`tag-row-${tag.id}`"
                >
                    <div v-if="editingId === tag.id" class="kam-dialog-content">
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="text('标签名称', 'Tag name')"
                            :for="`tag-name-${tag.id}`"
                        >
                            <UiInput
                                :id="`tag-name-${tag.id}`"
                                v-model="editName"
                                v-bind="controlAttrs"
                                data-testid="tag-edit-name"
                            />
                        </UiField>
                        <UiField :label="text('颜色', 'Color')" :for="`tag-color-${tag.id}`">
                            <input
                                :id="`tag-color-${tag.id}`"
                                v-model="editColor"
                                type="color"
                                class="account-color-input"
                                data-testid="tag-edit-color"
                            />
                        </UiField>
                        <UiField
                            :label="text('透明度 (0–255)', 'Opacity (0–255)')"
                            :for="`tag-alpha-${tag.id}`"
                        >
                            <div class="tag-opacity">
                                <input
                                    :id="`tag-alpha-${tag.id}`"
                                    v-model.number="editAlpha"
                                    type="range"
                                    min="0"
                                    max="255"
                                    data-testid="tag-edit-alpha"
                                /><output :for="`tag-alpha-${tag.id}`"
                                    >{{ editAlpha }} / 255 ·
                                    {{ Math.round((editAlpha / 255) * 100) }}%</output
                                >
                            </div>
                        </UiField>
                        <div class="tag-presets">
                            <UiButton
                                v-for="preset in TAG_PRESET_COLORS"
                                :key="preset.value"
                                variant="ghost"
                                size="sm"
                                class="tag-preset"
                                :aria-label="preset.name"
                                :title="preset.name"
                                :data-testid="`tag-edit-preset-${preset.value.slice(1)}`"
                                @click="selectPreset(preset, true)"
                            >
                                <span
                                    class="tag-preset-swatch"
                                    :style="{ backgroundColor: toRgba(preset.value) }"
                                />
                            </UiButton>
                        </div>
                        <div class="kam-actions tag-actions">
                            <UiButton
                                variant="ghost"
                                data-testid="tag-cancel-edit"
                                @click="editingId = null"
                                >{{ text('取消', 'Cancel') }}</UiButton
                            >
                            <UiButton
                                :disabled="!editName.trim()"
                                data-testid="tag-save"
                                @click="saveEdit"
                                >{{ text('保存', 'Save') }}</UiButton
                            >
                        </div>
                    </div>
                    <div v-else-if="assigningTagId === tag.id" class="kam-dialog-content">
                        <div class="tag-heading">
                            <UiBadge :color="toRgba(tag.color)">{{ tag.name }}</UiBadge
                            ><span class="kam-muted">{{
                                text('选择要添加标签的账号', 'Choose accounts to tag')
                            }}</span>
                        </div>
                        <div v-if="taggedAccounts(tag.id).length">
                            <p class="kam-muted">
                                {{ text('已标记的账号：', 'Tagged accounts:') }}
                            </p>
                            <div class="kam-actions">
                                <UiBadge
                                    v-for="account in taggedAccounts(tag.id)"
                                    :key="account.id"
                                    :color="toRgba(tag.color)"
                                    closable
                                    :close-label="text('移除标签', 'Remove tag')"
                                    :data-testid="`tag-remove-account-${account.id}`"
                                    @close="removeAccountTag(tag.id, account.id)"
                                    >{{ account.email }}</UiBadge
                                >
                            </div>
                        </div>
                        <div v-if="untaggedByTag(tag.id).length">
                            <p class="kam-muted">
                                {{ text('点击添加标签：', 'Click to add tag:') }}
                            </p>
                            <div class="kam-actions tag-account-list">
                                <UiButton
                                    v-for="account in untaggedByTag(tag.id)"
                                    :key="account.id"
                                    variant="ghost"
                                    size="sm"
                                    :data-testid="`tag-add-account-${account.id}`"
                                    @click="addAccountTag(tag.id, account.id)"
                                    >{{ account.email }}</UiButton
                                >
                            </div>
                        </div>
                        <div class="kam-actions tag-actions">
                            <UiButton
                                variant="secondary"
                                data-testid="tag-finish-assign"
                                @click="assigningTagId = null"
                                >{{ text('完成', 'Done') }}</UiButton
                            >
                        </div>
                    </div>
                    <div v-else class="tag-row">
                        <UiBadge :color="toRgba(tag.color)">{{ tag.name }}</UiBadge>
                        <span class="kam-muted">{{
                            text(
                                `${taggedAccounts(tag.id).length} 个账号`,
                                `${taggedAccounts(tag.id).length} accounts`
                            )
                        }}</span>
                        <span class="tag-spacer" />
                        <UiButton
                            variant="ghost"
                            size="sm"
                            :aria-label="text('管理账号', 'Manage accounts')"
                            :data-testid="`tag-assign-${tag.id}`"
                            @click="assigningTagId = tag.id"
                            ><Tag :size="16" aria-hidden="true"
                        /></UiButton>
                        <UiButton
                            variant="ghost"
                            size="sm"
                            :aria-label="text('编辑', 'Edit')"
                            :data-testid="`tag-edit-${tag.id}`"
                            @click="startEdit(tag)"
                            ><Edit2 :size="16" aria-hidden="true"
                        /></UiButton>
                        <UiButton
                            variant="ghost"
                            size="sm"
                            :aria-label="text('删除', 'Delete')"
                            :disabled="confirmingDelete"
                            :data-testid="`tag-delete-${tag.id}`"
                            @click="deleteTag(tag)"
                            ><Trash2 :size="16" aria-hidden="true"
                        /></UiButton>
                    </div>
                </UiCard>
                <p v-if="!tagList.length && !isCreating" class="kam-muted">
                    {{
                        text(
                            '暂无标签，点击上方按钮创建第一个标签',
                            'No tags. Create your first tag above.'
                        )
                    }}
                </p>
            </div>
        </div>
        <template #footer
            ><UiButton
                variant="secondary"
                data-testid="tag-close"
                @click="emit('update:open', false)"
                >{{ text('关闭', 'Close') }}</UiButton
            ></template
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
.tag-dialog-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 16px;
}
.tag-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.tag-row,
.tag-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}
.tag-spacer {
    flex: 1;
}
.tag-actions {
    justify-content: flex-end;
}
.tag-account-list {
    max-height: 128px;
    overflow: auto;
}
.tag-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.tag-preset {
    width: 32px;
    min-width: 32px;
    padding: 3px !important;
}
.tag-preset-swatch {
    display: block;
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 4px;
}
.tag-opacity {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
}
.tag-opacity input {
    flex: 1;
    min-width: 0;
}
.tag-opacity output {
    min-width: 100px;
    font-variant-numeric: tabular-nums;
    text-align: right;
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
