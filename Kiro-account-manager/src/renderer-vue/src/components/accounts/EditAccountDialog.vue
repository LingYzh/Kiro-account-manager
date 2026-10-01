<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiDialog,
    UiField,
    UiInput,
    UiSelect,
    UiTextarea
} from '@lingyzh/ui'
import { Check, Clipboard, Download, RefreshCw } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { toIpcData } from '../../lib/ipcData'
import { useAccountsStore } from '../../stores/accounts'

const props = defineProps({
    open: { type: Boolean, required: true },
    account: { type: Object, default: null }
})
const emit = defineEmits(['update:open'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const accounts = useAccountsStore()
const refreshToken = ref('')
const clientId = ref('')
const clientSecret = ref('')
const region = ref('us-east-1')
const nickname = ref('')
const accountInfo = ref(null)
const verifying = ref(false)
const importing = ref(false)
const copied = ref(false)
const error = ref('')
let generation = 0
let copyTimer = null
let active = true
const social = computed(() => props.account?.credentials?.authMethod === 'social')

function clearCopyTimer() {
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = null
    copied.value = false
}

function resetForm(account) {
    generation += 1
    verifying.value = false
    importing.value = false
    clearCopyTimer()
    error.value = ''
    if (!account) {
        refreshToken.value = ''
        clientId.value = ''
        clientSecret.value = ''
        region.value = 'us-east-1'
        nickname.value = ''
        accountInfo.value = null
        return
    }
    refreshToken.value = account.credentials?.refreshToken || ''
    clientId.value = account.credentials?.clientId || ''
    clientSecret.value = account.credentials?.clientSecret || ''
    region.value = account.credentials?.region || 'us-east-1'
    nickname.value = account.nickname || ''
    accountInfo.value = {
        email: account.email,
        userId: account.userId || '',
        accessToken: account.credentials?.accessToken || '',
        subscriptionType: account.subscription?.type || '',
        subscriptionTitle: account.subscription?.title || account.subscription?.type || '',
        usage: {
            current: account.usage?.current || 0,
            limit: account.usage?.limit || 0
        },
        daysRemaining: account.subscription?.daysRemaining,
        expiresAt: account.subscription?.expiresAt
    }
}

function requestClose() {
    if (!active || !props.open) return
    generation += 1
    verifying.value = false
    importing.value = false
    clearCopyTimer()
    emit('update:open', false)
}

function copyAccessToken() {
    if (!active || !props.open || !accountInfo.value?.accessToken) return
    const token = accountInfo.value.accessToken
    const current = generation
    Promise.resolve()
        .then(() => navigator.clipboard.writeText(token))
        .then(() => {
            if (!active || !props.open || current !== generation) return
            clearCopyTimer()
            copied.value = true
            copyTimer = setTimeout(() => {
                if (active && current === generation) copied.value = false
                copyTimer = null
            }, 2000)
        })
        .catch((cause) => {
            if (active && props.open && current === generation)
                error.value = cause instanceof Error ? cause.message : String(cause)
        })
}

function importLocal() {
    if (!active || !props.open || !props.account || importing.value || verifying.value) return
    const current = generation
    importing.value = true
    error.value = ''
    Promise.resolve()
        .then(() => {
            if (!active || !props.open || current !== generation) return null
            return window.api.loadKiroCredentials()
        })
        .then((result) => {
            if (!active || !props.open || current !== generation || !result) return
            if (!result.success || !result.data) {
                error.value = result.error || (isEn.value ? 'Import failed' : '导入失败')
                return
            }
            refreshToken.value = result.data.refreshToken
            clientId.value = result.data.clientId
            clientSecret.value = result.data.clientSecret
            region.value = result.data.region
        })
        .catch((cause) => {
            if (active && props.open && current === generation)
                error.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (active && current === generation) importing.value = false
        })
}

function verify() {
    if (!active || !props.open || !props.account || verifying.value || importing.value) return
    if (!refreshToken.value) {
        error.value = isEn.value ? 'Please enter Refresh Token' : '请填写 Refresh Token'
        return
    }
    if (!social.value && (!clientId.value || !clientSecret.value)) {
        error.value = isEn.value
            ? 'Please enter Client ID and Client Secret'
            : '请填写 Client ID 和 Client Secret'
        return
    }
    const current = generation
    const credentials = toIpcData({
        refreshToken: refreshToken.value,
        clientId: clientId.value,
        clientSecret: clientSecret.value,
        region: region.value,
        authMethod: props.account.credentials?.authMethod,
        provider: props.account.credentials?.provider || props.account.idp
    })
    verifying.value = true
    error.value = ''
    Promise.resolve()
        .then(() => {
            if (!active || !props.open || current !== generation) return null
            return window.api.verifyAccountCredentials(credentials)
        })
        .then((result) => {
            if (!active || !props.open || current !== generation || !result) return
            if (!result.success || !result.data) {
                error.value = result.error || (isEn.value ? 'Verification failed' : '验证失败')
                return
            }
            accountInfo.value = {
                email: result.data.email,
                userId: result.data.userId,
                accessToken: result.data.accessToken,
                subscriptionType: result.data.subscriptionType,
                subscriptionTitle: result.data.subscriptionTitle,
                usage: result.data.usage,
                daysRemaining: result.data.daysRemaining,
                expiresAt: result.data.expiresAt
            }
            if (result.data.refreshToken) refreshToken.value = result.data.refreshToken
        })
        .catch((cause) => {
            if (active && props.open && current === generation)
                error.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (active && current === generation) verifying.value = false
        })
}

function save() {
    if (
        !active ||
        !props.open ||
        !props.account ||
        !accountInfo.value ||
        verifying.value ||
        importing.value
    )
        return
    const now = Date.now()
    const info = accountInfo.value
    const usage = info.usage || { current: 0, limit: 0 }
    try {
        accounts.updateAccount(props.account.id, {
            email: info.email,
            userId: info.userId,
            nickname: nickname.value || undefined,
            credentials: {
                ...props.account.credentials,
                accessToken: info.accessToken,
                csrfToken: '',
                refreshToken: refreshToken.value,
                clientId: clientId.value,
                clientSecret: clientSecret.value,
                region: region.value,
                expiresAt: now + 3600 * 1000
            },
            subscription: {
                type: info.subscriptionType,
                title: info.subscriptionTitle,
                daysRemaining: info.daysRemaining,
                expiresAt: info.expiresAt
            },
            usage: {
                current: usage.current,
                limit: usage.limit,
                percentUsed: usage.limit > 0 ? usage.current / usage.limit : 0,
                lastUpdated: now,
                baseLimit: usage.baseLimit,
                baseCurrent: usage.baseCurrent,
                freeTrialLimit: usage.freeTrialLimit,
                freeTrialCurrent: usage.freeTrialCurrent,
                freeTrialExpiry: usage.freeTrialExpiry,
                bonuses: usage.bonuses,
                nextResetDate: usage.nextResetDate
            },
            status: 'active'
        })
        requestClose()
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
}

watch(() => props.account, resetForm, { immediate: true })
watch(
    () => props.open,
    (open) => {
        if (!open) {
            generation += 1
            verifying.value = false
            importing.value = false
            clearCopyTimer()
        }
    }
)
onBeforeUnmount(() => {
    active = false
    generation += 1
    clearCopyTimer()
})
</script>

<template>
    <UiDialog
        :open="open && Boolean(account)"
        size="lg"
        scrollable
        :aria-label="isEn ? 'Edit Account' : '编辑账号'"
        :content-label="isEn ? 'Account credentials and information' : '账号凭证和信息'"
        @update:open="requestClose"
    >
        <template #header>
            <div>
                <h2 class="ui-card-title">{{ isEn ? 'Edit Account' : '编辑账号' }}</h2>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Modify account settings or update credentials'
                            : '修改账号配置或更新凭证'
                    }}
                </p>
            </div>
        </template>
        <div v-if="account" class="kam-dialog-content">
            <UiCard v-if="accountInfo" density="compact">
                <div class="edit-summary">
                    <div class="edit-heading">
                        <strong>{{ isEn ? 'Account Status' : '当前账号状态' }}</strong>
                        <UiBadge tone="success">{{ isEn ? 'Verified' : '已验证' }}</UiBadge>
                    </div>
                    <div class="kam-field-grid">
                        <div>
                            <span class="kam-muted">{{ isEn ? 'Email' : '邮箱' }}</span>
                            <p class="kam-mono">{{ accountInfo.email }}</p>
                        </div>
                        <div>
                            <span class="kam-muted">{{ isEn ? 'Plan' : '订阅计划' }}</span>
                            <p>{{ accountInfo.subscriptionTitle }}</p>
                        </div>
                        <div>
                            <span class="kam-muted">{{ isEn ? 'Usage' : '使用额度' }}</span>
                            <p>
                                {{ accountInfo.usage.current.toLocaleString() }} /
                                {{ accountInfo.usage.limit.toLocaleString() }}
                            </p>
                        </div>
                        <div>
                            <span class="kam-muted">{{ isEn ? 'Days Left' : '剩余天数' }}</span>
                            <p>{{ accountInfo.daysRemaining ?? '-' }} {{ isEn ? 'd' : '天' }}</p>
                        </div>
                    </div>
                </div>
            </UiCard>
            <UiField
                v-slot="{ controlAttrs }"
                class="edit-field"
                :label="isEn ? 'Nickname' : '账号别名'"
                for="account-edit-nickname"
            >
                <UiInput
                    v-model="nickname"
                    v-bind="controlAttrs"
                    :disabled="verifying || importing"
                    data-testid="account-edit-nickname"
                />
            </UiField>
            <div class="edit-heading">
                <div class="kam-actions">
                    <strong>{{
                        social
                            ? isEn
                                ? 'Social Login'
                                : '社交登录凭证'
                            : isEn
                              ? 'OIDC Credentials'
                              : 'OIDC 凭证配置'
                    }}</strong>
                    <UiBadge v-if="social" tone="accent">{{
                        account.credentials.provider || account.idp
                    }}</UiBadge>
                </div>
                <UiButton
                    v-if="!social"
                    size="sm"
                    :loading="importing"
                    :disabled="verifying"
                    data-testid="account-edit-import-local"
                    @click="importLocal"
                >
                    <Download :size="16" />{{ isEn ? 'Import Local' : '从本地导入' }}
                </UiButton>
            </div>
            <p v-if="social" class="kam-muted">
                {{
                    isEn
                        ? 'Social login only needs Refresh Token'
                        : '社交登录账号只需要 Refresh Token'
                }}
            </p>
            <div v-if="accountInfo?.accessToken" class="edit-summary">
                <div class="edit-heading">
                    <strong>Access Token</strong>
                    <UiButton
                        size="sm"
                        variant="ghost"
                        data-testid="account-edit-copy-access"
                        @click="copyAccessToken"
                    >
                        <Check v-if="copied" :size="16" /><Clipboard v-else :size="16" />{{
                            copied ? (isEn ? 'Copied' : '已复制') : isEn ? 'Copy' : '复制'
                        }}
                    </UiButton>
                </div>
                <code class="kam-mono">{{ accountInfo.accessToken.slice(0, 50) }}...</code>
            </div>
            <UiField
                v-slot="{ controlAttrs }"
                class="edit-field"
                label="Refresh Token *"
                for="account-edit-refresh-token"
            >
                <UiTextarea
                    v-model="refreshToken"
                    v-bind="controlAttrs"
                    :rows="3"
                    :disabled="verifying || importing"
                    data-testid="account-edit-refresh-token"
                />
            </UiField>
            <template v-if="!social">
                <UiField
                    v-slot="{ controlAttrs }"
                    class="edit-field"
                    label="Client ID *"
                    for="account-edit-client-id"
                >
                    <UiInput
                        v-model="clientId"
                        v-bind="controlAttrs"
                        :disabled="verifying || importing"
                        data-testid="account-edit-client-id"
                    />
                </UiField>
                <UiField
                    v-slot="{ controlAttrs }"
                    class="edit-field"
                    label="Client Secret *"
                    for="account-edit-client-secret"
                >
                    <UiInput
                        v-model="clientSecret"
                        v-bind="controlAttrs"
                        :disabled="verifying || importing"
                        data-testid="account-edit-client-secret"
                    />
                </UiField>
                <UiField
                    v-slot="{ controlAttrs }"
                    class="edit-field"
                    label="AWS Region"
                    for="account-edit-region"
                >
                    <UiSelect
                        v-model="region"
                        v-bind="controlAttrs"
                        :disabled="verifying || importing"
                        data-testid="account-edit-region"
                    >
                        <option value="us-east-1">us-east-1 (N. Virginia)</option>
                        <option value="us-west-2">us-west-2 (Oregon)</option>
                        <option value="eu-west-1">eu-west-1 (Ireland)</option>
                    </UiSelect>
                </UiField>
            </template>
            <div class="kam-actions">
                <UiButton
                    :loading="verifying"
                    :disabled="
                        importing || !refreshToken || (!social && (!clientId || !clientSecret))
                    "
                    data-testid="account-edit-verify"
                    @click="verify"
                >
                    <RefreshCw :size="16" />{{ isEn ? 'Verify & Refresh' : '验证并刷新凭证信息' }}
                </UiButton>
            </div>
            <UiAlert v-if="error" tone="error" data-testid="account-edit-error">{{
                error
            }}</UiAlert>
        </div>
        <template #footer>
            <div class="kam-actions">
                <UiButton
                    :disabled="verifying || importing"
                    data-testid="account-edit-cancel"
                    @click="requestClose"
                    >{{ isEn ? 'Cancel' : '取消' }}</UiButton
                >
                <UiButton
                    variant="primary"
                    :disabled="!accountInfo || verifying || importing"
                    data-testid="account-edit-save"
                    @click="save"
                    >{{ isEn ? 'Save Changes' : '保存更改' }}</UiButton
                >
            </div>
        </template>
    </UiDialog>
</template>

<style scoped>
.edit-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
}
.edit-summary {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.edit-summary p {
    margin: 0;
}
.edit-field {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
}
.edit-field :deep(.ui-input),
.edit-field :deep(.ui-textarea),
.edit-field :deep(.ui-select) {
    width: 100%;
}
</style>
