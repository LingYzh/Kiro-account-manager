import { defineStore, getActivePinia } from 'pinia'
import { ref } from 'vue'

/**
 * Webhook 通知中心
 *
 * 用于把关键事件（批量完成、风控触发、单账号注册成功/失败等）推送到外部 IM。
 * 内置常见 IM 的消息模板：钉钉 / 企微 / Telegram / Discord / 自定义 JSON。
 *
 * 消息体构造（框架无关）已迁移到 src/renderer-shared/lib/webhookPayload.ts（供 Vue 版共用）；
 * 本文件重导出类型/常量保持旧引用不变，只保留 fetch 发送与本地限速逻辑。
 */
import {
    buildTelegramUrl,
    buildWebhookBody,
    type WebhookEntry,
    type WebhookEvent,
    type WebhookMessage
} from '@shared/lib/webhookPayload'
export {
    ALL_WEBHOOK_EVENTS,
    type WebhookEntry,
    type WebhookEvent,
    type WebhookKind,
    type WebhookMessage
} from '@shared/lib/webhookPayload'
export const useWebhookStore = defineStore('kam-webhooks', () => {
    const pinia = getActivePinia()!
    const STORAGE_KEY = 'kiro-webhooks'
    // ==================== Webhook 发送实现 ====================
    /** C9: 每个 webhook 的最近发送时间戳队列（用于本地速率限制） */
    const sendTimestamps = new Map<string, number[]>()
    const MAX_PER_MINUTE = 20 // 每个 webhook 最多每分钟 20 条

    const RETRY_COUNT = 3
    const RETRY_DELAY_BASE_MS = 1500 // 指数退避基数

    /**
     * 检查并记录速率：超过阈值时返回 false，调用方应跳过本次发送
     */
    function checkAndRecordRate(webhookId: string): boolean {
        const now = Date.now()
        const arr = sendTimestamps.get(webhookId) || []
        // 清理 1 分钟外
        const filtered = arr.filter((t) => now - t < 60000)
        if (filtered.length >= MAX_PER_MINUTE) {
            sendTimestamps.set(webhookId, filtered)
            return false
        }
        filtered.push(now)
        sendTimestamps.set(webhookId, filtered)
        return true
    }
    /**
     * 按 webhook 类型构造消息体并 POST（含重试 + 速率限制）
     * 网络错误不会抛到调用方（仅 console.warn），避免影响主业务流程
     */
    async function sendWebhook(webhook: WebhookEntry, payload: WebhookMessage): Promise<void> {
        // C9: 速率限制
        if (!checkAndRecordRate(webhook.id)) {
            console.warn(
                `[Webhook] ${webhook.kind} ${webhook.label || webhook.id} rate limit exceeded (>${MAX_PER_MINUTE}/min), drop`
            )
            return
        }
        const body = buildWebhookBody(webhook, payload)
        const url = webhook.kind === 'telegram' ? buildTelegramUrl(webhook) : webhook.url
        // C9: 重试逻辑（指数退避）
        let lastError: unknown
        for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
            if (attempt > 0) {
                const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1)
                await new Promise((resolve) => setTimeout(resolve, delay))
                console.log(
                    `[Webhook] Retry ${attempt}/${RETRY_COUNT} for ${webhook.kind} ${webhook.label || webhook.id}`
                )
            }
            try {
                const controller = new AbortController()
                const timer = setTimeout(() => controller.abort(), 8000)
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal
                })
                clearTimeout(timer)
                if (resp.ok) {
                    if (attempt > 0) {
                        console.log(
                            `[Webhook] ${webhook.kind} ${webhook.label || webhook.id} succeeded on retry ${attempt}`
                        )
                    }
                    return
                }
                // 4xx 客户端错误（除 408/429）不重试
                if (
                    resp.status >= 400 &&
                    resp.status < 500 &&
                    resp.status !== 408 &&
                    resp.status !== 429
                ) {
                    console.warn(
                        `[Webhook] ${webhook.kind} ${webhook.label || webhook.id} HTTP ${resp.status} (no retry)`
                    )
                    return
                }
                lastError = new Error(`HTTP ${resp.status}`)
            } catch (err) {
                lastError = err
            }
        }
        console.warn(
            `[Webhook] ${webhook.kind} ${webhook.label || webhook.id} failed after ${RETRY_COUNT} retries:`,
            lastError
        )
    }
    const webhooks = ref<Map<string, WebhookEntry>>(new Map())
    function addWebhook(input: Omit<WebhookEntry, 'id' | 'createdAt'>): string {
        const id = crypto.randomUUID()
        const entry: WebhookEntry = {
            ...input,
            id,
            createdAt: Date.now()
        }
        {
            const state = {
                webhooks: useWebhookStore(pinia).webhooks
            }
            const next = new Map(state.webhooks)
            next.set(id, entry)
            const changes: {
                webhooks: Map<string, WebhookEntry>
            } = { webhooks: next }
            useWebhookStore(pinia).$patch((state) => {
                state.webhooks = changes.webhooks
            })
        }
        useWebhookStore(pinia).saveToStorage()
        return id
    }
    function updateWebhook(id: string, updates: Partial<WebhookEntry>): void {
        {
            const state = {
                webhooks: useWebhookStore(pinia).webhooks
            }
            const next = new Map(state.webhooks)
            const existing = next.get(id)
            if (existing) next.set(id, { ...existing, ...updates })
            const changes: {
                webhooks: Map<string, WebhookEntry>
            } = { webhooks: next }
            useWebhookStore(pinia).$patch((state) => {
                state.webhooks = changes.webhooks
            })
        }
        useWebhookStore(pinia).saveToStorage()
    }
    function removeWebhook(id: string): void {
        {
            const state = {
                webhooks: useWebhookStore(pinia).webhooks
            }
            const next = new Map(state.webhooks)
            next.delete(id)
            const changes: {
                webhooks: Map<string, WebhookEntry>
            } = { webhooks: next }
            useWebhookStore(pinia).$patch((state) => {
                state.webhooks = changes.webhooks
            })
        }
        useWebhookStore(pinia).saveToStorage()
    }
    function toggleWebhook(id: string): void {
        {
            const state = {
                webhooks: useWebhookStore(pinia).webhooks
            }
            const next = new Map(state.webhooks)
            const existing = next.get(id)
            if (existing) next.set(id, { ...existing, enabled: !existing.enabled })
            const changes: {
                webhooks: Map<string, WebhookEntry>
            } = { webhooks: next }
            useWebhookStore(pinia).$patch((state) => {
                state.webhooks = changes.webhooks
            })
        }
        useWebhookStore(pinia).saveToStorage()
    }
    async function triggerEvent(event: WebhookEvent, payload: WebhookMessage): Promise<void> {
        const webhooks = Array.from(useWebhookStore(pinia).webhooks.values()).filter(
            (w) => w.enabled && w.events.includes(event)
        )
        if (webhooks.length === 0) return
        await Promise.allSettled(webhooks.map((w) => sendWebhook(w, payload)))
    }
    async function testWebhook(id: string): Promise<{
        success: boolean
        error?: string
    }> {
        const webhook = useWebhookStore(pinia).webhooks.get(id)
        if (!webhook) return { success: false, error: 'Webhook \u4E0D\u5B58\u5728' }
        try {
            await sendWebhook(webhook, {
                title: '\uD83E\uDDEA \u6D4B\u8BD5\u901A\u77E5',
                message:
                    '\u8FD9\u662F\u6765\u81EA Kiro \u8D26\u53F7\u7BA1\u7406\u5668\u7684\u6D4B\u8BD5\u6D88\u606F\u3002\u5982\u679C\u4F60\u770B\u5230\u8FD9\u6761\u6D88\u606F\uFF0C\u8BF4\u660E Webhook \u914D\u7F6E\u6B63\u786E\u3002',
                level: 'info',
                fields: { 时间: new Date().toLocaleString('zh-CN') }
            })
            return { success: true }
        } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
    }
    function loadFromStorage(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY)
            if (!raw) return
            const arr = JSON.parse(raw) as WebhookEntry[]
            if (!Array.isArray(arr)) return
            const map = new Map<string, WebhookEntry>()
            for (const w of arr) map.set(w.id, w)
            {
                const changes: {
                    webhooks: Map<string, WebhookEntry>
                } = { webhooks: map }
                useWebhookStore(pinia).$patch((state) => {
                    state.webhooks = changes.webhooks
                })
            }
        } catch (err) {
            console.warn('[Webhook] Load failed:', err)
        }
    }
    function saveToStorage(): void {
        try {
            const arr = Array.from(useWebhookStore(pinia).webhooks.values())
            localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
        } catch (err) {
            console.warn('[Webhook] Save failed:', err)
        }
    }

    return {
        webhooks,
        addWebhook,
        updateWebhook,
        removeWebhook,
        toggleWebhook,
        triggerEvent,
        testWebhook,
        loadFromStorage,
        saveToStorage
    }
})
