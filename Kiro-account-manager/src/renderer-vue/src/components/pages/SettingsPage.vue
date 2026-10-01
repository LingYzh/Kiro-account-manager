<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
    UiAlert,
    UiButton,
    UiCard,
    UiField,
    UiInput,
    UiSelect,
    UiSwitch,
    confirmDialog
} from '@lingyzh/ui'
import { Download, RefreshCw, Trash2, Upload } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { useAppStore } from '../../stores/app'
import { useAccountsStore } from '../../stores/accounts'
import { useAutoSwitchStore } from '../../stores/autoSwitch'
import { useSettingsStore } from '../../stores/settings'
import { toIpcData } from '../../lib/ipcData'
import ExportDialog from '../accounts/ExportDialog.vue'
import LegacyConfigSyncCard from '../settings/LegacyConfigSyncCard.vue'

const { t } = useTranslation()
const isEn = computed(() => t('common.unknown') === 'Unknown')
const app = useAppStore()
const accounts = useAccountsStore()
const autoSwitch = useAutoSwitchStore()
const settings = useSettingsStore()
const accountList = computed(() => Array.from(accounts.accounts.values()))
const exportOpen = ref(false)
const importing = ref(false)
const clearing = ref(false)
const refreshing = ref(false)
const renewing = ref(false)
const proxyDraft = ref(settings.proxyUrl)
const proxyDirty = ref(false)
const proxyBusy = ref(false)
const tray = ref({
    enabled: true,
    closeAction: 'ask',
    showNotifications: true,
    minimizeOnStart: false
})
const trayLoading = ref(true)
const trayBusy = ref(false)
const shortcut = ref('')
const shortcutLoading = ref(true)
const shortcutBusy = ref(false)
const recordingShortcut = ref(false)
const usageApiType = ref('rest')
const usageLoading = ref(true)
const usageBusy = ref(false)
const kproxy = ref(false)
const kproxyLoading = ref(true)
const kproxyBusy = ref(false)
const error = ref('')
const success = ref('')
const shortcutError = ref('')
const loadFailed = ref(false)
const initialLoading = computed(
    () => trayLoading.value || shortcutLoading.value || usageLoading.value || kproxyLoading.value
)
let active = true
let proxyLoadGeneration = 0

watch(
    () => settings.proxyUrl,
    (value) => {
        if (!proxyDirty.value) proxyDraft.value = value
    }
)

function showFailure(cause, fallback) {
    if (!active) return
    error.value = cause instanceof Error ? cause.message : String(cause || fallback)
    success.value = ''
}

function clearFeedback() {
    error.value = ''
    success.value = ''
}

function loadTray() {
    if (!active || !trayLoading.value) return
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.getTraySettings()
        })
        .then((result) => {
            if (active && result) tray.value = result
        })
        .catch((cause) => {
            if (!active) return
            loadFailed.value = true
            showFailure(cause, isEn.value ? 'Failed to load tray settings' : '加载托盘设置失败')
        })
        .finally(() => {
            if (active) trayLoading.value = false
        })
}

function loadShortcut() {
    if (!active || !shortcutLoading.value) return
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.getShowWindowShortcut()
        })
        .then((result) => {
            if (active && result !== null) shortcut.value = result
        })
        .catch((cause) => {
            if (!active) return
            loadFailed.value = true
            showFailure(cause, isEn.value ? 'Failed to load shortcut' : '加载快捷键失败')
        })
        .finally(() => {
            if (active) shortcutLoading.value = false
        })
}

function loadUsageApi() {
    if (!active || !usageLoading.value) return
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.getUsageApiType()
        })
        .then((result) => {
            if (active && result) usageApiType.value = result
        })
        .catch((cause) => {
            if (!active) return
            loadFailed.value = true
            showFailure(cause, isEn.value ? 'Failed to load usage API' : '加载用量 API 失败')
        })
        .finally(() => {
            if (active) usageLoading.value = false
        })
}

function loadKproxy() {
    if (!active || !kproxyLoading.value) return
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.getUseKProxyForApi()
        })
        .then((result) => {
            if (active && result !== null) kproxy.value = Boolean(result)
        })
        .catch((cause) => {
            if (!active) return
            loadFailed.value = true
            showFailure(
                cause,
                isEn.value ? 'Failed to load K-Proxy setting' : '加载 K-Proxy 设置失败'
            )
        })
        .finally(() => {
            if (active) kproxyLoading.value = false
        })
}

