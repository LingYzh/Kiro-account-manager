<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import {
    UiAlert,
    UiButton,
    UiCard,
    UiCheckbox,
    UiDialog,
    UiField,
    UiInput,
    confirmDialog
} from '@lingyzh/ui'
import { Download, Upload } from 'lucide-vue-next'
import { useAppStore } from '../../stores/app'
import { useAutoSwitchStore } from '../../stores/autoSwitch'
import { useProxyPoolStore } from '../../stores/proxyPool'
import { useSettingsStore } from '../../stores/settings'
import { useWebhookStore } from '../../stores/webhooks'
import { useTranslation } from '../../composables/useTranslation'
import { decryptText, encryptText } from '../../lib/configSyncCrypto'

const REGISTER_LS_KEYS = [
    'kiro-register-ratelimit-enabled',
    'kiro-register-ratelimit-max',
    'kiro-register-autobackoff',
    'kiro-register-dailyquota-limit',
    'kiro-register-schedule-enabled',
    'kiro-register-schedule-time',
    'kiro-register-mixed-sources'
]

const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const app = useAppStore()
const autoSwitch = useAutoSwitchStore()
const proxyPool = useProxyPoolStore()
const settings = useSettingsStore()
const webhooks = useWebhookStore()
const opts = reactive({
    proxyPool: true,
    webhooks: true,
    registerConfig: true,
    registerTemplates: true,
    registerSettings: true,
    appSettings: true,
    includeProxyCredentials: false,
    encrypt: false
})
const encryptPassword = ref('')
const decryptPassword = ref('')
const decryptDialogOpen = ref(false)
const pendingEncryptedText = ref('')
const isExporting = ref(false)
const isImporting = ref(false)
const fileInput = ref(null)
const isResetting = ref(false)
const lastExportSize = ref(null)
const exportError = ref('')
const lastImportResult = ref(null)
const resetMessage = ref('')
const resetError = ref('')
let mounted = true
let importGeneration = 0
let exportGeneration = 0
let resetGeneration = 0

const exportChoices = computed(() => [
    {
        key: 'proxyPool',
        label: text(
            `代理池 (${proxyPool.proxyPool.size})`,
            `Proxy Pool (${proxyPool.proxyPool.size})`
        )
    },
    {
        key: 'webhooks',
        label: text(`Webhook (${webhooks.webhooks.size})`, `Webhooks (${webhooks.webhooks.size})`)
    },
    { key: 'registerConfig', label: text('注册配置', 'Register Config') },
    { key: 'registerTemplates', label: text('注册模板', 'Register Templates') },
    {
        key: 'registerSettings',
        label: text('注册偏好（限速/定时/配额等）', 'Register Preferences')
    },
    {
        key: 'appSettings',
        label: text('App 设置（主题/语言/自动刷新）', 'App Settings (theme/lang/auto-refresh)')
    }
])

function text(zh, en) {
    return isEn.value ? en : zh
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error)
}

function readJsonStorage(key) {
    try {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : undefined
    } catch {
        return undefined
    }
}

function createPayload() {
    const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        app: 'kiro-account-manager'
    }
    if (opts.proxyPool && proxyPool.proxyPool.size > 0) {
        payload.proxyPool = Array.from(proxyPool.proxyPool.values()).map((proxy) => {
            const out = { ...proxy }
            if (!opts.includeProxyCredentials) {
                delete out.password
                out.url = proxy.url.replace(/:([^:@/]+)@/, ':***@')
            }
            return out
        })
        payload.proxyPoolConfig = { ...proxyPool.proxyPoolConfig }
    }
    if (opts.webhooks) {
        payload.webhooks = Array.from(webhooks.webhooks.values()).map((webhook) => ({ ...webhook }))
    }
    if (opts.registerConfig) {
        const value = readJsonStorage('kiro-register-config')
        if (value) payload.registerConfig = value
    }
    if (opts.registerTemplates) {
        const value = readJsonStorage('kiro-register-templates')
        if (value) payload.registerTemplates = value
    }
    if (opts.registerSettings) {
        const values = {}
        for (const key of REGISTER_LS_KEYS) {
            const value = localStorage.getItem(key)
            if (value != null) values[key] = value
        }
        payload.registerLocalStorage = values
    }
    if (opts.appSettings) {
        payload.appSettings = {
            theme: settings.theme,
            darkMode: settings.darkMode,
            language: settings.language,
            autoRefreshEnabled: settings.autoRefreshEnabled,
            autoRefreshInterval: settings.autoRefreshInterval,
            autoRefreshConcurrency: settings.autoRefreshConcurrency,
            statusCheckInterval: settings.statusCheckInterval,
            privacyMode: settings.privacyMode,
            usagePrecision: settings.usagePrecision,
            autoSwitchEnabled: autoSwitch.autoSwitchEnabled,
            autoSwitchThreshold: autoSwitch.autoSwitchThreshold,
            autoSwitchInterval: autoSwitch.autoSwitchInterval,
            switchTarget: settings.switchTarget
        }
    }
    return payload
}

