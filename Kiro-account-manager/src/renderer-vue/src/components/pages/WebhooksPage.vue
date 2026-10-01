<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import {
    UiBadge,
    UiButton,
    UiCard,
    UiCheckbox,
    UiDialog,
    UiField,
    UiInput,
    UiSelect,
    UiTextarea,
    confirmDialog
} from '@lingyzh/ui'
import {
    Bell,
    CheckCircle2,
    Edit2,
    Plus,
    Power,
    PowerOff,
    Send,
    Trash2,
    XCircle
} from 'lucide-vue-next'
import { ALL_WEBHOOK_EVENTS, useWebhookStore } from '../../stores/webhooks'
import { useTranslation } from '../../composables/useTranslation'

const kindOptions = [
    {
        value: 'dingtalk',
        label: '钉钉',
        labelEn: 'DingTalk',
        placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=xxx'
    },
    {
        value: 'wechat-work',
        label: '企业微信',
        labelEn: 'WeCom',
        placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx'
    },
    {
        value: 'feishu',
        label: '飞书',
        labelEn: 'Feishu',
        placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx'
    },
    {
        value: 'telegram',
        label: 'Telegram',
        labelEn: 'Telegram',
        placeholder: 'https://api.telegram.org/bot<token>'
    },
    {
        value: 'discord',
        label: 'Discord',
        labelEn: 'Discord',
        placeholder: 'https://discord.com/api/webhooks/xxx'
    },
    {
        value: 'custom',
        label: '自定义',
        labelEn: 'Custom',
        placeholder: 'https://your-server.com/webhook'
    }
]
const defaultEvents = ['batch-completed', 'risk-warning', 'account-banned']
const store = useWebhookStore()
const { t } = useTranslation()
const isEn = computed(() => t('common.unknown') === 'Unknown')
const webhookList = computed(() => Array.from(store.webhooks.values()))
const editing = ref(null)
const testingId = ref(null)
const deletingId = ref(null)
const testResults = reactive({})
const resultTimers = new Map()
let active = true

const urlPlaceholder = computed(
    () => kindOptions.find((option) => option.value === editing.value?.kind)?.placeholder || ''
)
const editorTitle = computed(() =>
    editing.value?.id
        ? isEn.value
            ? 'Edit Webhook'
            : '编辑 Webhook'
        : isEn.value
          ? 'New Webhook'
          : '新建 Webhook'
)

function kindLabel(kind) {
    const option = kindOptions.find((item) => item.value === kind)
    return option ? (isEn.value ? option.labelEn : option.label) : kind
}

function eventLabel(event) {
    const option = ALL_WEBHOOK_EVENTS.find((item) => item.value === event)
    return option ? (isEn.value ? option.labelEn : option.label) : event
}

function startAdd() {
    editing.value = {
        kind: 'dingtalk',
        url: '',
        label: '',
        enabled: true,
        events: [...defaultEvents]
    }
}

function startEdit(webhook) {
    if (testingId.value === webhook.id || deletingId.value === webhook.id) return
    editing.value = { ...webhook, events: [...(webhook.events || [])] }
}

function closeEditor() {
    editing.value = null
}

function toggleEvent(event, checked) {
    if (!editing.value) return
    const current = editing.value.events || []
    editing.value.events = checked ? [...current, event] : current.filter((item) => item !== event)
}

function saveWebhook() {
    const draft = editing.value
    if (!draft?.kind || !draft.url) return
    const data = {
        kind: draft.kind,
        url: draft.url,
        label: draft.label,
        enabled: draft.enabled ?? true,
        telegramChatId: draft.telegramChatId,
        customTemplate: draft.customTemplate,
        events: draft.events ?? [...defaultEvents]
    }
    if (draft.id) store.updateWebhook(draft.id, data)
    else store.addWebhook(data)
    closeEditor()
}

function toggleWebhook(id) {
    if (testingId.value === id || deletingId.value === id) return
    store.toggleWebhook(id)
}