function retryLoads() {
    if (!active || !loadFailed.value || initialLoading.value) return
    loadFailed.value = false
    clearFeedback()
    trayLoading.value = true
    shortcutLoading.value = true
    usageLoading.value = true
    kproxyLoading.value = true
    loadTray()
    loadShortcut()
    loadUsageApi()
    loadKproxy()
}

function updateTray(key, value) {
    if (!active || trayLoading.value || trayBusy.value) return
    trayBusy.value = true
    clearFeedback()
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.saveTraySettings(toIpcData({ [key]: value }))
        })
        .then((result) => {
            if (!active || !result) return
            if (!result.success) {
                showFailure(
                    result.error,
                    isEn.value ? 'Failed to save tray setting' : '保存托盘设置失败'
                )
                return
            }
            tray.value = { ...tray.value, [key]: value }
        })
        .catch((cause) =>
            showFailure(cause, isEn.value ? 'Failed to save tray setting' : '保存托盘设置失败')
        )
        .finally(() => {
            if (active) trayBusy.value = false
        })
}

function updateShortcut(value) {
    if (!active || shortcutLoading.value || shortcutBusy.value) return
    shortcutBusy.value = true
    shortcutError.value = ''
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.setShowWindowShortcut(toIpcData(value))
        })
        .then((result) => {
            if (!active || !result) return
            if (!result.success) {
                shortcutError.value =
                    result.error || (isEn.value ? 'Failed to set shortcut' : '设置快捷键失败')
                return
            }
            shortcut.value = value
        })
        .catch((cause) => {
            if (active) shortcutError.value = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
            if (active) shortcutBusy.value = false
        })
}

function recordShortcut(event) {
    if (!recordingShortcut.value || shortcutBusy.value) return
    event.preventDefault()
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return
    const parts = []
    if (event.ctrlKey) parts.push('Ctrl')
    if (event.metaKey) parts.push('Command')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')
    parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key)
    recordingShortcut.value = false
    event.target.blur()
    updateShortcut(parts.join('+'))
}

function updateUsageApi(value) {
    if (!active || usageLoading.value || usageBusy.value || value === usageApiType.value) return
    usageBusy.value = true
    clearFeedback()
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.setUsageApiType(toIpcData(value))
        })
        .then((result) => {
            if (!active || !result) return
            if (!result.success) {
                showFailure(
                    result.error,
                    isEn.value ? 'Failed to save usage API' : '保存用量 API 失败'
                )
                return
            }
            usageApiType.value = value
        })
        .catch((cause) =>
            showFailure(cause, isEn.value ? 'Failed to save usage API' : '保存用量 API 失败')
        )
        .finally(() => {
            if (active) usageBusy.value = false
        })
}

function updateKproxy(value) {
    if (!active || kproxyLoading.value || kproxyBusy.value) return
    kproxyBusy.value = true
    clearFeedback()
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.setUseKProxyForApi(toIpcData(value))
        })
        .then((result) => {
            if (!active || !result) return
            if (!result.success) {
                showFailure(
                    result.error,
                    isEn.value ? 'Failed to save K-Proxy setting' : '保存 K-Proxy 设置失败'
                )
                return
            }
            kproxy.value = Boolean(result.enabled)
        })
        .catch((cause) =>
            showFailure(
                cause,
                isEn.value ? 'Failed to save K-Proxy setting' : '保存 K-Proxy 设置失败'
            )
        )
        .finally(() => {
            if (active) kproxyBusy.value = false
        })
}

function updateProxy(value, url) {
    if (!active || proxyBusy.value) return
    proxyBusy.value = true
    const generation = ++proxyLoadGeneration
    clearFeedback()
    Promise.resolve()
        .then(() => {
            if (!active || generation !== proxyLoadGeneration) return null
            return settings.setProxy(value, url)
        })
        .then(() => {
            if (!active || generation !== proxyLoadGeneration) return
            proxyDraft.value = settings.proxyUrl
            proxyDirty.value = false
        })
        .catch((cause) =>
            showFailure(cause, isEn.value ? 'Failed to update proxy' : '更新代理失败')
        )
        .finally(() => {
            if (active && generation === proxyLoadGeneration) proxyBusy.value = false
        })
}

function editProxyUrl(value) {
    proxyDraft.value = value
    proxyDirty.value = true
}

