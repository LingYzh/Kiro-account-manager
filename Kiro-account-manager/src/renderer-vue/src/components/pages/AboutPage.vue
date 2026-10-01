<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { UiAlert, UiBadge, UiButton, UiCard, UiDialog } from '@lingyzh/ui'
import { Check, ExternalLink, Github, Heart, RefreshCw } from 'lucide-vue-next'
import kiroLogo from '@shared/assets/kam-logo.png'
import authorAvatar from '@shared/assets/author-avatar.png'
import { useTranslation } from '../../composables/useTranslation'

const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const version = ref('...')
const showUpdateDialog = ref(false)
const isCheckingUpdate = ref(false)
const updateInfo = ref(null)
const versionError = ref('')
const externalError = ref('')
let mounted = false
let checkGeneration = 0

const features = [
    {
        zh: '多账号管理',
        en: 'Multi-Account',
        detailZh: '支持添加、编辑、删除多个 Kiro 账号',
        detailEn: 'Add, edit, delete multiple accounts'
    },
    {
        zh: '一键切换',
        en: 'One-Click Switch',
        detailZh: '快速切换当前使用的账号',
        detailEn: 'Quick account switching'
    },
    {
        zh: '自动刷新',
        en: 'Auto Refresh',
        detailZh: 'Token 过期前自动刷新，保持登录状态',
        detailEn: 'Auto refresh tokens before expiry'
    },
    {
        zh: '分组与标签',
        en: 'Groups & Tags',
        detailZh: '多选账户批量设置分组/标签，支持多标签',
        detailEn: 'Batch set groups/tags'
    },
    {
        zh: '隐私模式',
        en: 'Privacy Mode',
        detailZh: '隐藏邮箱和账号敏感信息',
        detailEn: 'Hide sensitive info'
    },
    {
        zh: '批量导入',
        en: 'Batch Import',
        detailZh: '支持 SSO Token 和 OIDC 凭证批量导入',
        detailEn: 'SSO Token & OIDC batch import'
    },
    {
        zh: '机器码管理',
        en: 'Machine ID',
        detailZh: '修改设备标识符，防止账号关联封禁',
        detailEn: 'Modify device identifier'
    },
    {
        zh: '自动换机器码',
        en: 'Auto Switch ID',
        detailZh: '切换账号时自动更换机器码',
        detailEn: 'Auto change ID on switch'
    },
    {
        zh: '账户机器码绑定',
        en: 'ID Binding',
        detailZh: '为每个账户分配唯一机器码',
        detailEn: 'Unique ID per account'
    },
    {
        zh: '自动换号',
        en: 'Auto Switch',
        detailZh: '余额不足时自动切换可用账号',
        detailEn: 'Switch when balance low'
    },
    {
        zh: '代理支持',
        en: 'Proxy Support',
        detailZh: '支持 HTTP/HTTPS/SOCKS5 代理',
        detailEn: 'HTTP/HTTPS/SOCKS5'
    },
    {
        zh: '主题定制',
        en: 'Themes',
        detailZh: '支持深色/浅色模式',
        detailEn: 'Dark and light modes'
    }
]
const techStack = ['Electron', 'Vue 3', 'Pinia', 'TypeScript', '@lingyzh/ui', 'Vite']

function text(zh, en) {
    return isEn.value ? en : zh
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error)
}

function checkForUpdates() {
    if (isCheckingUpdate.value) return
    isCheckingUpdate.value = true
    const generation = ++checkGeneration
    Promise.resolve()
        .then(() => window.api.checkForUpdatesManual())
        .then((result) => {
            if (!mounted || generation !== checkGeneration) return
            updateInfo.value = result
            showUpdateDialog.value = true
        })
        .catch((error) => {
            if (!mounted || generation !== checkGeneration) return
            updateInfo.value = { hasUpdate: false, error: errorMessage(error) }
            showUpdateDialog.value = true
        })
        .finally(() => {
            if (mounted && generation === checkGeneration) isCheckingUpdate.value = false
        })
}