function testWebhook(id) {
    if (testingId.value || deletingId.value === id || !store.webhooks.has(id)) return
    testingId.value = id
    delete testResults[id]
    clearTimeout(resultTimers.get(id))
    resultTimers.delete(id)
    Promise.resolve()
        .then(() => store.testWebhook(id))
        .then((result) => {
            if (!active || !store.webhooks.has(id)) return
            testResults[id] = { ...result, time: Date.now() }
            resultTimers.set(
                id,
                setTimeout(() => {
                    if (active) delete testResults[id]
                    resultTimers.delete(id)
                }, 60000)
            )
        })
        .catch((error) => {
            if (!active || !store.webhooks.has(id)) return
            testResults[id] = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                time: Date.now()
            }
            resultTimers.set(
                id,
                setTimeout(() => {
                    if (active) delete testResults[id]
                    resultTimers.delete(id)
                }, 60000)
            )
        })
        .finally(() => {
            if (active) testingId.value = null
        })
}

function deleteWebhook(webhook) {
    if (testingId.value === webhook.id || deletingId.value || !store.webhooks.has(webhook.id))
        return
    deletingId.value = webhook.id
    const name = webhook.label || kindLabel(webhook.kind)
    confirmDialog({
        title: isEn.value ? 'Delete Webhook' : '删除 Webhook',
        message: isEn.value ? `Delete webhook "${name}"?` : `删除 Webhook "${name}"？`,
        confirmText: isEn.value ? 'Delete' : '删除',
        cancelText: isEn.value ? 'Cancel' : '取消',
        tone: 'danger'
    })
        .then((confirmed) => {
            if (!active || !confirmed || !store.webhooks.has(webhook.id)) return
            store.removeWebhook(webhook.id)
            clearTimeout(resultTimers.get(webhook.id))
            resultTimers.delete(webhook.id)
            delete testResults[webhook.id]
            if (editing.value?.id === webhook.id) closeEditor()
        })
        .finally(() => {
            if (active) deletingId.value = null
        })
}

onBeforeUnmount(() => {
    active = false
    for (const timer of resultTimers.values()) clearTimeout(timer)
    resultTimers.clear()
})
</script>