function downloadText(outputText, encrypted) {
    const blob = new Blob([outputText], {
        type: encrypted ? 'application/octet-stream' : 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `kiro-config-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.${encrypted ? 'kcfg' : 'json'}`
    try {
        anchor.click()
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
}

function handleExport() {
    if (isExporting.value || (opts.encrypt && !encryptPassword.value.trim())) return
    isExporting.value = true
    exportError.value = ''
    const generation = ++exportGeneration
    const encrypted = opts.encrypt
    const password = encryptPassword.value
    Promise.resolve()
        .then(() => JSON.stringify(createPayload(), null, 2))
        .then((plain) => (encrypted ? encryptText(plain, password) : plain))
        .then((outputText) => {
            if (!mounted || generation !== exportGeneration) return
            downloadText(outputText, encrypted)
            lastExportSize.value = outputText.length
        })
        .catch((error) => {
            if (mounted && generation === exportGeneration) exportError.value = errorMessage(error)
        })
        .finally(() => {
            if (mounted && generation === exportGeneration) isExporting.value = false
        })
}

function importProxyEntries(data, counts) {
    if (data.proxyPool && data.proxyPool.length > 0) {
        let added = 0
        for (const proxy of data.proxyPool) {
            let id = null
            if (typeof proxy.url === 'string' && !proxy.url.includes('***')) {
                id = proxyPool.addProxy(proxy.url, {
                    label: proxy.label,
                    source: 'import-config',
                    tags: proxy.tags
                })
            } else if (proxy.host && proxy.port) {
                const protocol = proxy.protocol || 'http'
                const url = `${protocol}://${proxy.host}:${proxy.port}`
                id = proxyPool.addProxy(url, {
                    label: proxy.label,
                    source: 'import-config-masked',
                    tags: proxy.tags
                })
            }
            if (id) added += 1
        }
        counts['代理池'] = added
    }
    if (data.proxyPoolConfig) proxyPool.setProxyPoolConfig(data.proxyPoolConfig)
}

function importWebhooks(data, counts) {
    if (!data.webhooks || data.webhooks.length === 0) return
    let added = 0
    for (const webhook of data.webhooks) {
        if (webhook.kind && webhook.url) {
            webhooks.addWebhook(webhook)
            added += 1
        }
    }
    counts.Webhook = added
}

function importRegisterStorage(data, counts) {
    if (data.registerConfig) {
        try {
            localStorage.setItem('kiro-register-config', JSON.stringify(data.registerConfig))
            counts['注册配置'] = 1
        } catch {
            /* Match the original localStorage failure behavior. */
        }
    }
    if (data.registerTemplates) {
        try {
            localStorage.setItem('kiro-register-templates', JSON.stringify(data.registerTemplates))
            counts['注册模板'] = data.registerTemplates.length
        } catch {
            /* Match the original localStorage failure behavior. */
        }
    }
    if (data.registerLocalStorage) {
        let written = 0
        for (const [key, value] of Object.entries(data.registerLocalStorage)) {
            if (!REGISTER_LS_KEYS.includes(key)) continue
            try {
                localStorage.setItem(key, value)
                written += 1
            } catch {
                /* Match the original localStorage failure behavior. */
            }
        }
        counts['注册偏好'] = written
    }
}

function importAppSettings(data, counts) {
    if (!data.appSettings) return
    const imported = data.appSettings
    if (imported.theme != null) settings.setTheme(imported.theme)
    if (imported.darkMode != null) {
        app.setThemeMode(imported.darkMode ? 'dark' : 'light')
    }
    if (imported.language != null) settings.setLanguage(imported.language)
    if (imported.autoRefreshEnabled != null)
        settings.setAutoRefresh(imported.autoRefreshEnabled, imported.autoRefreshInterval)
    if (imported.autoRefreshConcurrency != null)
        settings.setAutoRefreshConcurrency(imported.autoRefreshConcurrency)
    if (imported.statusCheckInterval != null)
        settings.setStatusCheckInterval(imported.statusCheckInterval)
    if (imported.privacyMode != null) settings.setPrivacyMode(imported.privacyMode)
    if (imported.usagePrecision != null) settings.setUsagePrecision(imported.usagePrecision)
    if (imported.autoSwitchEnabled != null)
        autoSwitch.setAutoSwitch(
            imported.autoSwitchEnabled,
            imported.autoSwitchThreshold,
            imported.autoSwitchInterval
        )
    if (
        imported.switchTarget === 'ide' ||
        imported.switchTarget === 'cli' ||
        imported.switchTarget === 'both'
    )
        settings.setSwitchTarget(imported.switchTarget)
    counts['App 设置'] = 1
}

function applyImport(plaintext, generation) {
    if (!mounted || generation !== importGeneration) return
    const data = JSON.parse(plaintext)
    if (data.app !== 'kiro-account-manager') {
        lastImportResult.value = {
            success: false,
            error: text(
                '文件不是有效的 Kiro 账号管理器配置（app 标识不匹配）',
                'Not a valid Kiro Account Manager config (app mismatch)'
            )
        }
        return
    }
    const counts = {}
    importProxyEntries(data, counts)
    importWebhooks(data, counts)
    importRegisterStorage(data, counts)
    importAppSettings(data, counts)
    lastImportResult.value = { success: true, counts }
}

function chooseImportFile() {
    if (!isImporting.value) fileInput.value?.click()
}

function handleFileSelected(event) {
    const input = event.target
    const file = input.files?.[0]
    input.value = ''
    if (!file || isImporting.value) return
    isImporting.value = true
    lastImportResult.value = null
    const generation = ++importGeneration
    Promise.resolve()
        .then(() => file.text())
        .then((content) => {
            if (!mounted || generation !== importGeneration) return
            if (file.name.endsWith('.kcfg') || content.startsWith('KCFG1:')) {
                pendingEncryptedText.value = content
                decryptPassword.value = ''
                decryptDialogOpen.value = true
                return
            }
            applyImport(content, generation)
            isImporting.value = false
        })
        .catch((error) => {
            if (!mounted || generation !== importGeneration) return
            lastImportResult.value = { success: false, error: errorMessage(error) }
            isImporting.value = false
        })
}

function finishEncryptedImport() {
    if (!decryptPassword.value || !pendingEncryptedText.value || !isImporting.value) return
    const generation = importGeneration
    const envelope = pendingEncryptedText.value
    const password = decryptPassword.value
    decryptPassword.value = ''
    decryptDialogOpen.value = false
    Promise.resolve()
        .then(() => decryptText(envelope, password))
        .catch((error) => {
            if (mounted && generation === importGeneration) {
                lastImportResult.value = {
                    success: false,
                    error: text(
                        `解密失败：${errorMessage(error)}`,
                        `Decryption failed: ${errorMessage(error)}`
                    )
                }
            }
            return null
        })
        .then((plaintext) => {
            if (plaintext === null) return
            try {
                applyImport(plaintext, generation)
            } catch (error) {
                if (mounted && generation === importGeneration) {
                    lastImportResult.value = { success: false, error: errorMessage(error) }
                }
            }
        })
        .finally(() => {
            if (mounted && generation === importGeneration) {
                pendingEncryptedText.value = ''
                isImporting.value = false
            }
        })
}

function cancelEncryptedImport() {
    importGeneration += 1
    pendingEncryptedText.value = ''
    decryptPassword.value = ''
    decryptDialogOpen.value = false
    isImporting.value = false
}

function handlePasswordDialogOpen(value) {
    if (!value) cancelEncryptedImport()
    else decryptDialogOpen.value = true
}

function resetRegisterPreferences() {
    if (isResetting.value) return
    isResetting.value = true
    resetMessage.value = ''
    resetError.value = ''
    const generation = ++resetGeneration
    confirmDialog({
        title: text('重置注册页偏好', 'Reset Register Preferences'),
        message: text(
            '重置注册页所有偏好（限速/定时/配额/混合源/黑名单/模板）？不影响账号数据。',
            'Reset register page preferences (rate limit / schedule / quota / mixed sources / blacklist / templates)? This does NOT affect accounts.'
        ),
        confirmText: text('重置', 'Reset'),
        cancelText: text('取消', 'Cancel'),
        tone: 'danger'
    })
        .then((confirmed) => {
            if (!mounted || generation !== resetGeneration || !confirmed) return
            for (const key of REGISTER_LS_KEYS) localStorage.removeItem(key)
            localStorage.removeItem('kiro-register-templates')
            localStorage.removeItem('kiro-register-email-blacklist')
            resetMessage.value = text('已重置，请刷新页面', 'Done. Please reload the page.')
        })
        .catch((error) => {
            if (mounted && generation === resetGeneration) resetError.value = errorMessage(error)
        })
        .finally(() => {
            if (mounted && generation === resetGeneration) isResetting.value = false
        })
}

onBeforeUnmount(() => {
    mounted = false
    importGeneration += 1
    exportGeneration += 1
    resetGeneration += 1
})
</script>

<template>
    <section class="kam-page" data-testid="page-configSync">
        <header class="kam-page-header">
            <div>
                <h1>{{ text('配置同步', 'Config Sync') }}</h1>
                <p class="kam-muted">
                    {{
                        text(
                            '导出/导入非敏感配置（代理池、Webhook、注册模板、应用偏好），用于多设备同步',
                            'Export and import non-sensitive app config for multi-device sync.'
                        )
                    }}
                </p>
            </div>
        </header>

        <UiAlert tone="warning" :title="text('安全提示', 'Security Notice')">
            <p>
                {{
                    text(
                        '本页导出不包含账号凭据、Refresh Token 等敏感数据。账号导出请走「账户管理 → 导出」专用通道。',
                        'This export does not include account credentials or refresh tokens. Use Account Export for those.'
                    )
                }}
            </p>
            <p>
                {{
                    text(
                        '分享给他人时，建议关闭「包含代理密码」选项。',
                        'Keep Include proxy credentials off when sharing the file.'
                    )
                }}
            </p>
        </UiAlert>

        <UiCard :title="text('导出', 'Export')" density="compact">
            <div class="config-options kam-field-grid">
                <UiCheckbox
                    v-for="choice in exportChoices"
                    :key="choice.key"
                    v-model="opts[choice.key]"
                    :disabled="isExporting"
                    :data-testid="`config-option-${choice.key}`"
                >
                    {{ choice.label }}
                </UiCheckbox>
            </div>
            <div class="config-extra-options">
                <UiCheckbox
                    v-model="opts.includeProxyCredentials"
                    :disabled="isExporting"
                    data-testid="config-include-proxy-credentials"
                >
                    {{
                        text(
                            '包含代理密码（分享时不建议）',
                            'Include proxy credentials (not recommended for sharing)'
                        )
                    }}
                </UiCheckbox>
                <UiCheckbox
                    v-model="opts.encrypt"
                    :disabled="isExporting"
                    data-testid="config-encrypt"
                >
                    {{ text('加密导出 (AES-GCM)', 'Encrypt (AES-GCM)') }}
                </UiCheckbox>
                <UiField
                    v-if="opts.encrypt"
                    v-slot="{ controlAttrs }"
                    :label="text('加密密码', 'Encryption password')"
                    for="config-encrypt-password"
                >
                    <UiInput
                        v-model="encryptPassword"
                        v-bind="controlAttrs"
                        type="password"
                        autocomplete="new-password"
                        :disabled="isExporting"
                        data-testid="config-encrypt-password"
                    />
                </UiField>
            </div>
            <UiAlert
                v-if="exportError"
                tone="error"
                :title="text('导出失败', 'Export failed')"
                data-testid="config-export-error"
                >{{ exportError }}</UiAlert
            >
            <p v-if="lastExportSize !== null" class="kam-muted">
                {{
                    text(
                        `上次导出大小: ${(lastExportSize / 1024).toFixed(1)} KB`,
                        `Last export: ${(lastExportSize / 1024).toFixed(1)} KB`
                    )
                }}
            </p>
            <template #actions>
                <UiButton
                    :loading="isExporting"
                    :disabled="opts.encrypt && !encryptPassword.trim()"
                    data-testid="config-export"
                    @click="handleExport"
                >
                    <Download :size="16" aria-hidden="true" />
                    {{ text('导出', 'Export') }}
                </UiButton>
            </template>
        </UiCard>

        <UiCard :title="text('导入', 'Import')" density="compact">
            <p class="kam-muted">
                {{
                    text(
                        '选择之前导出的配置 JSON 或 KCFG 文件。重复项会自动合并/跳过。',
                        'Choose a previously exported JSON or KCFG file. Duplicates are merged or skipped.'
                    )
                }}
            </p>
            <UiButton
                :disabled="isImporting"
                data-testid="config-choose-file"
                @click="chooseImportFile"
            >
                <Upload :size="16" aria-hidden="true" />
                <span>{{ text('选择文件', 'Choose file') }}</span>
            </UiButton>
            <input
                ref="fileInput"
                type="file"
                hidden
                accept="application/json,.json,.kcfg"
                :disabled="isImporting"
                data-testid="config-import"
                @change="handleFileSelected"
            />
            <UiAlert
                v-if="lastImportResult?.success"
                tone="success"
                :title="text('导入成功', 'Import Successful')"
                data-testid="config-import-success"
            >
                <dl class="config-counts">
                    <div v-for="(count, key) in lastImportResult.counts" :key="key">
                        <dt>{{ key }}</dt>
                        <dd class="kam-mono">{{ count }}</dd>
                    </div>
                </dl>
            </UiAlert>
            <UiAlert
                v-else-if="lastImportResult"
                tone="error"
                :title="text('导入失败', 'Import Failed')"
                data-testid="config-import-error"
                >{{ lastImportResult.error }}</UiAlert
            >
        </UiCard>

        <UiCard :title="text('危险操作', 'Danger Zone')" density="compact">
            <UiButton
                variant="danger"
                size="sm"
                :loading="isResetting"
                data-testid="config-reset"
                @click="resetRegisterPreferences"
            >
                {{ text('重置注册页偏好', 'Reset Register Preferences') }}
            </UiButton>
            <UiAlert v-if="resetMessage" tone="success" :title="text('已重置', 'Reset complete')">{{
                resetMessage
            }}</UiAlert>
            <UiAlert v-if="resetError" tone="error" :title="text('重置失败', 'Reset failed')">{{
                resetError
            }}</UiAlert>
        </UiCard>

        <UiDialog
            :open="decryptDialogOpen"
            size="sm"
            scrollable
            :content-label="text('解密配置', 'Decrypt configuration')"
            :aria-label="text('解密配置', 'Decrypt configuration')"
            data-testid="config-password-dialog"
            @update:open="handlePasswordDialogOpen"
        >
            <template #header
                ><h2 class="text-title">
                    {{ text('请输入解密密码', 'Enter decryption password') }}
                </h2></template
            >
            <div class="kam-dialog-content">
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="text('密码', 'Password')"
                    for="config-decrypt-password"
                >
                    <UiInput
                        v-model="decryptPassword"
                        v-bind="controlAttrs"
                        type="password"
                        autocomplete="current-password"
                        data-testid="config-password"
                        @keydown.enter="finishEncryptedImport"
                    />
                </UiField>
            </div>
            <template #footer>
                <UiButton
                    variant="ghost"
                    data-testid="config-password-cancel"
                    @click="cancelEncryptedImport"
                    >{{ text('取消', 'Cancel') }}</UiButton
                >
                <UiButton
                    :disabled="!decryptPassword"
                    data-testid="config-password-submit"
                    @click="finishEncryptedImport"
                    >{{ text('导入', 'Import') }}</UiButton
                >
            </template>
        </UiDialog>
    </section>
</template>

<style scoped>
.config-options {
    margin-bottom: 16px;
}
.config-extra-options {
    display: grid;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
}
.config-extra-options :deep(.ui-field),
.kam-dialog-content :deep(.ui-field) {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
}
.config-extra-options :deep(.ui-input),
.kam-dialog-content :deep(.ui-input) {
    width: 100%;
}
.config-counts {
    display: grid;
    gap: 4px;
    margin: 8px 0 0;
}
.config-counts div {
    display: flex;
    justify-content: space-between;
    gap: 16px;
}
.config-counts dd {
    margin: 0;
}
</style>