function openExternal(url) {
    if (!url) return
    externalError.value = ''
    Promise.resolve()
        .then(() => window.api.openExternal(url))
        .catch((error) => {
            if (mounted) externalError.value = errorMessage(error)
        })
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatReleaseDate(value) {
    const date = new Date(value)
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString(isEn.value ? 'en-US' : 'zh-CN')
}

onMounted(() => {
    mounted = true
    Promise.resolve()
        .then(() => window.api.getAppVersion())
        .then((result) => {
            if (!mounted) return
            version.value = result
            versionError.value = ''
        })
        .catch((error) => {
            if (mounted) versionError.value = errorMessage(error)
        })
})

onBeforeUnmount(() => {
    mounted = false
    checkGeneration += 1
})
</script>

<template>
    <section class="kam-page" data-testid="page-about">
        <header class="kam-page-header about-header">
            <img class="about-logo" :src="kiroLogo" alt="Kiro" />
            <div class="about-heading">
                <h1 class="text-title">{{ text('Kiro 账户管理器', 'Kiro Account Manager') }}</h1>
                <p class="kam-muted">
                    {{ text('版本', 'Version') }} <span class="kam-mono">{{ version }}</span>
                </p>
            </div>
            <div class="kam-actions about-header-actions">
                <UiButton
                    size="sm"
                    :loading="isCheckingUpdate"
                    data-testid="about-check-updates"
                    @click="checkForUpdates"
                >
                    <RefreshCw :size="16" aria-hidden="true" />
                    {{
                        isCheckingUpdate
                            ? text('检查中...', 'Checking...')
                            : text('检查更新', 'Check Updates')
                    }}
                </UiButton>
            </div>
        </header>

        <UiAlert
            v-if="versionError"
            tone="error"
            :title="text('读取应用版本失败', 'Could not read app version')"
            data-testid="about-version-error"
            >{{ versionError }}</UiAlert
        >
        <UiAlert
            v-if="externalError"
            tone="error"
            :title="text('打开页面失败', 'Could not open page')"
            data-testid="about-external-error"
            >{{ externalError }}</UiAlert
        >

        <UiButton
            v-if="updateInfo?.hasUpdate && !showUpdateDialog"
            class="about-update-notice"
            variant="ghost"
            size="sm"
            data-testid="about-update-notice"
            @click="showUpdateDialog = true"
        >
            {{
                text(
                    `发现新版本 v${updateInfo.latestVersion}`,
                    `New version v${updateInfo.latestVersion}`
                )
            }}
        </UiButton>

        <div class="kam-grid">
            <UiCard :title="text('关于本应用', 'About')" density="compact" class="about-intro">
                <p class="kam-muted">
                    {{
                        text(
                            'Kiro 账户管理器是一个功能强大的 Kiro IDE 多账号管理工具。支持多账号快速切换、自动 Token 刷新、分组标签管理、机器码管理等功能，帮助你高效管理和使用多个 Kiro 账号。',
                            'Kiro Account Manager is a multi-account management tool for Kiro IDE. It supports quick account switching, automatic token refresh, group and tag management, and machine ID management.'
                        )
                    }}
                </p>
                <p class="kam-muted">
                    {{
                        text(
                            '本应用基于 Electron + Vue 3 + Pinia，支持 Windows、macOS 和 Linux 平台。所有数据均存储在本地，保护你的隐私安全。',
                            'The app uses Electron + Vue 3 + Pinia and supports Windows, macOS and Linux. All data is stored locally to protect your privacy.'
                        )
                    }}
                </p>
            </UiCard>

            <UiCard :title="text('技术栈', 'Tech Stack')" density="compact">
                <div class="about-tech-list">
                    <UiBadge v-for="tech in techStack" :key="tech" dense>{{ tech }}</UiBadge>
                </div>
            </UiCard>

            <UiCard :title="text('主要功能', 'Features')" density="compact" class="about-features">
                <ul class="about-feature-list">
                    <li v-for="feature in features" :key="feature.en">
                        <Check :size="16" aria-hidden="true" />
                        <span
                            ><strong>{{ isEn ? feature.en : feature.zh }}</strong
                            >{{ isEn ? `: ${feature.detailEn}` : `：${feature.detailZh}` }}</span
                        >
                    </li>
                </ul>
            </UiCard>

            <UiCard :title="text('上游原作者', 'Original Upstream Author')" density="compact">
                <div class="about-author">
                    <img :src="authorAvatar" alt="chaogei666" class="about-avatar" />
                    <span>chaogei666</span>
                    <UiButton
                        size="sm"
                        class="about-author-link"
                        data-testid="about-author-link"
                        @click="openExternal('https://github.com/chaogei/Kiro-account-manager')"
                    >
                        <Github :size="16" aria-hidden="true" />
                        GitHub
                        <ExternalLink :size="14" aria-hidden="true" />
                    </UiButton>
                </div>
            </UiCard>
        </div>

        <footer class="about-footer kam-muted">
            Made with <Heart :size="14" aria-hidden="true" /> for Kiro users
        </footer>

        <UiDialog
            v-model:open="showUpdateDialog"
            size="md"
            scrollable
            :content-label="text('更新信息', 'Update information')"
            :aria-label="text('更新信息', 'Update information')"
            data-testid="about-update-dialog"
        >
            <template #header>
                <h2 class="text-title">
                    {{
                        updateInfo?.hasUpdate
                            ? text('发现新版本', 'New Version Available')
                            : updateInfo?.error
                              ? text('检查更新失败', 'Check Failed')
                              : text('已是最新版本', 'Up to Date')
                    }}
                </h2>
            </template>
            <div v-if="updateInfo" class="kam-dialog-content">
                <template v-if="updateInfo.hasUpdate">
                    <p class="kam-muted kam-mono">
                        {{ updateInfo.currentVersion }} → {{ updateInfo.latestVersion }}
                    </p>
                    <div
                        v-if="updateInfo.releaseName || updateInfo.publishedAt"
                        class="about-release-meta"
                    >
                        <strong v-if="updateInfo.releaseName">{{ updateInfo.releaseName }}</strong>
                        <span v-if="updateInfo.publishedAt" class="kam-muted"
                            >{{ text('发布时间', 'Released') }}:
                            {{ formatReleaseDate(updateInfo.publishedAt) }}</span
                        >
                    </div>
                    <div v-if="updateInfo.releaseNotes">
                        <h3>{{ text('更新内容', 'Release Notes') }}</h3>
                        <p class="about-release-notes kam-muted">{{ updateInfo.releaseNotes }}</p>
                    </div>
                    <div v-if="updateInfo.assets?.length">
                        <h3>{{ text('下载文件', 'Download Files') }}</h3>
                        <ul class="about-assets">
                            <li
                                v-for="(asset, index) in updateInfo.assets.slice(0, 6)"
                                :key="`${asset.name}-${index}`"
                            >
                                <span :title="asset.name">{{ asset.name }}</span>
                                <span class="kam-muted kam-mono">{{
                                    formatFileSize(asset.size)
                                }}</span>
                            </li>
                        </ul>
                        <p v-if="updateInfo.assets.length > 6" class="kam-muted">
                            {{
                                text(
                                    `还有 ${updateInfo.assets.length - 6} 个文件...`,
                                    `${updateInfo.assets.length - 6} more files...`
                                )
                            }}
                        </p>
                    </div>
                </template>
                <UiAlert
                    v-else-if="updateInfo.error"
                    tone="error"
                    :title="text('检查更新失败', 'Check Failed')"
                    >{{ updateInfo.error }}</UiAlert
                >
                <UiAlert v-else tone="success" :title="text('已是最新版本', 'Up to Date')">
                    {{
                        text(
                            `当前版本 v${updateInfo.currentVersion || version} 已经是最新的了`,
                            `Version v${updateInfo.currentVersion || version} is the latest`
                        )
                    }}
                </UiAlert>
            </div>
            <template #footer>
                <UiButton
                    v-if="updateInfo?.hasUpdate && updateInfo.releaseUrl"
                    data-testid="about-release-link"
                    @click="openExternal(updateInfo.releaseUrl)"
                >
                    <ExternalLink :size="16" aria-hidden="true" />
                    {{ text('前往下载页面', 'Go to Download Page') }}
                </UiButton>
                <UiButton
                    v-if="updateInfo?.error"
                    :loading="isCheckingUpdate"
                    data-testid="about-retry-update"
                    @click="checkForUpdates"
                >
                    {{ text('重试', 'Retry') }}
                </UiButton>
                <UiButton
                    variant="ghost"
                    data-testid="about-close-update"
                    @click="showUpdateDialog = false"
                    >{{ text('关闭', 'Close') }}</UiButton
                >
            </template>
        </UiDialog>
    </section>
</template>

<style scoped>
.about-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
}
.about-logo {
    width: 64px;
    height: 64px;
    object-fit: contain;
}
.about-heading {
    flex: 1 1 220px;
}
.about-heading p {
    margin-top: 4px;
}
.about-header-actions {
    margin-left: auto;
}
.about-update-notice {
    align-self: flex-start;
}
.about-intro p + p {
    margin-top: 12px;
}
.about-features {
    grid-row: span 2;
}
.about-feature-list {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
}
.about-feature-list li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--muted);
}
.about-feature-list svg {
    flex: 0 0 auto;
    margin-top: 2px;
    color: var(--accent-text);
}
.about-feature-list strong {
    color: var(--text);
}
.about-tech-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.about-author {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
}
.about-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
}
.about-author-link {
    margin-left: auto;
}
.about-footer {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 4px;
    font-size: 12px;
}
.about-footer svg {
    color: var(--accent-text);
}
.about-release-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.about-release-notes {
    max-height: 160px;
    margin-top: 8px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.about-assets {
    display: grid;
    gap: 6px;
    max-height: 160px;
    margin: 8px 0 0;
    padding: 0;
    overflow: auto;
    list-style: none;
}
.about-assets li {
    display: flex;
    justify-content: space-between;
    gap: 16px;
}
.about-assets li span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.about-assets li span:last-child {
    flex: 0 0 auto;
}
@media (max-width: 760px) {
    .about-features {
        grid-row: auto;
    }
    .about-header-actions {
        margin-left: 0;
    }
}
</style>