<template>
    <section class="kam-page" data-testid="page-webhooks">
        <header class="kam-page-header">
            <div>
                <h1>
                    <Bell :size="24" aria-hidden="true" />
                    {{ isEn ? 'Webhook Notifications' : 'Webhook 通知' }}
                </h1>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Push critical events to DingTalk, WeCom, Feishu, Telegram, Discord, or a custom endpoint.'
                            : '把关键事件推送到钉钉、企微、飞书、Telegram、Discord 或自定义服务。'
                    }}
                </p>
            </div>
            <div class="kam-actions">
                <UiButton variant="primary" data-testid="webhook-add" @click="startAdd"
                    ><Plus :size="16" /> {{ isEn ? 'Add Webhook' : '添加 Webhook' }}</UiButton
                >
            </div>
        </header>

        <UiCard density="compact">
            <template #header>
                <h2 class="kam-list-title">
                    {{ isEn ? 'Webhooks' : 'Webhook 列表' }}
                    <UiBadge dense>{{ webhookList.length }}</UiBadge>
                </h2>
            </template>
            <div v-if="webhookList.length === 0" class="kam-empty">
                <Bell :size="32" aria-hidden="true" />
                <p>{{ isEn ? 'No webhooks configured.' : '尚未配置 Webhook' }}</p>
            </div>
            <div v-else class="kam-webhook-list">
                <article
                    v-for="webhook in webhookList"
                    :key="webhook.id"
                    class="kam-webhook"
                    :class="{ 'is-disabled': !webhook.enabled }"
                    :data-testid="`webhook-row-${webhook.id}`"
                >
                    <div class="kam-webhook-main">
                        <div class="kam-webhook-heading">
                            <strong>{{ webhook.label || kindLabel(webhook.kind) }}</strong>
                            <UiBadge dense variant="outline">{{ kindLabel(webhook.kind) }}</UiBadge>
                            <UiBadge
                                v-if="testResults[webhook.id]"
                                dense
                                variant="outline"
                                :tone="testResults[webhook.id].success ? 'success' : 'error'"
                            >
                                <CheckCircle2
                                    v-if="testResults[webhook.id].success"
                                    :size="12"
                                    aria-hidden="true"
                                />
                                <XCircle v-else :size="12" aria-hidden="true" />
                                {{
                                    testResults[webhook.id].success
                                        ? isEn
                                            ? 'Test OK'
                                            : '测试成功'
                                        : isEn
                                          ? 'Test failed'
                                          : '测试失败'
                                }}
                            </UiBadge>
                        </div>
                        <p class="kam-muted kam-mono kam-url" :title="webhook.url">
                            {{ webhook.url }}
                        </p>
                        <div v-if="webhook.events?.length" class="kam-events">
                            <UiBadge
                                v-for="event in webhook.events"
                                :key="event"
                                dense
                                tone="accent"
                                >{{ eventLabel(event) }}</UiBadge
                            >
                        </div>
                        <p v-if="testResults[webhook.id]?.error" class="kam-error" role="status">
                            {{ testResults[webhook.id].error }}
                        </p>
                    </div>
                    <div class="kam-actions kam-row-actions">
                        <UiButton
                            icon
                            size="sm"
                            :aria-label="
                                webhook.enabled
                                    ? isEn
                                        ? 'Disable'
                                        : '停用'
                                    : isEn
                                      ? 'Enable'
                                      : '启用'
                            "
                            :title="
                                webhook.enabled
                                    ? isEn
                                        ? 'Disable'
                                        : '停用'
                                    : isEn
                                      ? 'Enable'
                                      : '启用'
                            "
                            :disabled="testingId === webhook.id || deletingId === webhook.id"
                            :data-testid="`webhook-toggle-${webhook.id}`"
                            @click="toggleWebhook(webhook.id)"
                        >
                            <Power v-if="webhook.enabled" :size="16" aria-hidden="true" /><PowerOff
                                v-else
                                :size="16"
                                aria-hidden="true"
                            />
                        </UiButton>
                        <UiButton
                            icon
                            size="sm"
                            :loading="testingId === webhook.id"
                            :disabled="Boolean(testingId) || deletingId === webhook.id"
                            :aria-label="isEn ? 'Test' : '测试'"
                            :title="isEn ? 'Test' : '测试'"
                            :data-testid="`webhook-test-${webhook.id}`"
                            @click="testWebhook(webhook.id)"
                            ><Send :size="16" aria-hidden="true"
                        /></UiButton>
                        <UiButton
                            icon
                            size="sm"
                            :aria-label="isEn ? 'Edit' : '编辑'"
                            :title="isEn ? 'Edit' : '编辑'"
                            :disabled="testingId === webhook.id || deletingId === webhook.id"
                            :data-testid="`webhook-edit-${webhook.id}`"
                            @click="startEdit(webhook)"
                            ><Edit2 :size="16" aria-hidden="true"
                        /></UiButton>
                        <UiButton
                            icon
                            size="sm"
                            variant="danger"
                            :aria-label="isEn ? 'Delete' : '删除'"
                            :title="isEn ? 'Delete' : '删除'"
                            :disabled="testingId === webhook.id || Boolean(deletingId)"
                            :data-testid="`webhook-delete-${webhook.id}`"
                            @click="deleteWebhook(webhook)"
                            ><Trash2 :size="16" aria-hidden="true"
                        /></UiButton>
                    </div>
                </article>
            </div>
        </UiCard>

        <UiDialog
            :open="Boolean(editing)"
            size="md"
            scrollable
            :aria-label="editorTitle"
            :content-label="isEn ? 'Webhook settings' : 'Webhook 设置'"
            @update:open="closeEditor"
        >
            <template #header
                ><h2>{{ editorTitle }}</h2></template
            >
            <div v-if="editing" class="kam-dialog-content">
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="isEn ? 'Type' : '类型'"
                    for="webhook-kind"
                >
                    <UiSelect
                        v-model="editing.kind"
                        v-bind="controlAttrs"
                        data-testid="webhook-kind"
                    >
                        <option
                            v-if="!kindOptions.some((option) => option.value === editing.kind)"
                            :value="editing.kind"
                        >
                            {{ editing.kind }}
                        </option>
                        <option
                            v-for="option in kindOptions"
                            :key="option.value"
                            :value="option.value"
                        >
                            {{ isEn ? option.labelEn : option.label }}
                        </option>
                    </UiSelect>
                </UiField>
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="isEn ? 'Label (optional)' : '备注名（可选）'"
                    for="webhook-label"
                >
                    <UiInput
                        v-model="editing.label"
                        v-bind="controlAttrs"
                        :placeholder="isEn ? 'e.g. Dev group' : '例如：开发群'"
                        data-testid="webhook-label"
                    />
                </UiField>
                <UiField v-slot="{ controlAttrs }" label="Webhook URL" for="webhook-url">
                    <UiInput
                        v-model="editing.url"
                        v-bind="controlAttrs"
                        class="kam-mono"
                        :placeholder="urlPlaceholder"
                        data-testid="webhook-url"
                    />
                </UiField>
                <UiField
                    v-if="editing.kind === 'telegram'"
                    v-slot="{ controlAttrs }"
                    label="Chat ID"
                    for="webhook-chat-id"
                >
                    <UiInput
                        v-model="editing.telegramChatId"
                        v-bind="controlAttrs"
                        class="kam-mono"
                        :placeholder="
                            isEn ? '123456789 or @channel_name' : '123456789 或 @channel_name'
                        "
                        data-testid="webhook-chat-id"
                    />
                </UiField>
                <UiField
                    v-if="editing.kind === 'custom'"
                    v-slot="{ controlAttrs }"
                    :label="isEn ? 'Custom JSON template' : '自定义 JSON 模板'"
                    for="webhook-template"
                    :description="`{{title}} {{message}} {{level}} {{icon}}`"
                >
                    <UiTextarea
                        v-model="editing.customTemplate"
                        v-bind="controlAttrs"
                        class="kam-mono"
                        :rows="4"
                        placeholder='{"text": "{{title}}", "body": "{{message}}"}'
                        data-testid="webhook-template"
                    />
                </UiField>
                <UiField :label="isEn ? 'Subscribed events' : '订阅事件'">
                    <div class="kam-event-choices">
                        <UiCheckbox
                            v-for="event in ALL_WEBHOOK_EVENTS"
                            :key="event.value"
                            :model-value="editing.events?.includes(event.value) ?? false"
                            :data-testid="`webhook-event-${event.value}`"
                            @update:model-value="toggleEvent(event.value, $event)"
                            >{{ isEn ? event.labelEn : event.label }}</UiCheckbox
                        >
                    </div>
                </UiField>
                <UiCheckbox v-model="editing.enabled" data-testid="webhook-enabled">{{
                    isEn ? 'Enabled' : '启用'
                }}</UiCheckbox>
            </div>
            <template #footer>
                <UiButton variant="ghost" @click="closeEditor">{{
                    isEn ? 'Cancel' : '取消'
                }}</UiButton>
                <UiButton
                    variant="primary"
                    :disabled="!editing?.kind || !editing?.url"
                    data-testid="webhook-save"
                    @click="saveWebhook"
                    >{{ isEn ? 'Save' : '保存' }}</UiButton
                >
            </template>
        </UiDialog>
    </section>
