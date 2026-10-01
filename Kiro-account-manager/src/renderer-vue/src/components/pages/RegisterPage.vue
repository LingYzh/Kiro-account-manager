<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiCheckbox,
    UiCopyButton,
    UiDialog,
    UiField,
    UiInput,
    UiProgress,
    UiSelect,
    UiTextarea,
    confirmDialog
} from '@lingyzh/ui'
import {
    Activity,
    Download,
    Pause,
    Play,
    RefreshCw,
    RotateCcw,
    Square,
    Trash2,
    Upload,
    UserPlus
} from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { useRegistration } from '../../composables/useRegistration'
import { STEP_LABELS, classifyError, diagnoseRegError } from '../../lib/registration'

const state = reactive(useRegistration())
const { t, actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const modeOptions = computed(() => [
    { value: 'manual', label: isEn.value ? 'Manual' : '手动注册' },
    { value: 'outlook', label: 'Outlook' },
    { value: 'tempmail', label: 'TempMail.Plus' },
    { value: 'proton', label: 'Proton' },
    { value: 'gptmail', label: 'GPTmail' },
    { value: 'mixed', label: isEn.value ? 'Mixed sources' : '混合邮箱源' }
])
const sourceOptions = [
    { value: 'outlook', label: 'Outlook' },
    { value: 'tempmail', label: 'TempMail.Plus' },
    { value: 'proton', label: 'Proton' },
    { value: 'gptmail', label: 'GPTmail' }
]
const planOptions = [
    { value: 'Q_DEVELOPER_STANDALONE_PRO', label: 'Pro' },
    { value: 'Q_DEVELOPER_STANDALONE_PRO_PLUS', label: 'Pro Plus' },
    { value: 'Q_DEVELOPER_STANDALONE_POWER', label: 'Power' }
]
const showHistory = ref(false)
const showTemplates = ref(false)
const showBlacklist = ref(false)
const showAnalytics = ref(false)
const templateName = ref('')
const templateFile = ref(null)
const logArea = ref(null)
const autoFollow = ref(true)
const clock = ref(Date.now())
const weekdayLabels = computed(() =>
    isEn.value
        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        : ['日', '一', '二', '三', '四', '五', '六']
)
const isFlowBusy = computed(() =>
    [
        'initializing',
        'email',
        'otp',
        'running',
        'importing',
        'fetching-link',
        'cancelling'
    ].includes(state.phase)
)
const canStart = computed(
    () =>
        !isFlowBusy.value &&
        !state.batchRunning &&
        !state.cancelling &&
        !state.importBusy &&
        state.historyImportBusy.size === 0
)
const sourceReady = computed(() => {
    const mode = state.config.mode
    if (mode === 'manual') return true
    if (mode === 'outlook') return Boolean(state.config.outlookData.trim())
    if (mode === 'tempmail')
        return Boolean(
            state.config.tempMailEmail.trim() &&
            state.config.tempMailEpin.trim() &&
            state.config.tempMailDomain.trim()
        )
    if (mode === 'proton') return Boolean(state.config.protonBaseEmail.trim())
    if (mode === 'gptmail') return Boolean(state.config.gptMailDomain.trim())
    return state.config.mixedEnabledSources.some((source) => {
        if (source === 'outlook') return Boolean(state.config.outlookData.trim())
        if (source === 'tempmail')
            return Boolean(
                state.config.tempMailEmail.trim() &&
                state.config.tempMailEpin.trim() &&
                state.config.tempMailDomain.trim()
            )
        if (source === 'proton') return Boolean(state.config.protonBaseEmail.trim())
        return source === 'gptmail' && Boolean(state.config.gptMailDomain.trim())
    })
})
const failedItems = computed(() =>
    state.batchItems.filter((item) => ['failed', 'import_failed'].includes(item.status))
)
const analytics = computed(() => {
    const entries = state.history
    const now = Date.now()
    const sevenDays = []
    const byDay = {}
    const byHour = {}
    const byProvider = {}
    const errors = {}
    for (let offset = 6; offset >= 0; offset--) {
        const date = new Date(now - offset * 86400000)
        const key = `${date.getMonth() + 1}/${date.getDate()}`
        sevenDays.push(key)
        byDay[key] = { success: 0, failed: 0 }
    }
    let success = 0
    let failed = 0
    for (const item of entries) {
        const outcome = item.status === 'success' ? 'success' : 'failed'
        if (outcome === 'success') success++
        else failed++
        const provider = item.result?.provider || 'BuilderId'
        byProvider[provider] ||= { success: 0, failed: 0 }
        byProvider[provider][outcome]++
        const date = new Date(item.time)
        const day = `${date.getMonth() + 1}/${date.getDate()}`
        if (byDay[day]) byDay[day][outcome]++
        const hour = date.getHours()
        byHour[hour] ||= { success: 0, failed: 0 }
        byHour[hour][outcome]++
        if (outcome === 'failed') {
            const category = classifyError(item.error)
            errors[category] = (errors[category] || 0) + 1
        }
    }
    const peakHours = Object.entries(byHour)
        .filter(([, value]) => value.success + value.failed >= 2)
        .sort(
            (a, b) =>
                b[1].success / (b[1].success + b[1].failed) -
                a[1].success / (a[1].success + a[1].failed)
        )
        .slice(0, 3)
    return {
        total: entries.length,
        success,
        failed,
        rate: entries.length ? Math.round((success / entries.length) * 100) : 0,
        sevenDays,
        byDay,
        byHour,
        byProvider,
        errors,
        peakHours
    }
})

let active = true
const clockTimer = setInterval(() => {
    clock.value = Date.now()
}, 1000)
onBeforeUnmount(() => {
    active = false
    clearInterval(clockTimer)
})
watch(
    () => state.logs.length,
    async () => {
        if (!autoFollow.value) return
        await nextTick()
        if (logArea.value) logArea.value.scrollTop = logArea.value.scrollHeight
    }
)

function label(zh, en) {
    return isEn.value ? en : zh
}

function toggleMixedSource(source, enabled) {
    const next = new Set(state.config.mixedEnabledSources)
    if (enabled) next.add(source)
    else next.delete(source)
    state.config.mixedEnabledSources = sourceOptions
        .map((item) => item.value)
        .filter((item) => next.has(item))
}

function toggleWeekday(day, enabled) {
    state.scheduleWeekMask = enabled
        ? state.scheduleWeekMask | (1 << day)
        : state.scheduleWeekMask & ~(1 << day)
}

function itemElapsed(item) {
    if (!item.startedAt) return '—'
    const end = ['running', 'retrying'].includes(item.status)
        ? clock.value
        : item.stepStartedAt || clock.value
    const milliseconds = Math.max(0, end - item.startedAt)
    if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)}s`
    return `${Math.floor(milliseconds / 60000)}m${String(Math.floor((milliseconds % 60000) / 1000)).padStart(2, '0')}s`
}

function statusLabel(status) {
    const labels = {
        pending: label('等待', 'Pending'),
        running: label('运行中', 'Running'),
        retrying: label('重试中', 'Retrying'),
        success: label('成功', 'Success'),
        failed: label('失败', 'Failed'),
        imported: label('已导入', 'Imported'),
        import_failed: label('导入失败', 'Import failed')
    }
    return labels[status] || status
}

function saveTemplate() {
    state.saveTemplate(templateName.value)
    templateName.value = ''
}

async function deleteTemplate(template) {
    const confirmed = await confirmDialog({
        title: label('删除模板', 'Delete template'),
        message: template.name,
        confirmText: label('删除', 'Delete'),
        cancelText: label('取消', 'Cancel'),
        tone: 'danger'
    })
    if (active && confirmed) state.deleteTemplate(template.id)
}

async function clearHistory() {
    const confirmed = await confirmDialog({
        title: label('清空注册历史', 'Clear registration history'),
        message: label('确定清空全部注册历史？', 'Clear all registration history?'),
        confirmText: label('清空', 'Clear'),
        cancelText: label('取消', 'Cancel'),
        tone: 'danger'
    })
    if (active && confirmed) state.clearHistory()
}

async function clearBlacklist() {
    const confirmed = await confirmDialog({
        title: label('清空邮箱黑名单', 'Clear email blacklist'),
        message: label('确定移除所有已知占用邮箱？', 'Remove every known used email?'),
        confirmText: label('清空', 'Clear'),
        cancelText: label('取消', 'Cancel'),
        tone: 'danger'
    })
    if (active && confirmed) state.clearBlacklist()
}

async function importTemplateFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
        state.importTemplates(await file.text())
    } catch (cause) {
        state.error = cause instanceof Error ? cause.message : String(cause)
    } finally {
        event.target.value = ''
    }
}

function downloadText(filename, contents, mime) {
    const url = URL.createObjectURL(new Blob([contents], { type: mime }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportTemplates() {
    downloadText(
        `kiro-register-templates-${new Date().toISOString().slice(0, 10)}.json`,
        state.exportTemplates(),
        'application/json'
    )
}

function exportCsv() {
    function escape(value) {
        const text = String(value || '').replace(/"/g, '""')
        return /[,"\n]/.test(text) ? `"${text}"` : text
    }
    const rows = ['time,email,status,error,password']
    for (const item of state.history) {
        rows.push(
            [
                new Date(item.time).toISOString(),
                escape(item.email),
                item.status,
                escape(item.error),
                escape(item.password)
            ].join(',')
        )
    }
    downloadText(
        `register-history-${new Date().toISOString().slice(0, 10)}.csv`,
        rows.join('\n'),
        'text/csv;charset=utf-8'
    )
}
</script>

<template>
    <main class="kam-page register-page" data-testid="page-register">
        <header class="kam-page-header">
            <div>
                <h1><UserPlus :size="24" /> {{ t('register.title') }}</h1>
                <p class="kam-muted">
                    {{
                        label(
                            '自动或手动注册新的 Kiro 账号',
                            'Register new Kiro accounts automatically or manually'
                        )
                    }}
                </p>
            </div>
            <div class="kam-actions">
                <UiButton
                    variant="ghost"
                    data-testid="register-templates-open"
                    @click="showTemplates = true"
                    >{{ label('策略模板', 'Templates') }}</UiButton
                >
                <UiButton
                    variant="ghost"
                    data-testid="register-history-open"
                    @click="showHistory = true"
                    >{{ label('注册历史', 'History') }}</UiButton
                >
                <UiButton
                    variant="ghost"
                    data-testid="register-blacklist-open"
                    @click="showBlacklist = true"
                    >{{ label('邮箱黑名单', 'Blacklist') }}</UiButton
                >
                <UiButton
                    v-if="state.history.length >= 5"
                    variant="ghost"
                    data-testid="register-analytics-open"
                    @click="showAnalytics = true"
                    >{{ label('分析报表', 'Analytics') }}</UiButton
                >
            </div>
        </header>
        <UiAlert v-if="state.error" tone="error" data-testid="register-error">{{
            state.error
        }}</UiAlert>
        <UiCard density="compact" :title="label('注册模式', 'Registration mode')">
            <div class="register-stack">
                <div
                    class="register-modes"
                    role="group"
                    :aria-label="label('注册模式', 'Registration mode')"
                >
                    <UiButton
                        v-for="option in modeOptions"
                        :key="option.value"
                        :variant="state.config.mode === option.value ? 'primary' : 'secondary'"
                        :disabled="!canStart"
                        :data-testid="`register-mode-${option.value}`"
                        @click="state.config.mode = option.value"
                        >{{ option.label }}</UiButton
                    >
                </div>
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="label('姓名（可选）', 'Full name (optional)')"
                    for="register-full-name"
                >
                    <UiInput
                        v-model="state.config.fullName"
                        :disabled="!canStart"
                        v-bind="controlAttrs"
                        data-testid="register-full-name"
                    />
                </UiField>
            </div>
        </UiCard>

        <UiCard
            v-if="state.config.mode === 'manual'"
            density="compact"
            :title="label('手动注册', 'Manual registration')"
        >
            <div class="register-stack">
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="label('母邮箱', 'Parent email')"
                    for="register-parent-email"
                >
                    <UiInput
                        v-model="state.config.manualParentEmail"
                        :disabled="!canStart"
                        v-bind="controlAttrs"
                        type="email"
                        data-testid="register-parent-email"
                    />
                </UiField>
                <UiCheckbox
                    v-model="state.config.manualAnonymousEmail"
                    :disabled="!canStart"
                    data-testid="register-anonymous-email"
                    >{{ label('使用母邮箱点号变体', 'Use parent-email dot variant') }}</UiCheckbox
                >
                <div class="kam-actions">
                    <UiButton
                        v-if="
                            state.phase === 'idle' ||
                            state.phase === 'done' ||
                            state.phase === 'finalized'
                        "
                        variant="primary"
                        :disabled="!canStart"
                        data-testid="register-start"
                        @click="state.startManual"
                        ><Play :size="16" />{{ label('开始注册', 'Start registration') }}</UiButton
                    >
                    <UiButton
                        v-if="isFlowBusy"
                        variant="danger"
                        :disabled="state.cancelling"
                        data-testid="register-cancel"
                        @click="state.cancel"
                        ><Square :size="16" />{{ label('取消', 'Cancel') }}</UiButton
                    >
                    <UiButton
                        v-if="state.phase === 'done' || state.phase === 'finalized'"
                        variant="secondary"
                        data-testid="register-reset"
                        @click="state.reset"
                        ><RotateCcw :size="16" />{{ label('新注册', 'New registration') }}</UiButton
                    >
                </div>
                <div
                    class="register-steps"
                    role="list"
                    :aria-label="label('注册进度', 'Registration progress')"
                >
                    <span
                        v-for="(step, index) in state.manualSteps"
                        :key="step"
                        role="listitem"
                        :class="{
                            'is-current': index === state.currentStep,
                            'is-complete': index < state.currentStep
                        }"
                        >{{ step }}</span
                    >
                </div>
                <div v-if="state.phase === 'email'" class="register-stack">
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('邮箱地址', 'Email address')"
                        for="register-email-input"
                    >
                        <UiInput
                            v-model="state.email"
                            v-bind="controlAttrs"
                            type="email"
                            data-testid="register-email"
                        />
                    </UiField>
                    <div class="kam-actions">
                        <UiButton
                            variant="primary"
                            :disabled="!state.email.trim()"
                            data-testid="register-submit-email"
                            @click="state.submitEmail()"
                            >{{ label('提交邮箱', 'Submit email') }}</UiButton
                        >
                    </div>
                </div>
                <div v-if="state.phase === 'otp'" class="register-stack">
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('邮箱验证码', 'Email verification code')"
                        for="register-otp-input"
                    >
                        <UiInput
                            v-model="state.otp"
                            v-bind="controlAttrs"
                            data-testid="register-otp"
                        />
                    </UiField>
                    <div class="kam-actions">
                        <UiButton
                            variant="primary"
                            :disabled="!state.otp.trim()"
                            data-testid="register-submit-otp"
                            @click="state.submitOtp()"
                            >{{ label('提交验证码', 'Submit code') }}</UiButton
                        >
                    </div>
                </div>
            </div>
        </UiCard>

        <UiCard
            v-if="state.config.mode === 'outlook' || state.config.mode === 'mixed'"
            density="compact"
            title="Outlook"
        >
            <div class="register-stack">
                <p class="kam-muted">
                    {{
                        label(
                            '每行一个邮箱配置，字段以 ---- 分隔；批量时每个任务独占一行。',
                            'One account per line, fields separated by ----; batch tasks receive unique rows.'
                        )
                    }}
                </p>
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="label('Outlook 邮箱数据', 'Outlook account data')"
                    for="register-outlook-data"
                >
                    <UiTextarea
                        v-model="state.config.outlookData"
                        :disabled="!canStart"
                        v-bind="controlAttrs"
                        :rows="5"
                        data-testid="register-outlook-data"
                    />
                </UiField>
            </div>
        </UiCard>
        <UiCard
            v-if="state.config.mode === 'tempmail' || state.config.mode === 'mixed'"
            density="compact"
            title="TempMail.Plus"
        >
            <div class="register-fields">
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="label('邮箱', 'Email')"
                    for="register-tempmail-email"
                    ><UiInput
                        v-model="state.config.tempMailEmail"
                        :disabled="!canStart"
                        v-bind="controlAttrs"
                        data-testid="register-tempmail-email"
                /></UiField>
                <UiField v-slot="{ controlAttrs }" label="EPIN" for="register-tempmail-epin"
                    ><UiInput
                        v-model="state.config.tempMailEpin"
                        :disabled="!canStart"
                        v-bind="controlAttrs"
                        data-testid="register-tempmail-epin"
                /></UiField>
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="label('域名池', 'Domain pool')"
                    for="register-tempmail-domain"
                    ><UiInput
                        v-model="state.config.tempMailDomain"
                        :disabled="!canStart"
                        v-bind="controlAttrs"
                        data-testid="register-tempmail-domain"
                /></UiField>
            </div>
        </UiCard>
        <UiCard
            v-if="state.config.mode === 'proton' || state.config.mode === 'mixed'"
            density="compact"
            title="Proton"
        >
            <div class="register-stack">
                <p class="kam-muted">
                    {{
                        label(
                            '通过母邮箱点号别名分配未使用地址；需要先登录 Proton。',
                            'Unused dot variants are allocated from the base email; sign in to Proton first.'
                        )
                    }}
                </p>
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="label('母邮箱', 'Base email')"
                    for="register-proton-base"
                    ><UiInput
                        v-model="state.config.protonBaseEmail"
                        :disabled="!canStart"
                        v-bind="controlAttrs"
                        data-testid="register-proton-base"
                /></UiField>
                <div class="kam-actions">
                    <UiBadge>{{
                        state.protonLoggedIn
                            ? label('已登录', 'Signed in')
                            : label('未登录', 'Not signed in')
                    }}</UiBadge>
                    <UiButton
                        :loading="state.protonChecking"
                        data-testid="register-proton-login"
                        @click="state.openProtonLogin"
                        >{{ label('打开登录', 'Open login') }}</UiButton
                    >
                    <UiButton
                        :disabled="state.protonChecking"
                        data-testid="register-proton-check"
                        @click="state.checkProton"
                        ><RefreshCw :size="16" />{{ label('检查状态', 'Check status') }}</UiButton
                    >
                    <UiButton
                        variant="ghost"
                        :disabled="state.protonChecking"
                        data-testid="register-proton-close"
                        @click="state.closeProton"
                        >{{ label('关闭会话', 'Close session') }}</UiButton
                    >
                </div>
            </div>
        </UiCard>
        <UiCard
            v-if="state.config.mode === 'gptmail' || state.config.mode === 'mixed'"
            density="compact"
            title="GPTmail"
        >
            <div class="register-stack">
                <p class="kam-muted">
                    {{
                        label(
                            '私有域名直收可留空 inbox；Cloudflare 转发模式填写固定 inbox。',
                            'Leave inbox empty for direct private-domain delivery; enter it for Cloudflare forwarding.'
                        )
                    }}
                </p>
                <div class="register-fields">
                    <UiField v-slot="{ controlAttrs }" label="Base URL" for="register-gptmail-url"
                        ><UiInput
                            v-model="state.config.gptMailBaseURL"
                            :disabled="!canStart"
                            v-bind="controlAttrs"
                            data-testid="register-gptmail-url"
                    /></UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        label="Inbox email"
                        for="register-gptmail-inbox"
                        ><UiInput
                            v-model="state.config.gptMailInboxEmail"
                            :disabled="!canStart"
                            v-bind="controlAttrs"
                            data-testid="register-gptmail-inbox"
                    /></UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('域名', 'Domain')"
                        for="register-gptmail-domain"
                        ><UiInput
                            v-model="state.config.gptMailDomain"
                            :disabled="!canStart"
                            v-bind="controlAttrs"
                            data-testid="register-gptmail-domain"
                    /></UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('前缀', 'Prefix')"
                        for="register-gptmail-prefix"
                        ><UiInput
                            v-model="state.config.gptMailPrefix"
                            :disabled="!canStart"
                            v-bind="controlAttrs"
                            data-testid="register-gptmail-prefix"
                    /></UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('私有域名密码', 'Private-domain password')"
                        for="register-gptmail-password"
                        ><UiInput
                            v-model="state.config.gptMailPrivatePassword"
                            :disabled="!canStart"
                            v-bind="controlAttrs"
                            type="password"
                            data-testid="register-gptmail-password"
                    /></UiField>
                </div>
            </div>
        </UiCard>
        <UiCard
            v-if="state.config.mode === 'mixed'"
            density="compact"
            :title="label('混合模式权重', 'Mixed-source weights')"
        >
            <div class="register-fields">
                <div v-for="source in sourceOptions" :key="source.value" class="register-source">
                    <UiCheckbox
                        :model-value="state.config.mixedEnabledSources.includes(source.value)"
                        :disabled="!canStart"
                        :data-testid="`register-mixed-${source.value}`"
                        @update:model-value="toggleMixedSource(source.value, $event)"
                        >{{ source.label }}</UiCheckbox
                    >
                    <UiInput
                        v-model="state.mixedWeights[source.value]"
                        :disabled="!canStart"
                        type="number"
                        min="0"
                        :aria-label="`${source.label} weight`"
                        :data-testid="`register-weight-${source.value}`"
                    />
                </div>
            </div>
        </UiCard>

        <UiCard
            v-if="state.config.mode !== 'manual' && state.config.mode !== 'mixed'"
            density="compact"
            :title="label('单次注册', 'Single registration')"
        >
            <div class="kam-actions">
                <UiButton
                    variant="primary"
                    :disabled="!canStart || !sourceReady"
                    data-testid="register-start"
                    @click="state.startAuto"
                    ><Play :size="16" />{{ label('开始注册', 'Start registration') }}</UiButton
                >
                <UiButton
                    v-if="isFlowBusy"
                    variant="danger"
                    :disabled="state.cancelling"
                    data-testid="register-cancel"
                    @click="state.cancel"
                    ><Square :size="16" />{{ label('取消', 'Cancel') }}</UiButton
                >
                <UiButton
                    v-if="state.phase === 'done' || state.phase === 'finalized'"
                    data-testid="register-reset"
                    @click="state.reset"
                    ><RotateCcw :size="16" />{{ label('新注册', 'New registration') }}</UiButton
                >
            </div>
        </UiCard>

        <UiCard density="compact" :title="label('后处理', 'Post-processing')">
            <div class="register-fields">
                <UiCheckbox
                    v-model="state.config.batchAutoImport"
                    :disabled="!canStart"
                    data-testid="register-auto-import"
                    >{{
                        label('注册成功后自动导入账号', 'Automatically import successful accounts')
                    }}</UiCheckbox
                >
                <UiCheckbox
                    v-model="state.config.autoFetchProLink"
                    :disabled="!canStart"
                    data-testid="register-auto-prolink"
                    >{{
                        label('自动获取 Pro 订阅链接', 'Automatically fetch Pro subscription link')
                    }}</UiCheckbox
                >
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="label('订阅计划', 'Subscription plan')"
                    for="register-pro-plan"
                    ><UiSelect
                        v-model="state.config.proPlanType"
                        :disabled="!canStart"
                        v-bind="controlAttrs"
                        :items="planOptions"
                        data-testid="register-pro-plan"
                /></UiField>
            </div>
        </UiCard>

        <UiCard
            v-if="state.result"
            density="compact"
            :title="label('注册结果', 'Registration result')"
            data-testid="register-result"
        >
            <div class="register-stack">
                <UiAlert :tone="state.result.status === 'success' ? 'success' : 'error'"
                    >{{ state.result.email || '—' }} ·
                    {{ state.result.error || statusLabel(state.result.status) }}</UiAlert
                >
                <div v-if="state.result.status === 'success'" class="register-result-fields">
                    <div>
                        <span class="kam-muted">{{ label('邮箱', 'Email') }}</span
                        ><span class="kam-mono">{{ state.result.email }}</span
                        ><UiCopyButton
                            :text="state.result.email || ''"
                            :label="label('复制邮箱', 'Copy email')"
                            data-testid="register-copy-email"
                        />
                    </div>
                    <div v-if="state.result.password">
                        <span class="kam-muted">{{ label('密码', 'Password') }}</span
                        ><span class="kam-mono">{{ state.result.password }}</span
                        ><UiCopyButton
                            :text="state.result.password"
                            :label="label('复制密码', 'Copy password')"
                            data-testid="register-copy-password"
                        />
                    </div>
                    <div>
                        <span class="kam-muted">{{ label('区域', 'Region') }}</span
                        ><span class="kam-mono">{{ state.result.region || 'us-east-1' }}</span
                        ><UiCopyButton
                            :text="state.result.region || 'us-east-1'"
                            :label="label('复制区域', 'Copy region')"
                            data-testid="register-copy-region"
                        />
                    </div>
                    <div v-if="state.result.refreshToken">
                        <span class="kam-muted">Refresh token</span
                        ><span class="kam-mono">{{ state.result.refreshToken.slice(0, 8) }}…</span
                        ><UiCopyButton
                            :text="state.result.refreshToken"
                            label="Copy refresh token"
                            data-testid="register-copy-token"
                        />
                    </div>
                </div>
                <div class="kam-actions">
                    <UiButton
                        v-if="state.result.status === 'success' && !state.imported"
                        :loading="state.importBusy"
                        :disabled="isFlowBusy"
                        data-testid="register-import"
                        @click="state.importCurrent"
                        ><Download :size="16" />{{ label('导入账号', 'Import account') }}</UiButton
                    >
                    <UiBadge v-if="state.imported">{{ label('已导入', 'Imported') }}</UiBadge>
                </div>
            </div>
        </UiCard>

        <UiCard
            v-if="state.config.mode !== 'manual'"
            density="compact"
            :title="label('批量注册', 'Batch registration')"
        >
            <div class="register-stack">
                <div class="register-fields">
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('数量', 'Count')"
                        for="register-batch-count"
                        ><UiInput
                            v-model="state.config.batchCount"
                            :disabled="!canStart"
                            v-bind="controlAttrs"
                            type="number"
                            min="1"
                            max="100"
                            data-testid="register-batch-count"
                    /></UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('启动间隔（秒）', 'Launch interval (seconds)')"
                        for="register-batch-interval"
                        ><UiInput
                            v-model="state.config.batchInterval"
                            :disabled="!canStart"
                            v-bind="controlAttrs"
                            type="number"
                            min="0"
                            max="300"
                            data-testid="register-batch-interval"
                    /></UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('重试次数', 'Retries')"
                        for="register-batch-retries"
                        ><UiInput
                            v-model="state.config.batchRetries"
                            :disabled="!canStart"
                            v-bind="controlAttrs"
                            type="number"
                            min="0"
                            max="10"
                            data-testid="register-batch-retries"
                    /></UiField>
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('并发数', 'Concurrency')"
                        for="register-batch-concurrency"
                        ><UiInput
                            v-model="state.config.batchConcurrency"
                            :disabled="!canStart"
                            v-bind="controlAttrs"
                            type="number"
                            min="1"
                            max="100"
                            data-testid="register-batch-concurrency"
                    /></UiField>
                </div>
                <div class="kam-actions">
                    <UiButton
                        v-if="!state.batchRunning"
                        variant="primary"
                        :disabled="!canStart || !sourceReady"
                        data-testid="register-batch-start"
                        @click="state.startBatch()"
                        ><Play :size="16" />{{ label('开始批量注册', 'Start batch') }}</UiButton
                    >
                    <UiButton
                        v-else
                        variant="danger"
                        data-testid="register-batch-stop"
                        @click="state.stopBatch"
                        ><Square :size="16" />{{ label('停止', 'Stop') }}</UiButton
                    >
                    <UiButton
                        v-if="state.batchRunning && !state.batchPaused"
                        data-testid="register-batch-pause"
                        @click="state.pauseBatch"
                        ><Pause :size="16" />{{ label('暂停', 'Pause') }}</UiButton
                    >
                    <UiButton
                        v-if="state.batchRunning && state.batchPaused"
                        data-testid="register-batch-resume"
                        @click="state.resumeBatch"
                        ><Play :size="16" />{{ label('恢复', 'Resume') }}</UiButton
                    >
                    <span class="kam-muted"
                        >{{ state.batchDone }} / {{ state.batchItems.length }} ·
                        {{ label('成功', 'Success') }} {{ state.batchSuccess }} ·
                        {{ label('失败', 'Failed') }} {{ state.batchFail }}</span
                    >
                </div>
                <UiProgress
                    :value="state.batchDone"
                    :max="state.batchItems.length || 1"
                    :label="label('批量进度', 'Batch progress')"
                />
                <div v-if="failedItems.length" class="kam-actions">
                    <UiButton
                        v-for="filter in [
                            'all',
                            'network',
                            'otp_timeout',
                            'email_used',
                            'rate_limit',
                            'risk_control',
                            'auth',
                            'unknown'
                        ]"
                        :key="filter"
                        size="sm"
                        :disabled="state.batchRunning"
                        :data-testid="`register-batch-retry-${filter}`"
                        @click="state.retryFailed(filter)"
                        >{{ label('重试', 'Retry') }} {{ filter }}</UiButton
                    >
                </div>
                <div
                    v-if="state.batchItems.length"
                    class="register-table"
                    role="table"
                    :aria-label="label('批量结果', 'Batch results')"
                >
                    <div
                        v-for="item in state.batchItems"
                        :key="item.id"
                        class="register-row"
                        role="row"
                        :data-testid="`register-batch-item-${item.index}`"
                    >
                        <span class="kam-muted">#{{ item.index }}</span
                        ><span class="kam-mono">{{ item.email || '—' }}</span>
                        <span>{{
                            item.currentStep
                                ? STEP_LABELS[item.currentStep]
                                : statusLabel(item.status)
                        }}</span>
                        <span class="kam-mono">{{ itemElapsed(item) }}</span
                        ><span class="kam-mono">{{ item.exitIp || '—' }}</span>
                        <details v-if="item.error">
                            <summary>{{ diagnoseRegError(item.error).title }}</summary>
                            <strong>{{ label('可能原因', 'Possible causes') }}</strong>
                            <ul>
                                <li
                                    v-for="reason in diagnoseRegError(item.error).reasons"
                                    :key="reason"
                                >
                                    {{ reason }}
                                </li>
                            </ul>
                            <strong>{{ label('建议', 'Suggestions') }}</strong>
                            <p>{{ item.error }}</p>
                            <ul>
                                <li
                                    v-for="suggestion in diagnoseRegError(item.error).suggestions"
                                    :key="suggestion"
                                >
                                    {{ suggestion }}
                                </li>
                            </ul>
                        </details>
                    </div>
                </div>
            </div>
        </UiCard>

        <div class="kam-grid">
            <UiCard
                density="compact"
                :title="label('每日配额与定时任务', 'Daily quota and schedule')"
            >
                <div class="register-stack">
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="
                            label('每日成功上限（0 为不限）', 'Daily success limit (0 = unlimited)')
                        "
                        for="register-daily-limit"
                        ><UiInput
                            v-model="state.dailyQuotaLimit"
                            v-bind="controlAttrs"
                            type="number"
                            min="0"
                            data-testid="register-daily-limit"
                    /></UiField>
                    <span class="kam-muted"
                        >{{ label('今日成功', 'Successful today') }}
                        {{ state.dailyQuotaUsed }}</span
                    >
                    <UiCheckbox
                        v-model="state.scheduleEnabled"
                        data-testid="register-schedule-enabled"
                        >{{ label('启用定时批量注册', 'Enable scheduled batch') }}</UiCheckbox
                    >
                    <UiField
                        v-slot="{ controlAttrs }"
                        :label="label('启动时间', 'Start time')"
                        for="register-schedule-time"
                        ><UiInput
                            v-model="state.scheduleTime"
                            v-bind="controlAttrs"
                            type="time"
                            data-testid="register-schedule-time"
                    /></UiField>
                    <div class="register-weekdays">
                        <UiCheckbox
                            v-for="(day, index) in weekdayLabels"
                            :key="index"
                            :model-value="Boolean(state.scheduleWeekMask & (1 << index))"
                            :data-testid="`register-weekday-${index}`"
                            @update:model-value="toggleWeekday(index, $event)"
                            >{{ day }}</UiCheckbox
                        >
                    </div>
                </div>
            </UiCard>
            <UiCard density="compact" :title="label('限速与风控', 'Rate limit and risk control')">
                <div class="register-stack">
                    <UiCheckbox
                        v-model="state.rateLimitEnabled"
                        data-testid="register-rate-enabled"
                        >{{ label('启用限速', 'Enable rate limit') }}</UiCheckbox
                    >
                    <div class="register-fields">
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="label('每分钟上限', 'Maximum per minute')"
                            for="register-rate-max"
                            ><UiInput
                                v-model="state.maxPerMinute"
                                v-bind="controlAttrs"
                                type="number"
                                min="1"
                                data-testid="register-rate-max"
                        /></UiField>
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="label('突发额度', 'Burst size')"
                            for="register-rate-burst"
                            ><UiInput
                                v-model="state.burstSize"
                                v-bind="controlAttrs"
                                type="number"
                                min="1"
                                data-testid="register-rate-burst"
                        /></UiField>
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="label('退避起点（秒）', 'Backoff start (seconds)')"
                            for="register-backoff-base"
                            ><UiInput
                                v-model="state.backoffBaseSec"
                                v-bind="controlAttrs"
                                type="number"
                                min="1"
                                data-testid="register-backoff-base"
                        /></UiField>
                        <UiField
                            v-slot="{ controlAttrs }"
                            :label="label('退避上限（秒）', 'Backoff maximum (seconds)')"
                            for="register-backoff-max"
                            ><UiInput
                                v-model="state.backoffMaxSec"
                                v-bind="controlAttrs"
                                type="number"
                                min="1"
                                data-testid="register-backoff-max"
                        /></UiField>
                    </div>
                    <UiCheckbox v-model="state.autoBackoff" data-testid="register-auto-backoff">{{
                        label('连续失败时自动退避', 'Auto-backoff after repeated failures')
                    }}</UiCheckbox>
                    <UiCheckbox
                        v-model="state.autoPauseOnRisk"
                        data-testid="register-auto-pause-risk"
                        >{{ label('风控警告时自动暂停', 'Auto-pause on risk warning') }}</UiCheckbox
                    >
                    <span v-if="state.rateSnapshot" class="kam-muted"
                        >{{ label('吞吐', 'Throughput') }}
                        {{ state.rateSnapshot.throughputPerMinute }}/min ·
                        {{ label('成功率', 'Success rate') }}
                        {{ Math.round(state.rateSnapshot.successRate * 100) }}%</span
                    >
                </div>
            </UiCard>
        </div>

        <UiCard density="compact" :title="label('运行日志', 'Registration log')">
            <template #actions
                ><div class="kam-actions">
                    <UiCheckbox v-model="autoFollow" data-testid="register-log-follow">{{
                        label('自动跟随', 'Auto follow')
                    }}</UiCheckbox
                    ><UiButton
                        size="sm"
                        variant="ghost"
                        data-testid="register-log-clear"
                        @click="state.logs = []"
                        ><Trash2 :size="14" />{{ label('清空', 'Clear') }}</UiButton
                    >
                </div></template
            >
            <div ref="logArea" class="register-log kam-mono" role="log" data-testid="register-logs">
                <div v-for="(entry, index) in state.logs" :key="index">{{ entry }}</div>
            </div>
        </UiCard>

        <UiDialog
            :open="showTemplates"
            size="lg"
            scrollable
            :aria-label="label('注册策略模板', 'Registration templates')"
            :content-label="label('模板列表', 'Template list')"
            @update:open="showTemplates = $event"
        >
            <template #header
                ><h2 class="ui-card-title">
                    {{ label('注册策略模板', 'Registration templates') }}
                </h2></template
            >
            <div class="register-stack" data-testid="register-templates-dialog">
                <UiField
                    v-slot="{ controlAttrs }"
                    :label="label('模板名称', 'Template name')"
                    for="register-template-name"
                    ><UiInput
                        v-model="templateName"
                        v-bind="controlAttrs"
                        data-testid="register-template-name"
                /></UiField>
                <div class="kam-actions">
                    <UiButton data-testid="register-template-save" @click="saveTemplate">{{
                        label('保存当前配置', 'Save current configuration')
                    }}</UiButton
                    ><UiButton data-testid="register-template-export" @click="exportTemplates"
                        ><Download :size="16" />JSON</UiButton
                    ><UiButton data-testid="register-template-import" @click="templateFile?.click()"
                        ><Upload :size="16" />JSON</UiButton
                    ><input
                        ref="templateFile"
                        type="file"
                        accept="application/json,.json"
                        class="register-file"
                        @change="importTemplateFile"
                    />
                </div>
                <div
                    v-for="template in state.templates"
                    :key="template.id"
                    class="register-list-row"
                >
                    <span
                        >{{ template.name }}
                        <small class="kam-muted">{{ template.config.mode }}</small></span
                    >
                    <div class="kam-actions">
                        <UiButton
                            size="sm"
                            data-testid="register-template-apply"
                            @click="state.applyTemplate(template)"
                            >{{ label('应用', 'Apply') }}</UiButton
                        ><UiButton
                            size="sm"
                            variant="danger"
                            data-testid="register-template-delete"
                            @click="deleteTemplate(template)"
                            ><Trash2 :size="14"
                        /></UiButton>
                    </div>
                </div>
                <p v-if="!state.templates.length" class="kam-muted">
                    {{ label('暂无模板', 'No templates saved') }}
                </p>
            </div>
            <template #footer
                ><div class="kam-actions">
                    <UiButton @click="showTemplates = false">{{ label('关闭', 'Close') }}</UiButton>
                </div></template
            >
        </UiDialog>

        <UiDialog
            :open="showHistory"
            size="xl"
            scrollable
            :aria-label="label('注册历史', 'Registration history')"
            :content-label="label('注册历史列表', 'Registration history list')"
            @update:open="showHistory = $event"
        >
            <template #header
                ><h2 class="ui-card-title">
                    {{ label('注册历史', 'Registration history') }}
                </h2></template
            >
            <div class="register-stack" data-testid="register-history-dialog">
                <div class="kam-actions">
                    <UiButton
                        variant="danger"
                        :disabled="!state.history.length"
                        data-testid="register-history-clear"
                        @click="clearHistory"
                        ><Trash2 :size="16" />{{ label('清空历史', 'Clear history') }}</UiButton
                    >
                </div>
                <div
                    v-for="item in state.history"
                    :key="item.id"
                    class="register-list-row"
                    :data-testid="`register-history-${item.id}`"
                >
                    <div>
                        <strong class="kam-mono">{{ item.email || '—' }}</strong>
                        <UiBadge
                            v-if="item.result?.fingerprint"
                            :title="`Chrome ${item.result.fingerprint.chromeVer}\nUA: ${item.result.fingerprint.ua}\nGPU: ${item.result.fingerprint.gpuVendor} ${item.result.fingerprint.gpuModel}\nCanvas: ${item.result.fingerprint.canvasHash}\nScreen: ${item.result.fingerprint.screen?.width}x${item.result.fingerprint.screen?.height}\nProxy: ${item.result.fingerprint.proxyUrl || '(direct)'}\nExit IP: ${item.result.fingerprint.exitIP || 'N/A'}`"
                            >🔒 {{ item.result.fingerprint.chromeVer?.split('.')[0] }} ·
                            {{ item.result.fingerprint.screen?.width }}×{{
                                item.result.fingerprint.screen?.height
                            }}{{
                                item.result.fingerprint.exitIP
                                    ? ` · ${item.result.fingerprint.exitIP}`
                                    : ''
                            }}</UiBadge
                        >
                        <p class="kam-muted">
                            {{ new Date(item.time).toLocaleString() }} · {{ item.status }} ·
                            {{ item.error || '' }}
                        </p>
                    </div>
                    <div class="kam-actions">
                        <UiButton
                            v-if="item.status === 'success' && !item.imported"
                            size="sm"
                            :loading="state.historyImportBusy.has(item.id)"
                            @click="state.importHistory(item)"
                            >{{ label('导入', 'Import') }}</UiButton
                        ><UiBadge v-if="item.imported">{{ label('已导入', 'Imported') }}</UiBadge
                        ><UiButton size="sm" variant="danger" @click="state.deleteHistory(item.id)"
                            ><Trash2 :size="14"
                        /></UiButton>
                    </div>
                </div>
                <p v-if="!state.history.length" class="kam-muted">
                    {{ label('暂无历史', 'No history') }}
                </p>
            </div>
            <template #footer
                ><div class="kam-actions">
                    <UiButton @click="showHistory = false">{{ label('关闭', 'Close') }}</UiButton>
                </div></template
            >
        </UiDialog>

        <UiDialog
            :open="showBlacklist"
            size="lg"
            scrollable
            :aria-label="label('邮箱黑名单', 'Email blacklist')"
            :content-label="label('黑名单列表', 'Blacklist entries')"
            @update:open="showBlacklist = $event"
        >
            <template #header
                ><h2 class="ui-card-title">
                    {{ label('邮箱黑名单', 'Email blacklist') }}
                </h2></template
            >
            <div class="register-stack" data-testid="register-blacklist-dialog">
                <div class="kam-actions">
                    <UiButton size="sm" @click="state.refreshBlacklist"
                        ><RefreshCw :size="16" />{{ label('刷新', 'Refresh') }}</UiButton
                    ><UiButton
                        size="sm"
                        variant="danger"
                        :disabled="!state.blacklist.length"
                        @click="clearBlacklist"
                        >{{ label('清空', 'Clear') }}</UiButton
                    >
                </div>
                <div v-for="address in state.blacklist" :key="address" class="register-list-row">
                    <span class="kam-mono">{{ address }}</span
                    ><UiButton
                        size="sm"
                        variant="danger"
                        @click="state.removeBlacklistEmail(address)"
                        ><Trash2 :size="14"
                    /></UiButton>
                </div>
                <p v-if="!state.blacklist.length" class="kam-muted">
                    {{ label('暂无已占用邮箱', 'No known used emails') }}
                </p>
            </div>
            <template #footer
                ><div class="kam-actions">
                    <UiButton @click="showBlacklist = false">{{ label('关闭', 'Close') }}</UiButton>
                </div></template
            >
        </UiDialog>

        <UiDialog
            :open="showAnalytics"
            size="xl"
            scrollable
            :aria-label="label('注册分析报表', 'Registration analytics')"
            :content-label="label('分析报表', 'Analytics report')"
            @update:open="showAnalytics = $event"
        >
            <template #header
                ><h2 class="ui-card-title">
                    <Activity :size="18" /> {{ label('注册分析报表', 'Registration analytics') }}
                </h2></template
            >
            <div class="register-stack" data-testid="register-analytics-dialog">
                <div class="kam-actions">
                    <UiBadge>{{ label('样本', 'Samples') }} {{ analytics.total }}</UiBadge
                    ><UiBadge>{{ label('成功', 'Success') }} {{ analytics.success }}</UiBadge
                    ><UiBadge>{{ label('失败', 'Failed') }} {{ analytics.failed }}</UiBadge
                    ><UiBadge>{{ label('成功率', 'Success rate') }} {{ analytics.rate }}%</UiBadge
                    ><UiButton size="sm" data-testid="register-analytics-csv" @click="exportCsv"
                        ><Download :size="16" />CSV</UiButton
                    >
                </div>
                <UiProgress :value="analytics.rate" :label="label('成功率', 'Success rate')" />
                <div class="register-report-grid">
                    <div>
                        <h3>{{ label('最近七天', 'Last seven days') }}</h3>
                        <div v-for="day in analytics.sevenDays" :key="day" class="register-bar-row">
                            <span>{{ day }}</span
                            ><UiProgress
                                :value="analytics.byDay[day].success"
                                :max="
                                    Math.max(
                                        1,
                                        analytics.byDay[day].success + analytics.byDay[day].failed
                                    )
                                "
                                :label="day"
                            /><span
                                >{{ analytics.byDay[day].success }}/{{
                                    analytics.byDay[day].success + analytics.byDay[day].failed
                                }}</span
                            >
                        </div>
                    </div>
                    <div>
                        <h3>{{ label('按邮箱源', 'By provider') }}</h3>
                        <p v-for="(counts, provider) in analytics.byProvider" :key="provider">
                            {{ provider }}: {{ counts.success }} / {{ counts.failed }}
                        </p>
                        <h3>{{ label('主要错误', 'Top errors') }}</h3>
                        <p v-for="(count, category) in analytics.errors" :key="category">
                            {{ category }}: {{ count }}
                        </p>
                        <h3>{{ label('最佳时段', 'Peak hours') }}</h3>
                        <p v-for="[hour, counts] in analytics.peakHours" :key="hour">
                            {{ hour }}:00 · {{ counts.success }}/{{
                                counts.success + counts.failed
                            }}
                        </p>
                    </div>
                </div>
                <div>
                    <h3>{{ label('小时分布', 'Hourly distribution') }}</h3>
                    <div class="register-hours">
                        <div
                            v-for="hour in 24"
                            :key="hour"
                            :title="`${hour - 1}:00 · ${analytics.byHour[hour - 1]?.success || 0}/${(analytics.byHour[hour - 1]?.success || 0) + (analytics.byHour[hour - 1]?.failed || 0)}`"
                        >
                            <span
                                :style="{
                                    height: `${Math.max(2, ((analytics.byHour[hour - 1]?.success || 0) + (analytics.byHour[hour - 1]?.failed || 0)) * 12)}px`
                                }"
                            ></span
                            ><small>{{ hour - 1 }}</small>
                        </div>
                    </div>
                </div>
            </div>
            <template #footer
                ><div class="kam-actions">
                    <UiButton @click="showAnalytics = false">{{ label('关闭', 'Close') }}</UiButton>
                </div></template
            >
        </UiDialog>
    </main>
</template>

<style scoped>
.register-page h1,
.register-page .ui-card-title {
    display: flex;
    align-items: center;
    gap: 8px;
}
.register-stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.register-stack :deep(.ui-field),
.register-fields :deep(.ui-field) {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
}
.register-stack :deep(.ui-input),
.register-stack :deep(.ui-textarea),
.register-fields :deep(.ui-input),
.register-fields :deep(.ui-select) {
    width: 100%;
}
.register-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
}
.register-modes,
.register-weekdays {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.register-source {
    display: flex;
    align-items: center;
    gap: 12px;
}
.register-result-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
}
.register-result-fields > div {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
}
.register-source :deep(.ui-input) {
    max-width: 90px;
}
.register-steps {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.register-steps span {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
}
.register-steps .is-current {
    color: var(--text);
    border-color: var(--accent);
}
.register-steps .is-complete {
    color: var(--text);
}
.register-table,
.register-log {
    max-height: 320px;
    overflow: auto;
}
.register-row,
.register-list-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
}
.register-row > :nth-child(2) {
    flex: 1 1 180px;
}
.register-row details {
    flex: 1 1 100%;
}
.register-log {
    min-height: 120px;
    white-space: pre-wrap;
}
.register-file {
    display: none;
}
.register-report-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
}
.register-bar-row {
    display: grid;
    grid-template-columns: 48px 1fr 48px;
    align-items: center;
    gap: 8px;
}
.register-hours {
    display: grid;
    grid-template-columns: repeat(24, minmax(12px, 1fr));
    align-items: end;
    gap: 3px;
    overflow-x: auto;
}
.register-hours > div {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}
.register-hours span {
    display: block;
    width: 100%;
    background: var(--accent);
}
.register-hours small {
    color: var(--muted);
    font-size: 9px;
}
@media (max-width: 900px) {
    .register-fields,
    .register-report-grid,
    .register-result-fields {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
