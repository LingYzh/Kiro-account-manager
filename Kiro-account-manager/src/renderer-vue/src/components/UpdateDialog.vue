<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { UiAlert, UiButton, UiDialog, UiMarkdown, UiProgress } from '@lingyzh/ui'
import { Download, RefreshCw } from 'lucide-vue-next'
import { useTranslation } from '../composables/useTranslation'

const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const open = ref(false)
const status = ref('idle')
const updateInfo = ref(null)
const progress = ref(null)
const error = ref('')
const downloading = ref(false)
const installing = ref(false)
const releaseNotes = computed(() => {
    const value = updateInfo.value?.releaseNotes
    return typeof value === 'string' ? value : ''
})
let active = false
let generation = 0
const subscriptions = []

function text(zh, en) {
    return isEn.value ? en : zh
}

function errorMessage(cause) {
    return cause instanceof Error ? cause.message : String(cause)
}

function handleOpen(value) {
    if (value || status.value !== 'downloading') open.value = value
}

function download() {
    if (!active || downloading.value || status.value !== 'available') return
    const current = generation
    downloading.value = true
    status.value = 'downloading'
    progress.value = null
    error.value = ''
    Promise.resolve()
        .then(() => (active && current === generation ? window.api.downloadUpdate() : null))
        .then((result) => {
            if (!active || current !== generation || !result || result.success) return
            if (status.value === 'downloading') {
                error.value = result.error || text('下载失败', 'Download failed')
                status.value = 'error'
            }
        })
        .catch((cause) => {
            if (!active || current !== generation) return
            error.value = errorMessage(cause)
            status.value = 'error'
        })
        .finally(() => {
            if (active && current === generation) downloading.value = false
        })
}

function install() {
    if (!active || installing.value || status.value !== 'downloaded') return
    const current = generation
    installing.value = true
    Promise.resolve()
        .then(() => (active && current === generation ? window.api.installUpdate() : null))
        .catch((cause) => {
            if (!active || current !== generation) return
            installing.value = false
            error.value = errorMessage(cause)
            status.value = 'error'
        })
}

function openLink(url) {
    Promise.resolve()
        .then(() => (active ? window.api.openExternal(url) : undefined))
        .catch((cause) => {
            if (active) error.value = errorMessage(cause)
        })
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

onMounted(() => {
    active = true
    generation += 1
    subscriptions.push(
        window.api.onUpdateChecking(() => {
            if (!active) return
            status.value = 'checking'
        }),
        window.api.onUpdateAvailable((info) => {
            if (!active) return
            updateInfo.value = info
            progress.value = null
            error.value = ''
            installing.value = false
            status.value = 'available'
            open.value = true
        }),
        window.api.onUpdateNotAvailable(() => {
            if (!active) return
            status.value = 'idle'
        }),
        window.api.onUpdateDownloadProgress((value) => {
            if (!active) return
            progress.value = value
            status.value = 'downloading'
        }),
        window.api.onUpdateDownloaded((info) => {
            if (!active) return
            updateInfo.value = info
            status.value = 'downloaded'
        }),
        window.api.onUpdateError((message) => {
            if (!active) return
            installing.value = false
            error.value = message
            status.value = 'error'
        })
    )
})

onBeforeUnmount(() => {
    active = false
    generation += 1
    for (const unsubscribe of subscriptions) unsubscribe()
    subscriptions.length = 0
})
</script>

<template>
    <UiDialog
        :open="open"
        size="md"
        scrollable
        :aria-label="text('应用更新', 'App update')"
        :content-label="text('更新信息', 'Update information')"
        data-testid="update-dialog"
        @update:open="handleOpen"
    >
        <template #header>
            <h2 class="ui-card-title">{{ text('发现新版本', 'New version available') }}</h2>
            <p v-if="updateInfo" class="kam-muted">v{{ updateInfo.version }}</p>
        </template>
        <div class="kam-dialog-content">
            <UiAlert
                v-if="error"
                tone="error"
                :title="text('更新失败', 'Update failed')"
                data-testid="update-error"
                >{{ error }}</UiAlert
            >
            <template v-if="status === 'available'">
                <p class="kam-muted">
                    {{
                        text(
                            '新版本已发布，建议更新以获得最新功能和修复。',
                            'Update for the latest features and fixes.'
                        )
                    }}
                </p>
                <UiMarkdown v-if="releaseNotes" :source="releaseNotes" @link-click="openLink" />
            </template>
            <template v-if="status === 'downloading'">
                <p>
                    {{ text('正在下载更新…', 'Downloading update…') }}
                    <span class="kam-mono">{{
                        progress ? `${progress.percent.toFixed(1)}%` : '0%'
                    }}</span>
                </p>
                <UiProgress
                    :value="progress?.percent || 0"
                    :label="text('更新下载进度', 'Update download progress')"
                    data-testid="update-progress"
                />
                <p v-if="progress" class="kam-muted kam-mono">
                    {{ formatBytes(progress.transferred) }} / {{ formatBytes(progress.total) }} ·
                    {{ formatBytes(progress.bytesPerSecond) }}/s
                </p>
                <p class="kam-muted">{{ text('请勿关闭应用。', 'Keep the app open.') }}</p>
            </template>
            <template v-if="status === 'downloaded'">
                <UiAlert tone="success" :title="text('下载完成', 'Download complete')" />
                <p class="kam-muted">
                    {{ text('重启应用以完成安装。', 'Restart the app to complete installation.') }}
                </p>
            </template>
        </div>
        <template #footer>
            <div class="kam-actions">
                <UiButton
                    v-if="status !== 'downloading'"
                    :disabled="installing"
                    data-testid="update-close"
                    @click="handleOpen(false)"
                    >{{ text('稍后', 'Later') }}</UiButton
                >
                <UiButton
                    v-if="status === 'available'"
                    variant="primary"
                    :loading="downloading"
                    data-testid="update-download"
                    @click="download"
                    ><Download :size="16" />{{ text('立即下载', 'Download now') }}</UiButton
                >
                <UiButton
                    v-if="status === 'downloaded'"
                    variant="primary"
                    :loading="installing"
                    data-testid="update-install"
                    @click="install"
                    ><RefreshCw :size="16" />{{ text('立即重启', 'Restart now') }}</UiButton
                >
            </div>
        </template>
    </UiDialog>
</template>