</template>

<style scoped>
.kam-page {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 1120px;
    margin: 0 auto;
    padding: 24px;
}
.kam-page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
}
.kam-page-header h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 6px;
    font-size: 24px;
    line-height: 1.3;
}
.kam-page-header p {
    margin: 0;
    line-height: 1.5;
}
.kam-muted {
    color: var(--muted);
}
.kam-mono {
    font-family: var(--mono);
}
.kam-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}
.kam-list-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 16px;
}
.kam-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 44px 12px;
    color: var(--muted);
    text-align: center;
}
.kam-empty p {
    margin: 0;
}
.kam-webhook-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.kam-webhook {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
}
.kam-webhook.is-disabled {
    opacity: 0.68;
}
.kam-webhook-main {
    min-width: 0;
    flex: 1;
}
.kam-webhook-heading,
.kam-events {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
}
.kam-url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 6px 0;
    font-size: 12px;
}
.kam-events {
    margin-top: 8px;
}
.kam-error {
    color: var(--red);
    margin: 8px 0 0;
    font-size: 12px;
    overflow-wrap: anywhere;
}
.kam-row-actions {
    flex-shrink: 0;
}
.kam-dialog-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.kam-event-choices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 8px;
}
@media (max-width: 640px) {
    .kam-page-header,
    .kam-webhook {
        flex-direction: column;
    }
    .kam-event-choices {
        grid-template-columns: 1fr;
    }
}
</style>
