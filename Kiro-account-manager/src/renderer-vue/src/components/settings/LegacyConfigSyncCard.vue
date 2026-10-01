<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { UiAlert, UiButton, UiCard, confirmDialog } from '@lingyzh/ui'
import { Download, Upload } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { usePersistenceStore } from '../../stores/persistence'
import { useProxyPoolStore } from '../../stores/proxyPool'
import { toIpcData } from '../../lib/ipcData'

const keys = [
    'kiro-register-config',
    'kiro-register-history',
    'kiro-register-templates',
    'kiro-register-ratelimit-enabled',
    'kiro-register-ratelimit-max',
    'kiro-register-autobackoff',
    'kiro-register-dailyquota-limit',
    'kiro-register-schedule-enabled',
    'kiro-register-schedule-time',
    'kiro-register-mixed-sources',
    'kiro-webhooks',
    'accounts_viewMode',
    'accounts_activeGroupTab',
    'systemLogs_displayLimit',
    'kiro-diagnose-moemail',
    'proxyLogs_timeRange',
    'proxyLogs_displayLimit'
]
const { t } = useTranslation()
const isEn = computed(() => t('common.unknown') === 'Unknown')
const proxyPool = useProxyPoolStore()
const persistence = usePersistenceStore()
const busy = ref(false)
const error = ref('')
const success = ref('')
let active = true

function exportConfig() {
    if (!active || busy.value) return
    error.value = ''
    success.value = ''
    try {
        const localData = {}
        for (const key of keys) {
            const value = localStorage.getItem(key)
            if (value != null) localData[key] = value
        }
        const payload = toIpcData({
            version: 1,
            type: 'kiro-account-manager-config',
            exportedAt: Date.now(),
            proxyPool: Object.fromEntries(proxyPool.proxyPool),
            proxyPoolConfig: proxyPool.proxyPoolConfig,
            localStorage: localData
        })
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `kiro-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        anchor.click()
        URL.revokeObjectURL(url)
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
}

async function importConfig() {
    if (!active || busy.value) return
    busy.value = true
    error.value = ''
    success.value = ''
    try {
        const fileData = await window.api.importFromFile()
        if (!active) return
        if (!fileData) return
        if (fileData.format !== 'json')
            throw new Error(isEn.value ? 'Please select a JSON file' : '请选择 JSON 文件')
        const payload = JSON.parse(fileData.content)
        if (payload?.type !== 'kiro-account-manager-config') {
            throw new Error(isEn.value ? 'Not a valid config file' : '不是有效的配置文件')
        }
        const confirmed = await confirmDialog({
            title: isEn.value ? 'Import configuration?' : '导入配置？',
            message: isEn.value
                ? 'This will overwrite proxy pool, webhooks and templates. Continue?'
                : '这将覆盖代理池、Webhook 和模板等配置，确定继续？',
            confirmText: isEn.value ? 'Import' : '导入',
            cancelText: isEn.value ? 'Cancel' : '取消',
            tone: 'danger'
        })
        if (!active || !confirmed) return
        if (payload.localStorage && typeof payload.localStorage === 'object') {
            for (const [key, value] of Object.entries(payload.localStorage)) {
                if (keys.includes(key) && typeof value === 'string') {
                    try {
                        localStorage.setItem(key, value)
                    } catch {
                        // The original import ignores individual localStorage failures.
                    }
                }
            }
        }
        if (
            payload.proxyPool &&
            typeof payload.proxyPool === 'object' &&
            !Array.isArray(payload.proxyPool)
        ) {
            proxyPool.clearProxyPool()
            proxyPool.$patch((state) => {
                state.proxyPool = new Map(Object.entries(payload.proxyPool))
            })
            persistence.saveToStorage()
        }
        if (payload.proxyPoolConfig) proxyPool.setProxyPoolConfig(payload.proxyPoolConfig)
        success.value = isEn.value
            ? 'Config imported. Please restart the app to fully apply.'
            : '配置已导入。建议重启应用以完全生效。'
    } catch (cause) {
        if (active) error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
        if (active) busy.value = false
    }
}

onBeforeUnmount(() => {
    active = false
})
</script>

<template>
    <UiCard>
        <div class="settings-card">
            <h2 class="ui-card-title">{{ isEn ? 'Configuration Sync' : '配置同步' }}</h2>
            <p class="kam-muted">
                {{
                    isEn
                        ? 'Export proxy pool, webhooks, templates, rate limits and UI preferences. Account tokens and credentials are excluded.'
                        : '导出代理池、Webhook、模板、限速和界面偏好；不含账号 Token 和凭据。'
                }}
            </p>
            <UiAlert v-if="error" tone="error">{{ error }}</UiAlert>
            <UiAlert v-if="success" tone="success">{{ success }}</UiAlert>
            <div class="kam-actions">
                <UiButton
                    data-testid="settings-config-export"
                    :disabled="busy"
                    @click="exportConfig"
                >
                    <Download :size="16" /> {{ isEn ? 'Export Config' : '导出配置' }}
                </UiButton>
                <UiButton
                    data-testid="settings-config-import"
                    :loading="busy"
                    @click="importConfig"
                >
                    <Upload :size="16" /> {{ isEn ? 'Import Config' : '导入配置' }}
                </UiButton>
            </div>
        </div>
    </UiCard>
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
</style>
