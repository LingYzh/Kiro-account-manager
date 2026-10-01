import { createRateLimiter } from '@shared/lib/rateLimiter'
import { getActivePinia } from 'pinia'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useAccountsStore } from '../stores/accounts'
import { useProxyPoolStore } from '../stores/proxyPool'
import { useTaskStore } from '../stores/tasks'
import { useWebhookStore } from '../stores/webhooks'
import { useSubscriptionState } from './useSubscription'
import { toIpcData } from '../lib/ipcData'
import {
    AUTO_SOURCES,
    DEFAULT_REGISTER_CONFIG,
    REGISTER_STORAGE,
    buildManualSteps,
    classifyError,
    createSourcePicker,
    injectProxySession,
    loadBlacklist,
    loadRegisterConfig,
    nextProtonEmail,
    phaseToStep,
    readJson,
    saveBlacklist,
    shuffleOutlookLines,
    writeJson
} from '../lib/registration'

function message(error) {
    return error instanceof Error ? error.message : String(error)
}

function todayKey(date = new Date()) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function numberSetting(key, fallback) {
    try {
        return Number.parseInt(localStorage.getItem(key) || '', 10) || fallback
    } catch {
        return fallback
    }
}

function flagSetting(key, fallback) {
    try {
        const value = localStorage.getItem(key)
        return value === null ? fallback : value === '1'
    } catch {
        return fallback
    }
}

function saveScalar(key, value) {
    try {
        localStorage.setItem(key, String(value))
    } catch {
        // The active registration flow does not depend on storage availability.
    }
}