function toggleRenewal() {
    if (!active || renewing.value) return
    renewing.value = true
    clearFeedback()
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return settings.setProactiveRenewalEnabled(!settings.proactiveRenewalEnabled)
        })
        .then((result) => {
            if (active && result && !result.success)
                showFailure(
                    result.error,
                    isEn.value ? 'Failed to toggle proactive renewal' : '切换主动续期失败'
                )
        })
        .catch((cause) =>
            showFailure(
                cause,
                isEn.value ? 'Failed to toggle proactive renewal' : '切换主动续期失败'
            )
        )
        .finally(() => {
            if (active) renewing.value = false
        })
}

function manualRefresh() {
    if (!active || refreshing.value) return
    refreshing.value = true
    clearFeedback()
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return accounts.checkAndRefreshExpiringTokens()
        })
        .catch((cause) => showFailure(cause, isEn.value ? 'Refresh failed' : '刷新失败'))
        .finally(() => {
            if (active) refreshing.value = false
        })
}

function importAccounts() {
    if (!active || importing.value || clearing.value) return
    importing.value = true
    clearFeedback()
    Promise.resolve()
        .then(() => {
            if (!active) return null
            return window.api.importFromFile()
        })
        .then((fileData) => {
            if (!active || !fileData) return
            if (fileData.format !== 'json')
                throw new Error(
                    isEn.value
                        ? 'Settings only supports JSON account import'
                        : '设置页面仅支持 JSON 账号导入'
                )
            const result = accounts.importFromExportData(JSON.parse(fileData.content))
            success.value = isEn.value
                ? `Imported: ${result.success} succeeded, ${result.failed} failed`
                : `导入完成：成功 ${result.success} 个，失败 ${result.failed} 个`
        })
        .catch((cause) => showFailure(cause, isEn.value ? 'Import failed' : '导入失败'))
        .finally(() => {
            if (active) importing.value = false
        })
}

async function clearAccounts() {
    if (!active || clearing.value || importing.value) return
    clearing.value = true
    clearFeedback()
    try {
        const first = await confirmDialog({
            title: isEn.value ? 'Clear all account data?' : '确定要清除所有账号数据吗？',
            message: isEn.value ? 'This cannot be undone.' : '此操作不可恢复！',
            confirmText: isEn.value ? 'Continue' : '继续',
            cancelText: isEn.value ? 'Cancel' : '取消',
            tone: 'danger'
        })
        if (!active || !first) return
        const second = await confirmDialog({
            title: isEn.value ? 'Confirm clear' : '再次确认',
            message: isEn.value
                ? 'Delete all accounts, groups and tags data?'
                : '这将删除所有账号、分组和标签数据！',
            confirmText: isEn.value ? 'Clear' : '清除',
            cancelText: isEn.value ? 'Cancel' : '取消',
            tone: 'danger'
        })
        if (!active || !second) return
        for (const id of Array.from(accounts.accounts.keys())) accounts.removeAccount(id)
        success.value = isEn.value ? 'All account data cleared' : '所有数据已清除'
    } catch (cause) {
        showFailure(cause, isEn.value ? 'Clear failed' : '清除失败')
    } finally {
        if (active) clearing.value = false
    }
}

onMounted(() => {
    loadTray()
    loadShortcut()
    loadUsageApi()
    loadKproxy()
})
onBeforeUnmount(() => {
    active = false
    proxyLoadGeneration += 1
})
</script>