/** Owns one mounted Register page. App keeps visited pages mounted with v-show. */
export function useRegistration() {
    const pinia = getActivePinia()
    const accounts = useAccountsStore(pinia)
    const proxies = useProxyPoolStore(pinia)
    const tasks = useTaskStore(pinia)
    const webhooks = useWebhookStore(pinia)
    const subscription = useSubscriptionState(pinia)
    const config = reactive(loadRegisterConfig())
    const mixedWeights = reactive({
        outlook: 1,
        tempmail: 1,
        proton: 1,
        gptmail: 1,
        ...readJson(REGISTER_STORAGE.mixedWeights, {})
    })
    const phase = ref('idle')
    const logs = ref([])
    const result = ref(null)
    const imported = ref(false)
    const email = ref('')
    const otp = ref('')
    const history = ref(readJson(REGISTER_STORAGE.history, []))
    const templates = ref(readJson(REGISTER_STORAGE.templates, []))
    const blacklist = ref([...loadBlacklist()])
    const batchItems = ref([])
    const batchRunning = ref(false)
    const batchPaused = ref(false)
    const batchDone = ref(0)
    const batchSuccess = ref(0)
    const batchFail = ref(0)
    const protonLoggedIn = ref(false)
    const protonChecking = ref(false)
    const importBusy = ref(false)
    const historyImportBusy = ref(new Set())
    const cancelling = ref(false)
    const error = ref('')
    const dailyQuotaLimit = ref(numberSetting('kiro-register-dailyquota-limit', 0))
    const dailyQuotaUsed = ref(numberSetting(`kiro-register-quota-${todayKey()}`, 0))
    const scheduleEnabled = ref(flagSetting('kiro-register-schedule-enabled', false))
    const scheduleTime = ref(
        (() => {
            try {
                return localStorage.getItem('kiro-register-schedule-time') || '03:00'
            } catch {
                return '03:00'
            }
        })()
    )
    const scheduleWeekMask = ref(numberSetting('kiro-register-schedule-week-mask', 127))
    const rateLimitEnabled = ref(flagSetting('kiro-register-ratelimit-enabled', true))
    const maxPerMinute = ref(numberSetting('kiro-register-ratelimit-max', 10))
    const burstSize = ref(numberSetting('kiro-register-ratelimit-burst', 3))
    const backoffBaseSec = ref(numberSetting('kiro-register-backoff-base-sec', 8))
    const backoffMaxSec = ref(numberSetting('kiro-register-backoff-max-sec', 120))
    const autoBackoff = ref(flagSetting('kiro-register-autobackoff', true))
    const autoPauseOnRisk = ref(flagSetting('kiro-register-autopause-risk', false))
    const rateSnapshot = ref(null)
    const manualSteps = computed(() =>
        buildManualSteps(config.batchAutoImport, config.autoFetchProLink)
    )
    const currentStep = computed(() =>
        phaseToStep(phase.value, logs.value.at(-1), manualSteps.value)
    )
    const sourcePicker = createSourcePicker()
    const allocatedProton = new Set()
    const taskIds = new Map()
    const completedResults = new WeakSet()
    const resultKeys = new Set()
    let active = false
    let generation = 0
    let batchGeneration = 0
    let controller = null
    let currentTaskId = null
    let limiter = null
    let scheduleTimer = null
    let rateTimer = null
    let scheduleTriggered = ''
    let riskWarning = false
    let outlookLines = []
    let batchStopping = false
    const unlisteners = []

    function live(id) {
        return active && id === generation
    }

    function addLog(text) {
        if (!active) return
        logs.value = [...logs.value, `[${new Date().toLocaleTimeString()}] ${text}`].slice(-500)
    }

    function setHistory(items) {
        history.value = items.slice(0, 100)
        writeJson(REGISTER_STORAGE.history, history.value)
    }

    function addHistory(regResult, importedAccount = false) {
        const item = {
            id: crypto.randomUUID(),
            time: Date.now(),
            email: regResult.email || '',
            status: regResult.status,
            error: regResult.error,
            password: regResult.password,
            result: regResult,
            imported: importedAccount
        }
        setHistory([item, ...history.value])
        return item.id
    }

    function markHistoryImported(id) {
        setHistory(
            history.value.map((item) => (item.id === id ? { ...item, imported: true } : item))
        )
    }

    function rememberUsedEmail(address) {
        if (!address) return
        const values = loadBlacklist()
        values.add(address.toLowerCase())
        saveBlacklist(values)
        blacklist.value = [...values]
    }

    function refreshBlacklist() {
        blacklist.value = [...loadBlacklist()]
    }

    function removeBlacklistEmail(address) {
        const values = loadBlacklist()
        values.delete(address.toLowerCase())
        saveBlacklist(values)
        refreshBlacklist()
    }

    function clearBlacklist() {
        try {
            localStorage.removeItem(REGISTER_STORAGE.blacklist)
        } catch {
            /* ignore */
        }
        blacklist.value = []
    }

    function usedEmails() {
        const values = loadBlacklist()
        for (const account of accounts.accounts.values())
            if (account.email) values.add(account.email.toLowerCase())
        for (const item of history.value) if (item.email) values.add(item.email.toLowerCase())
        for (const address of allocatedProton) values.add(address)
        return values
    }

    function allocateProton() {
        const address = nextProtonEmail(config.protonBaseEmail, usedEmails())
        if (address) allocatedProton.add(address.toLowerCase())
        return address
    }

    function pickSource() {
        const enabled = config.mixedEnabledSources.filter((source) => AUTO_SOURCES.includes(source))
        const candidates = enabled.filter((source) => {
            if (source === 'outlook') return Boolean(config.outlookData.trim())
            if (source === 'tempmail')
                return Boolean(
                    config.tempMailEmail.trim() &&
                    config.tempMailEpin.trim() &&
                    config.tempMailDomain.trim()
                )
            if (source === 'proton') return Boolean(config.protonBaseEmail.trim())
            return Boolean(config.gptMailDomain.trim())
        })
        return sourcePicker(candidates, mixedWeights)
    }

    function buildAutoConfig() {
        const source = config.mode === 'mixed' ? pickSource() : config.mode
        if (!source || source === 'manual') return null
        if (source === 'outlook') return { useOutlook: true, outlookData: config.outlookData }
        if (source === 'tempmail')
            return {
                useTempMailPlus: true,
                tempMailPlusEmail: config.tempMailEmail,
                tempMailPlusEpin: config.tempMailEpin,
                tempMailPlusDomain: config.tempMailDomain
            }
        if (source === 'proton') {
            const protonEmail = allocateProton()
            return protonEmail ? { useProton: true, protonEmail } : null
        }
        if (!config.gptMailDomain.trim()) return null
        return {
            useGptMail: true,
            gptMailBaseURL: config.gptMailBaseURL.trim(),
            gptMailInboxEmail: config.gptMailInboxEmail.trim(),
            gptMailDomain: config.gptMailDomain,
            gptMailPrefix: config.gptMailPrefix.trim(),
            gptMailPrivatePassword: config.gptMailPrivatePassword
        }
    }

    function pickProxy(strict) {
        if (!proxies.proxyPoolConfig.enabled) return null
        if (strict && proxies.proxyPool.size === 0) throw new Error('代理池已启用但池为空')
        const entry = proxies.pickNextProxy()
        if (strict && !entry) throw new Error('代理池无可用代理')
        return entry
    }

    function attachProxy(payload, strict) {
        const entry = pickProxy(strict)
        if (!entry) return null
        payload.proxy = injectProxySession(entry.url)
        if (strict) payload.strictProxy = true
        const upstream = proxies.proxyPoolConfig.upstreamProxy || ''
        if (strict ? upstream.trim() : upstream)
            payload.upstreamProxy = strict ? upstream.trim() : upstream
        return entry
    }

    function createAccount(regResult, verified, includePassword) {
        const now = Date.now()
        const data = verified?.success && verified.data ? verified.data : null
        const fast = includePassword && regResult.verify?.alive ? regResult.verify : null
        const title =
            data?.subscriptionTitle ||
            (fast ? String(fast.subscription || 'KIRO FREE') : 'Free Tier')
        const type =
            data?.subscriptionType ||
            (fast
                ? title.includes('PRO_PLUS') || title.includes('POWER')
                    ? 'Pro_Plus'
                    : title.includes('PRO')
                      ? 'Pro'
                      : 'Free'
                : 'Free')
        const credits = fast
            ? { current: Number(fast.credit_used) || 0, limit: Number(fast.credit_limit) || 0 }
            : null
        const rawUsage = data?.usage || credits
        const usage = rawUsage
            ? {
                  ...rawUsage,
                  percentUsed:
                      rawUsage.limit > 0
                          ? Math.round((rawUsage.current / rawUsage.limit) * 100)
                          : 0,
                  lastUpdated: now
              }
            : { current: 0, limit: 0, percentUsed: 0, lastUpdated: now }
        accounts.addAccount({
            email: data?.email || fast?.email || regResult.email,
            ...(includePassword ? { password: regResult.password } : {}),
            idp: 'BuilderId',
            status: 'active',
            credentials: {
                refreshToken: regResult.refreshToken,
                clientId: regResult.clientId,
                clientSecret: regResult.clientSecret,
                accessToken: data?.accessToken || regResult.accessToken || '',
                csrfToken: '',
                region: regResult.region || 'us-east-1',
                authMethod: 'IdC',
                provider: 'BuilderId',
                expiresAt: now + (data?.expiresIn ? data.expiresIn * 1000 : 3600000)
            },
            subscription: { type, title },
            usage,
            tags: [],
            lastUsedAt: now
        })
    }

    async function importResult(regResult, includePassword, id) {
        if (!live(id) || !regResult?.refreshToken || !regResult.clientId || !regResult.clientSecret)
            return false
        let verified = null
        if (!includePassword || !regResult.verify?.alive) {
            try {
                verified = await window.api.verifyAccountCredentials(
                    toIpcData({
                        refreshToken: regResult.refreshToken,
                        clientId: regResult.clientId,
                        clientSecret: regResult.clientSecret,
                        region: regResult.region || 'us-east-1',
                        authMethod: 'IdC',
                        provider: 'BuilderId'
                    })
                )
            } catch {
                return false
            }
        }
        if (!live(id)) return false
        createAccount(regResult, verified, includePassword)
        return true
    }

    async function fetchProLink(regResult, id) {
        if (!live(id) || !regResult.accessToken) return undefined
        const linkId = crypto.randomUUID()
        subscription.appendLink({
            accountId: linkId,
            email: regResult.email,
            status: 'loading',
            generatedAt: Date.now()
        })
        try {
            const response = await window.api.accountGetSubscriptionUrl(
                regResult.accessToken,
                config.proPlanType,
                regResult.region || 'us-east-1',
                undefined,
                undefined,
                'BuilderId',
                'IdC',
                undefined
            )
            if (!live(id)) return undefined
            subscription.updateLink(
                linkId,
                response.success && response.url
                    ? { status: 'success', url: response.url }
                    : { status: 'error', error: response.error || 'Failed to get link' }
            )
            return response.success ? response.url : undefined
        } catch (cause) {
            if (live(id))
                subscription.updateLink(linkId, { status: 'error', error: message(cause) })
            return undefined
        }
    }

    async function processResult(regResult, id, origin) {
        if (!live(id) || !regResult || completedResults.has(regResult)) return
        const key = `${origin}:${regResult.email}:${regResult.refreshToken || ''}:${regResult.status}`
        if (resultKeys.has(key)) return
        resultKeys.add(key)
        completedResults.add(regResult)
        result.value = regResult
        phase.value = 'done'
        const historyId = addHistory(regResult)
        if (regResult.status === 'success') {
            addLog(`注册成功 ${regResult.email}`)
            if (origin !== 'manual')
                void webhooks.triggerEvent('register-success', {
                    title: '账号注册成功',
                    message: `新账号 ${regResult.email} 注册完成`,
                    level: 'success',
                    fields: { 邮箱: regResult.email, 模式: config.mode }
                })
            if (config.batchAutoImport) {
                phase.value = 'importing'
                const ok = await importResult(regResult, true, id)
                if (!live(id)) return
                imported.value = ok
                if (ok) markHistoryImported(historyId)
            }
            if (config.autoFetchProLink) {
                phase.value = 'fetching-link'
                await fetchProLink(regResult, id)
                if (!live(id)) return
            }
            if (config.batchAutoImport || config.autoFetchProLink) phase.value = 'finalized'
        } else {
            addLog(`注册失败 ${regResult.error || ''}`)
            if (classifyError(regResult.error) === 'email_used') rememberUsedEmail(regResult.email)
            if (origin !== 'manual')
                void webhooks.triggerEvent('register-failed', {
                    title: '账号注册失败',
                    message: `${regResult.email || '(未知邮箱)'} 注册失败`,
                    level: 'error',
                    fields: {
                        邮箱: regResult.email || '-',
                        错误: regResult.error || '-',
                        模式: config.mode
                    }
                })
        }
    }

    function beginFlow() {
        if (
            !active ||
            cancelling.value ||
            importBusy.value ||
            historyImportBusy.value.size ||
            batchRunning.value ||
            !['idle', 'done', 'finalized'].includes(phase.value)
        )
            return null
        generation++
        resultKeys.clear()
        logs.value = []
        result.value = null
        imported.value = false
        error.value = ''
        return generation
    }

    function reset() {
        if (
            !active ||
            cancelling.value ||
            importBusy.value ||
            historyImportBusy.value.size ||
            batchRunning.value ||
            !['idle', 'done', 'finalized'].includes(phase.value)
        )
            return
        generation++
        phase.value = 'idle'
        logs.value = []
        result.value = null
        imported.value = false
        otp.value = ''
        error.value = ''
    }

    async function startManual() {
        const id = beginFlow()
        if (id === null) return
        let preparedEmail = config.manualParentEmail.trim()
        if (config.manualAnonymousEmail) {
            preparedEmail = nextProtonEmail(preparedEmail, usedEmails()) || ''
            if (!preparedEmail) {
                error.value = '母邮箱无效或点号变体已用尽'
                return
            }
        }
        email.value = preparedEmail
        phase.value = 'initializing'
        const payload = {}
        if (config.fullName.trim()) payload.fullName = config.fullName.trim()
        try {
            attachProxy(payload, false)
            const response = await window.api.registrationManualPhase1(toIpcData(payload))
            if (!live(id)) return
            if (!response.success) throw new Error(response.error || '初始化失败')
            phase.value = 'email'
            if (preparedEmail) await submitEmail(preparedEmail, id)
        } catch (cause) {
            if (live(id)) {
                error.value = message(cause)
                phase.value = 'idle'
                addLog(error.value)
            }
        }
    }

    async function submitEmail(address = email.value, flowId = generation) {
        if (!live(flowId) || phase.value !== 'email' || !address.trim()) return
        phase.value = 'running'
        try {
            const response = await window.api.registrationManualPhase2(
                address.trim(),
                config.fullName.trim() || undefined
            )
            if (!live(flowId)) return
            if (!response.success) throw new Error(response.error || '提交邮箱失败')
            phase.value = 'otp'
        } catch (cause) {
            if (live(flowId)) {
                error.value = message(cause)
                phase.value = 'idle'
                addLog(error.value)
            }
        }
    }

    async function submitOtp() {
        const id = generation
        if (!live(id) || phase.value !== 'otp' || !otp.value.trim()) return
        phase.value = 'running'
        try {
            const response = await window.api.registrationManualPhase3(otp.value.trim())
            if (!live(id)) return
            if (!response.success || !response.result)
                throw new Error(response.error || '验证码提交失败')
            await processResult(response.result, id, 'manual')
            if (live(id) && response.result.status !== 'success') phase.value = 'idle'
        } catch (cause) {
            if (live(id)) {
                error.value = message(cause)
                phase.value = 'idle'
                addLog(error.value)
            }
        }
    }

    async function startAuto() {
        const id = beginFlow()
        if (id === null || config.mode === 'manual' || config.mode === 'mixed') return
        const payload = buildAutoConfig()
        if (!payload) {
            error.value = '邮箱源配置不足'
            return
        }
        phase.value = 'running'
        try {
            attachProxy(payload, false)
            const response = await window.api.registrationStartAuto(toIpcData(payload))
            if (!live(id)) return
            if (!response.success) throw new Error(response.error || '注册启动失败')
            if (response.result) await processResult(response.result, id, 'single')
        } catch (cause) {
            if (live(id)) {
                error.value = message(cause)
                phase.value = 'idle'
                addLog(error.value)
            }
        }
    }

    async function cancel() {
        if (!active || cancelling.value || phase.value === 'idle') return
        cancelling.value = true
        generation++
        phase.value = 'cancelling'
        try {
            await window.api.registrationCancel()
            if (active) addLog('已取消注册')
        } catch (cause) {
            if (active) error.value = message(cause)
        } finally {
            if (active) phase.value = 'idle'
            cancelling.value = false
        }
    }

    async function importCurrent() {
        const id = generation
        if (!active || importBusy.value || imported.value || result.value?.status !== 'success')
            return
        importBusy.value = true
        try {
            const ok = await importResult(result.value, false, id)
            if (live(id)) imported.value = ok
        } finally {
            importBusy.value = false
        }
    }

    async function importHistory(item) {
        const id = generation
        if (
            !active ||
            historyImportBusy.value.has(item.id) ||
            !item.result ||
            item.imported ||
            item.result.status !== 'success'
        )
            return
        historyImportBusy.value = new Set([...historyImportBusy.value, item.id])
        try {
            const ok = await importResult(item.result, false, id)
            if (ok && live(id)) markHistoryImported(item.id)
        } finally {
            const next = new Set(historyImportBusy.value)
            next.delete(item.id)
            historyImportBusy.value = next
        }
    }

    function deleteHistory(id) {
        setHistory(history.value.filter((item) => item.id !== id))
    }

    function clearHistory() {
        setHistory([])
    }

    function saveTemplate(name) {
        if (!name?.trim()) return
        const entry = {
            id: crypto.randomUUID(),
            name: name.trim(),
            config: toIpcData(config),
            createdAt: Date.now()
        }
        templates.value = [entry, ...templates.value]
        writeJson(REGISTER_STORAGE.templates, templates.value)
    }

    function applyTemplate(template) {
        if (!template?.config || batchRunning.value || phase.value !== 'idle') return
        Object.assign(config, DEFAULT_REGISTER_CONFIG, template.config, {
            mode: template.config.mode === 'moemail' ? 'outlook' : template.config.mode
        })
    }

    function deleteTemplate(id) {
        templates.value = templates.value.filter((item) => item.id !== id)
        writeJson(REGISTER_STORAGE.templates, templates.value)
    }

    function importTemplates(text) {
        const parsed = JSON.parse(text)
        if (!Array.isArray(parsed)) throw new Error('模板格式无效')
        const entries = parsed.filter(
            (item) => item && typeof item.name === 'string' && item.config
        )
        const seen = new Set()
        templates.value = [...entries, ...templates.value].filter((item) => {
            if (seen.has(item.id)) return false
            seen.add(item.id)
            return true
        })
        writeJson(REGISTER_STORAGE.templates, templates.value)
        return entries.length
    }

    function exportTemplates() {
        return JSON.stringify(templates.value, null, 2)
    }

    function refreshQuota() {
        dailyQuotaUsed.value = numberSetting(`kiro-register-quota-${todayKey()}`, 0)
    }

    function increaseQuota() {
        refreshQuota()
        dailyQuotaUsed.value++
        saveScalar(`kiro-register-quota-${todayKey()}`, dailyQuotaUsed.value)
    }

    function pauseBatch() {
        if (!batchRunning.value || batchPaused.value) return
        batchPaused.value = true
        if (currentTaskId) tasks.updateTask(currentTaskId, { status: 'paused' })
    }

    function resumeBatch() {
        if (!batchRunning.value || !batchPaused.value) return
        batchPaused.value = false
        riskWarning = false
        if (currentTaskId) tasks.updateTask(currentTaskId, { status: 'running' })
    }

    async function stopBatch() {
        if (!batchRunning.value || batchStopping) return
        batchStopping = true
        cancelling.value = true
        batchPaused.value = false
        controller?.abort()
        generation++
        phase.value = 'idle'
        if (currentTaskId) {
            tasks.cancelTask(currentTaskId)
            currentTaskId = null
        }
        try {
            await window.api.registrationCancel()
        } catch (cause) {
            if (active) error.value = message(cause)
        } finally {
            cancelling.value = false
        }
    }

    async function waitInterruptible(milliseconds, signal) {
        let remaining = milliseconds
        while (remaining > 0 && !signal.aborted && active) {
            const step = Math.min(100, remaining)
            await new Promise((resolve) => setTimeout(resolve, step))
            remaining -= step
        }
    }

    async function waitResumed(signal) {
        while (batchPaused.value && !signal.aborted && active) await waitInterruptible(300, signal)
    }

    function setBatchItem(id, changes) {
        batchItems.value = batchItems.value.map((item) =>
            item.id === id ? { ...item, ...changes } : item
        )
    }

    async function runBatchItem(item, taskId, signal, id) {
        for (let attempt = 0; attempt <= Math.max(0, Number(config.batchRetries) || 0); attempt++) {
            await waitResumed(signal)
            if (signal.aborted || !live(id)) return null
            if (attempt) {
                setBatchItem(item.id, { status: 'retrying', retryCount: attempt })
                await waitInterruptible(3000, signal)
                await waitResumed(signal)
                if (signal.aborted || !live(id)) return null
            } else setBatchItem(item.id, { status: 'running', startedAt: Date.now() })
            const payload = buildAutoConfig()
            if (!payload) return { status: 'failed', email: '', error: '邮箱源配置不足' }
            payload.taskId = taskId
            if (payload.useOutlook && outlookLines.length)
                payload.outlookData = outlookLines.shift()
            let proxy = null
            try {
                proxy = attachProxy(payload, true)
            } catch (cause) {
                return { status: 'failed', email: '', error: message(cause) }
            }
            try {
                const response = await window.api.registrationStartAuto(toIpcData(payload))
                if (signal.aborted || !live(id)) return null
                const outcome = response.result || {
                    status: 'failed',
                    email: '',
                    error: response.error || '注册失败'
                }
                if (proxy)
                    proxies.reportProxyResult(
                        proxy.id,
                        response.success && outcome.status === 'success',
                        outcome.email,
                        response.error || outcome.error
                    )
                if (outcome.status === 'success') return outcome
                if (attempt === Math.max(0, Number(config.batchRetries) || 0)) return outcome
            } catch (cause) {
                if (signal.aborted || !live(id)) return null
                if (proxy) proxies.reportProxyResult(proxy.id, false, undefined, message(cause))
                if (attempt === Math.max(0, Number(config.batchRetries) || 0))
                    return { status: 'failed', email: '', error: message(cause) }
            }
        }
        return null
    }

    async function finishBatchItem(item, outcome, id, signal) {
        if (!live(id) || signal.aborted || !outcome) return
        if (outcome.status === 'success') {
            batchSuccess.value++
            if (dailyQuotaLimit.value > 0) increaseQuota()
            setBatchItem(item.id, { status: 'success', email: outcome.email })
            const historyId = addHistory(outcome)
            if (config.batchAutoImport) {
                const ok = await importResult(outcome, true, id)
                if (!live(id) || signal.aborted) return
                setBatchItem(item.id, { status: ok ? 'imported' : 'import_failed' })
                if (ok) markHistoryImported(historyId)
            }
            if (config.autoFetchProLink) await fetchProLink(outcome, id)
        } else {
            batchFail.value++
            setBatchItem(item.id, {
                status: 'failed',
                email: outcome.email || '',
                error: outcome.error || 'unknown'
            })
            addHistory(outcome)
            const category = classifyError(outcome.error)
            if (category === 'email_used') rememberUsedEmail(outcome.email)
            if (category === 'risk_control' && autoPauseOnRisk.value) {
                pauseBatch()
                void webhooks.triggerEvent('risk-warning', {
                    title: 'AWS 风控触发，已自动暂停',
                    message: outcome.error || '',
                    level: 'error',
                    fields: { 邮箱: outcome.email || '-', 错误: outcome.error || '' }
                })
            }
        }
        batchDone.value++
    }

    async function startBatch(retryItems) {
        if (
            !active ||
            cancelling.value ||
            importBusy.value ||
            historyImportBusy.value.size ||
            batchRunning.value ||
            config.mode === 'manual' ||
            !['idle', 'done', 'finalized'].includes(phase.value)
        )
            return
        refreshQuota()
        const remaining =
            dailyQuotaLimit.value > 0
                ? Math.max(0, dailyQuotaLimit.value - dailyQuotaUsed.value)
                : Infinity
        if (remaining === 0) {
            error.value = '今日注册配额已满'
            return
        }
        const requested = retryItems?.length
            ? retryItems
            : Array.from({ length: Math.max(1, Number(config.batchCount) || 1) }, (_, index) => ({
                  id: crypto.randomUUID(),
                  index: index + 1,
                  email: '',
                  retryCount: 0,
                  status: 'pending'
              }))
        const items = requested
            .slice(0, remaining)
            .map((item) => ({ ...item, status: 'pending', error: undefined, retryCount: 0 }))
        if (!items.length) return
        generation++
        const id = generation
        batchGeneration++
        batchStopping = false
        controller = new AbortController()
        const signal = controller.signal
        batchRunning.value = true
        batchPaused.value = false
        if (retryItems?.length) {
            batchDone.value = Math.max(0, batchDone.value - items.length)
            batchFail.value = 0
        } else {
            batchDone.value = 0
            batchSuccess.value = 0
            batchFail.value = 0
        }
        phase.value = 'running'
        result.value = null
        error.value = ''
        if (retryItems?.length) {
            const ids = new Set(items.map((item) => item.id))
            batchItems.value = [...batchItems.value.filter((item) => !ids.has(item.id)), ...items]
        } else batchItems.value = items
        outlookLines =
            config.mode === 'outlook' ||
            (config.mode === 'mixed' && config.mixedEnabledSources.includes('outlook'))
                ? shuffleOutlookLines(config.outlookData)
                : []
        limiter = rateLimitEnabled.value
            ? createRateLimiter({
                  maxPerMinute: maxPerMinute.value,
                  burst: burstSize.value,
                  backoffBaseMs: backoffBaseSec.value * 1000,
                  backoffMaxMs: backoffMaxSec.value * 1000,
                  consecutiveFailureThreshold: autoBackoff.value ? 5 : 999999
              })
            : null
        const concurrency = Math.max(
            1,
            Math.min(items.length, Number(config.batchConcurrency) || 1)
        )
        currentTaskId = tasks.createTask({
            kind: 'register-batch',
            title: retryItems?.length
                ? `重试 ${items.length} 个失败任务`
                : `批量注册 ${items.length} 个账号`,
            subtitle: `${config.mode}，并发 ${concurrency}`,
            total: items.length,
            onPause: pauseBatch,
            onResume: resumeBatch,
            onCancel: stopBatch
        })
        const taskCenterId = currentTaskId
        const running = new Set()
        const runCounts = { done: 0, success: 0, failed: 0 }
        try {
            for (let index = 0; index < items.length; index++) {
                await waitResumed(signal)
                if (signal.aborted || !live(id)) break
                if (dailyQuotaLimit.value > 0 && dailyQuotaUsed.value >= dailyQuotaLimit.value)
                    break
                if (limiter) await limiter.waitForSlot(signal)
                if (signal.aborted || !live(id)) break
                const item = items[index]
                const taskId = `batch-${item.id.slice(0, 8)}`
                taskIds.set(taskId, item.id)
                const task = (async () => {
                    try {
                        const outcome = await runBatchItem(item, taskId, signal, id)
                        if (signal.aborted || !live(id)) return
                        await finishBatchItem(item, outcome, id, signal)
                        if (signal.aborted || !live(id)) return
                        runCounts.done++
                        if (outcome?.status === 'success') runCounts.success++
                        else runCounts.failed++
                        if (limiter && outcome) limiter.reportResult(outcome.status === 'success')
                        if (currentTaskId === taskCenterId)
                            tasks.updateTask(taskCenterId, {
                                done: runCounts.done,
                                successCount: runCounts.success,
                                failedCount: runCounts.failed,
                                progress: Math.round((runCounts.done / items.length) * 100)
                            })
                    } finally {
                        taskIds.delete(taskId)
                    }
                })()
                const tracked = task.finally(() => running.delete(tracked))
                running.add(tracked)
                if (running.size >= concurrency) await Promise.race(running)
                if (index < items.length - 1 && config.batchInterval > 0)
                    await waitInterruptible(config.batchInterval * 1000, signal)
            }
            await Promise.all(running)
        } catch (cause) {
            if (live(id) && !signal.aborted) error.value = message(cause)
        } finally {
            if (active && batchGeneration > 0) {
                batchRunning.value = false
                batchPaused.value = false
                phase.value = 'idle'
                if (!signal.aborted && live(id)) {
                    tasks.completeTask(taskCenterId, {
                        successCount: runCounts.success,
                        failedCount: runCounts.failed
                    })
                    void webhooks.triggerEvent('batch-completed', {
                        title: `批量注册${retryItems?.length ? '重试' : ''}完成`,
                        message: `共 ${items.length} 个任务，成功 ${batchSuccess.value}，失败 ${batchFail.value}`,
                        level:
                            batchFail.value === 0
                                ? 'success'
                                : batchSuccess.value === 0
                                  ? 'error'
                                  : 'warn',
                        fields: {
                            模式: config.mode,
                            并发: concurrency,
                            成功: batchSuccess.value,
                            失败: batchFail.value,
                            总数: items.length
                        }
                    })
                }
            }
            if (currentTaskId === taskCenterId) currentTaskId = null
            controller = null
        }
    }

    function retryFailed(filter = 'all') {
        const items = batchItems.value.filter(
            (item) =>
                ['failed', 'import_failed'].includes(item.status) &&
                (filter === 'all' || classifyError(item.error) === filter)
        )
        if (items.length) void startBatch(items)
    }

    async function checkProton() {
        if (!active || protonChecking.value) return
        const id = generation
        protonChecking.value = true
        try {
            const response = await window.api.protonLoginStatus()
            if (live(id)) protonLoggedIn.value = Boolean(response.loggedIn)
        } catch (cause) {
            if (live(id)) error.value = message(cause)
        } finally {
            if (active) protonChecking.value = false
        }
    }

    async function openProtonLogin() {
        if (!active || protonChecking.value) return
        const id = generation
        protonChecking.value = true
        try {
            const proxy = pickProxy(false)
            const response = await window.api.protonOpenLogin(
                proxy ? injectProxySession(proxy.url) : undefined
            )
            if (live(id)) protonLoggedIn.value = Boolean(response.loggedIn)
            if (live(id) && !response.success) error.value = response.error || 'Proton 登录失败'
        } catch (cause) {
            if (live(id)) error.value = message(cause)
        } finally {
            if (active) protonChecking.value = false
        }
    }

    async function closeProton() {
        if (!active || protonChecking.value) return
        const id = generation
        protonChecking.value = true
        try {
            const response = await window.api.protonClose()
            if (live(id) && response.success) protonLoggedIn.value = false
            if (live(id) && !response.success) error.value = '关闭 Proton 失败'
        } catch (cause) {
            if (live(id)) error.value = message(cause)
        } finally {
            if (active) protonChecking.value = false
        }
    }

    function tickSchedule() {
        if (
            !active ||
            !scheduleEnabled.value ||
            config.mode === 'manual' ||
            batchRunning.value ||
            phase.value !== 'idle'
        )
            return
        const now = new Date()
        const day = todayKey(now)
        if (scheduleTriggered === day || !(scheduleWeekMask.value & (1 << now.getDay()))) return
        const [hour, minute] = scheduleTime.value.split(':').map(Number)
        if (now.getHours() !== hour || now.getMinutes() !== minute) return
        scheduleTriggered = day
        void startBatch()
    }

    function tickRate() {
        if (!active || !batchRunning.value || !limiter) return
        const snapshot = limiter.snapshot()
        rateSnapshot.value = snapshot
        if (snapshot.riskWarning && !riskWarning) {
            riskWarning = true
            if (autoPauseOnRisk.value) pauseBatch()
            void webhooks.triggerEvent('risk-warning', {
                title: '风控信号触发',
                message: `批量注册成功率降至 ${Math.round(snapshot.successRate * 100)}%`,
                level: 'warn',
                fields: {
                    成功率: `${Math.round(snapshot.successRate * 100)}%`,
                    连续失败: snapshot.consecutiveFailures
                }
            })
        } else if (!snapshot.riskWarning) riskWarning = false
    }

    onMounted(() => {
        active = true
        unlisteners.push(window.api.onRegistrationLog((entry) => addLog(entry)))
        unlisteners.push(
            window.api.onRegistrationStep(({ taskId, event }) => {
                if (!active || !taskId) return
                const itemId = taskIds.get(taskId)
                if (itemId)
                    setBatchItem(itemId, {
                        currentStep: event.name,
                        startedAt:
                            batchItems.value.find((item) => item.id === itemId)?.startedAt ||
                            event.ts ||
                            Date.now(),
                        stepStartedAt: event.ts || Date.now(),
                        email:
                            event.email ||
                            batchItems.value.find((item) => item.id === itemId)?.email,
                        exitIp:
                            event.exitIp ||
                            batchItems.value.find((item) => item.id === itemId)?.exitIp
                    })
            })
        )
        unlisteners.push(
            window.api.onRegistrationComplete((entry) => {
                if (
                    active &&
                    !batchRunning.value &&
                    phase.value === 'running' &&
                    config.mode !== 'manual'
                ) {
                    void processResult(entry, generation, 'single')
                }
            })
        )
        const id = generation
        void window.api
            .registrationStatus()
            .then((status) => {
                if (live(id) && status.inProgress && phase.value === 'idle')
                    void window.api.registrationCancel()
            })
            .catch((cause) => {
                if (live(id)) error.value = message(cause)
            })
        scheduleTimer = setInterval(tickSchedule, 60000)
        rateTimer = setInterval(tickRate, 1000)
        tickSchedule()
    })

    onUnmounted(() => {
        const hadFlow = batchRunning.value || !['idle', 'done', 'finalized'].includes(phase.value)
        const hadBatch = batchRunning.value
        active = false
        generation++
        controller?.abort()
        if (currentTaskId) tasks.cancelTask(currentTaskId)
        else if (hadFlow && !hadBatch && !cancelling.value)
            void window.api.registrationCancel().catch(() => {})
        unlisteners.forEach((stop) => stop())
        clearInterval(scheduleTimer)
        clearInterval(rateTimer)
    })

    watch(
        config,
        () => {
            writeJson(REGISTER_STORAGE.config, toIpcData(config))
            writeJson(REGISTER_STORAGE.mixedSources, config.mixedEnabledSources)
        },
        { deep: true }
    )
    watch(mixedWeights, () => writeJson(REGISTER_STORAGE.mixedWeights, toIpcData(mixedWeights)), {
        deep: true
    })
    const settings = [
        [dailyQuotaLimit, 'kiro-register-dailyquota-limit'],
        [scheduleTime, 'kiro-register-schedule-time'],
        [scheduleWeekMask, 'kiro-register-schedule-week-mask'],
        [maxPerMinute, 'kiro-register-ratelimit-max'],
        [burstSize, 'kiro-register-ratelimit-burst'],
        [backoffBaseSec, 'kiro-register-backoff-base-sec'],
        [backoffMaxSec, 'kiro-register-backoff-max-sec']
    ]
    settings.forEach(([value, key]) => watch(value, (next) => saveScalar(key, next)))
    const flags = [
        [scheduleEnabled, 'kiro-register-schedule-enabled'],
        [rateLimitEnabled, 'kiro-register-ratelimit-enabled'],
        [autoBackoff, 'kiro-register-autobackoff'],
        [autoPauseOnRisk, 'kiro-register-autopause-risk']
    ]
    flags.forEach(([value, key]) => watch(value, (next) => saveScalar(key, next ? '1' : '0')))

    return {
        config,
        mixedWeights,
        phase,
        logs,
        result,
        imported,
        email,
        otp,
        history,
        templates,
        blacklist,
        batchItems,
        batchRunning,
        batchPaused,
        batchDone,
        batchSuccess,
        batchFail,
        protonLoggedIn,
        protonChecking,
        importBusy,
        historyImportBusy,
        cancelling,
        error,
        dailyQuotaLimit,
        dailyQuotaUsed,
        scheduleEnabled,
        scheduleTime,
        scheduleWeekMask,
        rateLimitEnabled,
        maxPerMinute,
        burstSize,
        backoffBaseSec,
        backoffMaxSec,
        autoBackoff,
        autoPauseOnRisk,
        rateSnapshot,
        manualSteps,
        currentStep,
        reset,
        startManual,
        submitEmail,
        submitOtp,
        startAuto,
        cancel,
        importCurrent,
        importHistory,
        deleteHistory,
        clearHistory,
        saveTemplate,
        applyTemplate,
        deleteTemplate,
        importTemplates,
        exportTemplates,
        refreshBlacklist,
        removeBlacklistEmail,
        clearBlacklist,
        startBatch,
        retryFailed,
        pauseBatch,
        resumeBatch,
        stopBatch,
        checkProton,
        openProtonLogin,
        closeProton
    }
}