<template>
    <div class="kam-page" data-testid="page-settings">
        <header class="kam-page-header">
            <div>
                <h1>{{ isEn ? 'Settings' : '设置' }}</h1>
                <p class="kam-muted">
                    {{ isEn ? 'App preferences and data management' : '应用偏好与数据管理' }}
                </p>
            </div>
            <UiButton
                v-if="loadFailed"
                :disabled="initialLoading"
                data-testid="settings-retry-load"
                @click="retryLoads"
                ><RefreshCw :size="16" />{{ isEn ? 'Retry loading' : '重试加载' }}</UiButton
            >
        </header>

        <UiAlert v-if="error" tone="error" data-testid="settings-error">{{ error }}</UiAlert>
        <UiAlert v-if="success" tone="success" data-testid="settings-success">{{
            success
        }}</UiAlert>

        <div class="kam-grid">
            <UiCard
                ><div class="settings-card">
                    <h2 class="ui-card-title">{{ isEn ? 'Language' : '语言 / Language' }}</h2>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="isEn ? 'Display language' : '显示语言'"
                        for="settings-language"
                    >
                        <UiSelect
                            :model-value="settings.language"
                            v-bind="controlAttrs"
                            data-testid="settings-language"
                            @update:model-value="settings.setLanguage($event)"
                        >
                            <option value="auto">
                                {{ isEn ? 'Auto (system)' : '自动（跟随系统）' }}
                            </option>
                            <option value="zh">简体中文</option>
                            <option value="en">English</option>
                        </UiSelect>
                    </UiField>
                </div></UiCard
            >
            <UiCard
                ><div class="settings-card">
                    <h2 class="ui-card-title">{{ isEn ? 'Theme' : '主题设置' }}</h2>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="isEn ? 'Appearance' : '外观模式'"
                        for="settings-theme"
                    >
                        <UiSelect
                            :model-value="app.themeMode"
                            v-bind="controlAttrs"
                            data-testid="settings-theme"
                            @update:model-value="app.setThemeMode($event)"
                        >
                            <option value="light">{{ isEn ? 'Light' : '浅色' }}</option>
                            <option value="dark">{{ isEn ? 'Dark' : '深色' }}</option>
                            <option value="system">{{ isEn ? 'System' : '跟随系统' }}</option>
                        </UiSelect>
                    </UiField>
                </div></UiCard
            >
        </div>

        <UiCard
            ><div class="settings-card">
                <h2 class="ui-card-title">{{ isEn ? 'Privacy & Account' : '隐私与账户' }}</h2>
                <div class="settings-row">
                    <div>
                        <strong>{{ isEn ? 'Privacy Mode' : '隐私模式' }}</strong>
                        <p class="kam-muted">
                            {{ isEn ? 'Mask account emails and nicknames' : '隐藏账户邮箱和昵称' }}
                        </p>
                    </div>
                    <UiSwitch
                        :model-value="settings.privacyMode"
                        :aria-label="isEn ? 'Privacy Mode' : '隐私模式'"
                        data-testid="settings-privacy"
                        @update:model-value="settings.setPrivacyMode($event)"
                    />
                </div>
                <div class="settings-row">
                    <div>
                        <strong>{{ isEn ? 'Precise Usage' : '精确用量' }}</strong>
                        <p class="kam-muted">
                            {{ isEn ? 'Show decimal usage values' : '显示用量小数' }}
                        </p>
                    </div>
                    <UiSwitch
                        :model-value="settings.usagePrecision"
                        :aria-label="isEn ? 'Precise Usage' : '精确用量'"
                        data-testid="settings-precision"
                        @update:model-value="settings.setUsagePrecision($event)"
                    />
                </div>
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="isEn ? 'Switch Target' : '切换目标'"
                    for="settings-switch-target"
                >
                    <UiSelect
                        :model-value="settings.switchTarget"
                        v-bind="controlAttrs"
                        data-testid="settings-switch-target"
                        @update:model-value="settings.setSwitchTarget($event)"
                    >
                        <option value="ide">{{ isEn ? 'Kiro IDE only' : '仅 Kiro IDE' }}</option>
                        <option value="cli">{{ isEn ? 'Kiro CLI only' : '仅 Kiro CLI' }}</option>
                        <option value="both">{{ isEn ? 'Both' : '两者都切换' }}</option>
                    </UiSelect>
                </UiField>
                <div class="settings-row">
                    <div>
                        <strong>{{ isEn ? 'Private Login' : '隐私模式登录' }}</strong>
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? 'Use a private browser window for login'
                                    : '登录时使用浏览器无痕模式'
                            }}
                        </p>
                    </div>
                    <UiSwitch
                        :model-value="settings.loginPrivateMode"
                        :aria-label="isEn ? 'Private Login' : '隐私模式登录'"
                        data-testid="settings-private-login"
                        @update:model-value="settings.setLoginPrivateMode($event)"
                    />
                </div></div
        ></UiCard>

        <UiCard
            ><div class="settings-card">
                <div class="settings-heading">
                    <h2 class="ui-card-title">{{ isEn ? 'Token Refresh' : 'Token 刷新' }}</h2>
                    <UiButton
                        v-if="settings.autoRefreshEnabled"
                        size="sm"
                        :loading="refreshing"
                        data-testid="settings-refresh-now"
                        @click="manualRefresh"
                        ><RefreshCw :size="16" />{{ isEn ? 'Refresh Now' : '立即刷新' }}</UiButton
                    >
                </div>
                <div class="settings-row">
                    <div>
                        <strong>{{ isEn ? 'Automatic Refresh' : '自动刷新' }}</strong>
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? 'Refresh expiring account tokens'
                                    : '自动刷新即将过期的账号 Token'
                            }}
                        </p>
                    </div>
                    <UiSwitch
                        :model-value="settings.autoRefreshEnabled"
                        :aria-label="isEn ? 'Automatic Refresh' : '自动刷新'"
                        data-testid="settings-auto-refresh"
                        @update:model-value="settings.setAutoRefresh($event)"
                    />
                </div>
                <UiAlert variant="info">
                    {{
                        isEn
                            ? 'Kiro IDE has its own refresh loop. Turning off this app’s auto refresh does not stop IDE refresh. Only the active IDE account is synchronized to its token file; IDE changes are synchronized back.'
                            : 'Kiro IDE 有独立的刷新循环；关闭本工具自动刷新不会停止 IDE。只有 IDE 当前激活账号会同步到 Token 文件，IDE 的更改也会反向同步。'
                    }}
                </UiAlert>
                <div class="settings-row">
                    <div>
                        <strong>{{ isEn ? 'Proactive Renewal' : '主动续期' }}</strong>
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? `Renew the IDE token about ${settings.proactiveRenewalLeadMinutes} min before expiry`
                                    : `在 IDE Token 剩约 ${settings.proactiveRenewalLeadMinutes} 分钟时主动续期`
                            }}
                        </p>
                    </div>
                    <UiSwitch
                        :model-value="settings.proactiveRenewalEnabled"
                        :disabled="renewing"
                        :aria-label="isEn ? 'Proactive Renewal' : '主动续期'"
                        data-testid="settings-proactive-renewal"
                        @update:model-value="toggleRenewal"
                    />
                </div>
                <UiAlert v-if="settings.proactiveRenewalEnabled" variant="info">
                    {{
                        isEn
                            ? 'A single timer renews the active IDE account before expiry. Switching accounts reschedules it; if renewal fails, IDE’s own refresh loop remains the fallback.'
                            : '单一定时器会提前续期 IDE 当前激活账号；切号时重新调度，续期失败时由 IDE 自己的刷新循环接管。'
                    }}
                </UiAlert>
                <template v-if="settings.autoRefreshEnabled">
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="isEn ? 'Refresh Interval' : '刷新间隔'"
                        for="settings-refresh-interval"
                    >
                        <UiSelect
                            :model-value="String(settings.autoRefreshInterval)"
                            v-bind="controlAttrs"
                            data-testid="settings-refresh-interval"
                            @update:model-value="settings.setAutoRefresh(true, Number($event))"
                        >
                            <option
                                v-for="minutes in [1, 3, 5, 10, 15, 20, 30, 45, 60]"
                                :key="minutes"
                                :value="String(minutes)"
                            >
                                {{ minutes }} {{ isEn ? 'min' : '分钟' }}
                            </option>
                        </UiSelect>
                    </UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="isEn ? 'Refresh Concurrency' : '刷新并发数'"
                        for="settings-refresh-concurrency"
                    >
                        <UiInput
                            :model-value="String(settings.autoRefreshConcurrency)"
                            v-bind="controlAttrs"
                            type="number"
                            min="1"
                            max="500"
                            data-testid="settings-refresh-concurrency"
                            @update:model-value="
                                settings.setAutoRefreshConcurrency(
                                    Number.parseInt($event, 10) || 50
                                )
                            "
                        />
                    </UiField>
                    <div class="settings-row">
                        <div>
                            <strong>{{ isEn ? 'Sync Account Info' : '同步账户信息' }}</strong>
                            <p class="kam-muted">
                                {{
                                    isEn
                                        ? 'Check usage, subscription and ban status during refresh'
                                        : '刷新时检查用量、订阅和封禁状态'
                                }}
                            </p>
                        </div>
                        <UiSwitch
                            :model-value="settings.autoRefreshSyncInfo"
                            :aria-label="isEn ? 'Sync Account Info' : '同步账户信息'"
                            data-testid="settings-sync-info"
                            @update:model-value="settings.setAutoRefreshSyncInfo($event)"
                        />
                    </div>
                </template></div
        ></UiCard>

        <div class="kam-grid">
            <UiCard
                ><div class="settings-card">
                    <h2 class="ui-card-title">{{ isEn ? 'Usage API' : '用量查询 API' }}</h2>
                    <p v-if="usageLoading" class="kam-muted">
                        {{ isEn ? 'Loading...' : '加载中...' }}
                    </p>
                    <UiField
                        v-else
                        v-slot="{ controlAttrs }"
                        :label="isEn ? 'API Type' : 'API 类型'"
                        for="settings-usage-api"
                    >
                        <UiSelect
                            :model-value="usageApiType"
                            v-bind="controlAttrs"
                            :disabled="usageBusy"
                            data-testid="settings-usage-api"
                            @update:model-value="updateUsageApi"
                        >
                            <option value="rest">REST (GetUsageLimits)</option>
                            <option value="cbor">CBOR (GetUserUsageAndLimits)</option>
                        </UiSelect>
                    </UiField>
                    <div class="settings-row">
                        <div>
                            <strong>{{
                                isEn ? 'Use K-Proxy for API' : 'API 请求走 K-Proxy'
                            }}</strong>
                            <p class="kam-muted">
                                {{
                                    isEn
                                        ? 'Requires K-Proxy MITM to be running'
                                        : '需要 K-Proxy MITM 代理运行'
                                }}
                            </p>
                        </div>
                        <UiSwitch
                            :model-value="kproxy"
                            :disabled="kproxyLoading || kproxyBusy"
                            :aria-label="isEn ? 'Use K-Proxy for API' : 'API 请求走 K-Proxy'"
                            data-testid="settings-kproxy"
                            @update:model-value="updateKproxy"
                        />
                    </div></div
            ></UiCard>
            <UiCard
                ><div class="settings-card">
                    <h2 class="ui-card-title">{{ isEn ? 'Proxy' : '代理设置' }}</h2>
                    <div class="settings-row">
                        <div>
                            <strong>{{ isEn ? 'Enable Proxy' : '启用代理' }}</strong>
                            <p class="kam-muted">
                                {{
                                    isEn
                                        ? 'Route network requests through a proxy'
                                        : '网络请求通过代理服务器'
                                }}
                            </p>
                        </div>
                        <UiSwitch
                            :model-value="settings.proxyEnabled"
                            :disabled="proxyBusy"
                            :aria-label="isEn ? 'Enable Proxy' : '启用代理'"
                            data-testid="settings-proxy-enabled"
                            @update:model-value="updateProxy($event, proxyDraft)"
                        />
                    </div>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="isEn ? 'Proxy URL' : '代理地址'"
                        for="settings-proxy-url"
                    >
                        <UiInput
                            :model-value="proxyDraft"
                            v-bind="controlAttrs"
                            :disabled="proxyBusy"
                            placeholder="http://127.0.0.1:7890"
                            data-testid="settings-proxy-url"
                            @update:model-value="editProxyUrl"
                        />
                    </UiField>
                    <div class="kam-actions">
                        <UiButton
                            :disabled="proxyBusy || !proxyDirty"
                            data-testid="settings-proxy-save"
                            @click="updateProxy(settings.proxyEnabled, proxyDraft)"
                            >{{ isEn ? 'Save URL' : '保存地址' }}</UiButton
                        >
                    </div>
                </div></UiCard
            >
        </div>

        <div class="kam-grid">
            <UiCard
                ><div class="settings-card">
                    <h2 class="ui-card-title">{{ isEn ? 'Auto Switch' : '自动换号' }}</h2>
                    <div class="settings-row">
                        <div>
                            <strong>{{ isEn ? 'Enable Auto Switch' : '启用自动换号' }}</strong>
                            <p class="kam-muted">
                                {{ isEn ? 'Switch when balance is low' : '余额不足时自动切换账号' }}
                            </p>
                        </div>
                        <UiSwitch
                            :model-value="autoSwitch.autoSwitchEnabled"
                            :aria-label="isEn ? 'Enable Auto Switch' : '启用自动换号'"
                            data-testid="settings-auto-switch"
                            @update:model-value="autoSwitch.setAutoSwitch($event)"
                        />
                    </div>
                    <template v-if="autoSwitch.autoSwitchEnabled">
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="isEn ? 'Balance Threshold' : '余额阈值'"
                            for="settings-switch-threshold"
                        >
                            <UiInput
                                :model-value="String(autoSwitch.autoSwitchThreshold)"
                                v-bind="controlAttrs"
                                type="number"
                                min="0"
                                data-testid="settings-switch-threshold"
                                @update:model-value="
                                    autoSwitch.setAutoSwitch(true, Number.parseInt($event, 10) || 0)
                                "
                            />
                        </UiField>
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="isEn ? 'Check Interval' : '检查间隔'"
                            for="settings-switch-interval"
                        >
                            <UiSelect
                                :model-value="String(autoSwitch.autoSwitchInterval)"
                                v-bind="controlAttrs"
                                data-testid="settings-switch-interval"
                                @update:model-value="
                                    autoSwitch.setAutoSwitch(true, undefined, Number($event))
                                "
                            >
                                <option
                                    v-for="minutes in [1, 3, 5, 10, 15, 30]"
                                    :key="minutes"
                                    :value="String(minutes)"
                                >
                                    {{ minutes }} {{ isEn ? 'min' : '分钟' }}
                                </option>
                            </UiSelect>
                        </UiField>
                    </template>
                </div></UiCard
            >
            <UiCard
                ><div class="settings-card">
                    <h2 class="ui-card-title">{{ isEn ? 'Batch Import' : '批量导入' }}</h2>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="isEn ? 'Concurrency' : '并发数'"
                        for="settings-import-concurrency"
                    >
                        <UiInput
                            :model-value="String(settings.batchImportConcurrency)"
                            v-bind="controlAttrs"
                            type="number"
                            min="1"
                            max="500"
                            data-testid="settings-import-concurrency"
                            @update:model-value="
                                settings.setBatchImportConcurrency(
                                    Number.parseInt($event, 10) || 100
                                )
                            "
                        />
                    </UiField>
                    <p class="kam-muted">
                        {{
                            isEn
                                ? 'Recommended: 10–100. High concurrency can trigger API limits.'
                                : '建议 10–100，过高可能触发 API 限流。'
                        }}
                    </p>
                </div></UiCard
            >
        </div>

        <div class="kam-grid">
            <UiCard
                ><div class="settings-card">
                    <h2 class="ui-card-title">{{ isEn ? 'System Tray' : '系统托盘' }}</h2>
                    <p v-if="trayLoading" class="kam-muted">
                        {{ isEn ? 'Loading...' : '加载中...' }}
                    </p>
                    <template v-else>
                        <div class="settings-row">
                            <div>
                                <strong>{{ isEn ? 'Enable System Tray' : '启用系统托盘' }}</strong>
                                <p class="kam-muted">
                                    {{
                                        isEn
                                            ? 'Show app icon in the system tray'
                                            : '在系统托盘显示应用图标'
                                    }}
                                </p>
                            </div>
                            <UiSwitch
                                :model-value="tray.enabled"
                                :disabled="trayBusy"
                                :aria-label="isEn ? 'Enable System Tray' : '启用系统托盘'"
                                data-testid="settings-tray-enabled"
                                @update:model-value="updateTray('enabled', $event)"
                            />
                        </div>
                        <UiField
                            v-if="tray.enabled"
                            v-slot="{ controlAttrs }"
                            :label="isEn ? 'Close Button Action' : '关闭按钮行为'"
                            for="settings-tray-close"
                        >
                            <UiSelect
                                :model-value="tray.closeAction"
                                v-bind="controlAttrs"
                                :disabled="trayBusy"
                                data-testid="settings-tray-close"
                                @update:model-value="updateTray('closeAction', $event)"
                            >
                                <option value="ask">
                                    {{ isEn ? 'Ask every time' : '每次询问' }}
                                </option>
                                <option value="minimize">
                                    {{ isEn ? 'Minimize to tray' : '最小化到托盘' }}
                                </option>
                                <option value="quit">
                                    {{ isEn ? 'Quit application' : '退出程序' }}
                                </option>
                            </UiSelect>
                        </UiField>
                    </template>
                </div></UiCard
            >
            <UiCard
                ><div class="settings-card">
                    <h2 class="ui-card-title">{{ isEn ? 'Keyboard Shortcut' : '快捷键' }}</h2>
                    <p v-if="shortcutLoading" class="kam-muted">
                        {{ isEn ? 'Loading...' : '加载中...' }}
                    </p>
                    <template v-else>
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="isEn ? 'Show Main Window' : '显示主窗口'"
                            for="settings-shortcut"
                        >
                            <div class="settings-input-action">
                                <UiInput
                                    :model-value="
                                        recordingShortcut
                                            ? isEn
                                                ? 'Press keys...'
                                                : '请按键...'
                                            : shortcut
                                    "
                                    v-bind="controlAttrs"
                                    readonly
                                    :disabled="shortcutBusy"
                                    :placeholder="isEn ? 'Click to record' : '点击录制'"
                                    data-testid="settings-shortcut"
                                    @focus="recordingShortcut = true"
                                    @blur="recordingShortcut = false"
                                    @keydown="recordShortcut"
                                />
                                <UiButton
                                    icon
                                    :disabled="shortcutBusy || !shortcut"
                                    :aria-label="isEn ? 'Clear shortcut' : '清除快捷键'"
                                    data-testid="settings-shortcut-clear"
                                    @click="updateShortcut('')"
                                    ><Trash2 :size="16"
                                /></UiButton>
                            </div>
                        </UiField>
                        <UiAlert
                            v-if="shortcutError"
                            tone="error"
                            data-testid="settings-shortcut-error"
                            >{{ shortcutError }}</UiAlert
                        >
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? 'Click the field and press a key combination; modifier keys alone are ignored.'
                                    : '点击输入框并按下组合键；单独的修饰键将被忽略。'
                            }}
                        </p>
                    </template>
                </div></UiCard
            >
        </div>

        <UiCard
            ><div class="settings-card">
                <h2 class="ui-card-title">{{ isEn ? 'Machine ID' : '机器码管理' }}</h2>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Manage device identifier and account binding in the Machine ID sidebar page.'
                            : '请在侧边栏「机器码」中管理设备标识符和账户绑定。'
                    }}
                </p>
            </div></UiCard
        >

        <UiCard
            ><div class="settings-card">
                <h2 class="ui-card-title">{{ isEn ? 'Data Management' : '数据管理' }}</h2>
                <div class="settings-row">
                    <div>
                        <strong>{{ isEn ? 'Export Data' : '导出数据' }}</strong>
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? 'JSON, OIDC, card key, TXT, CSV or clipboard'
                                    : 'JSON、OIDC、卡密、TXT、CSV 或剪贴板'
                            }}
                        </p>
                    </div>
                    <UiButton data-testid="settings-export" @click="exportOpen = true"
                        ><Download :size="16" />{{ isEn ? 'Export' : '导出' }}</UiButton
                    >
                </div>
                <div class="settings-row">
                    <div>
                        <strong>{{ isEn ? 'Import Data' : '导入数据' }}</strong>
                        <p class="kam-muted">
                            {{ isEn ? 'Import accounts from a JSON file' : '从 JSON 文件导入账号' }}
                        </p>
                    </div>
                    <UiButton
                        :loading="importing"
                        :disabled="clearing"
                        data-testid="settings-import"
                        @click="importAccounts"
                        ><Upload :size="16" />{{ isEn ? 'Import' : '导入' }}</UiButton
                    >
                </div>
                <div class="settings-row">
                    <div>
                        <strong>{{ isEn ? 'Clear All Data' : '清除所有数据' }}</strong>
                        <p class="kam-muted">
                            {{
                                isEn
                                    ? 'Delete accounts after two confirmations'
                                    : '两次确认后删除所有账号'
                            }}
                        </p>
                    </div>
                    <UiButton
                        variant="danger"
                        :loading="clearing"
                        :disabled="importing"
                        data-testid="settings-clear"
                        @click="clearAccounts"
                        ><Trash2 :size="16" />{{ isEn ? 'Clear' : '清除' }}</UiButton
                    >
                </div>
            </div></UiCard
        >

        <LegacyConfigSyncCard />
        <ExportDialog
            :open="exportOpen"
            :accounts="accountList"
            :selected-count="0"
            @update:open="exportOpen = $event"
        />
    </div>
</template>

<style scoped>
.settings-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.settings-card h2 {
    margin: 0;
}
.settings-row,
.settings-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
}
.settings-row > div:first-child {
    min-width: 0;
    flex: 1;
}
.settings-input-action {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.settings-input-action :deep(.ui-input) {
    flex: 1;
    min-width: 0;
}
.settings-card :deep(.ui-field) {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
}
.settings-card :deep(.ui-input),
.settings-card :deep(.ui-select) {
    width: 100%;
}
</style>
