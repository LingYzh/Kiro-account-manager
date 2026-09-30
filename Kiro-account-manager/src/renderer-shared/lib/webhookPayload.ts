/**
 * Webhook 消息体构造（框架无关部分）— 供 store/webhooks.ts 共用
 *
 * 注意：`sendWebhook` 的 fetch 请求与本地速率限制逻辑依赖 store 内部状态，
 * 未移入本文件，仍留在 src/renderer/src/store/webhooks.ts。
 */

export type WebhookKind = 'dingtalk' | 'wechat-work' | 'telegram' | 'discord' | 'feishu' | 'custom'

export interface WebhookEntry {
    id: string
    kind: WebhookKind
    url: string
    label?: string
    enabled: boolean
    /** Telegram bot 模式需要 chat_id */
    telegramChatId?: string
    /** 自定义模式的 JSON 模板，{{title}} {{message}} {{level}} 占位符 */
    customTemplate?: string
    /** 订阅哪些事件 */
    events: WebhookEvent[]
    createdAt: number
}

export type WebhookEvent =
    | 'batch-completed'      // 批量任务完成
    | 'batch-error'          // 批量任务严重错误
    | 'risk-warning'         // 风控警告触发
    | 'account-banned'       // 账号被封禁
    | 'register-success'     // 单账号注册成功
    | 'register-failed'      // 单账号注册失败
    | 'token-expired'        // Token 过期/刷新失败

export const ALL_WEBHOOK_EVENTS: { value: WebhookEvent; label: string; labelEn: string }[] = [
    { value: 'batch-completed', label: '批量任务完成', labelEn: 'Batch completed' },
    { value: 'batch-error', label: '批量任务严重错误', labelEn: 'Batch error' },
    { value: 'risk-warning', label: '风控警告触发', labelEn: 'Risk warning' },
    { value: 'account-banned', label: '账号被封禁', labelEn: 'Account banned' },
    { value: 'register-success', label: '注册成功（单账号）', labelEn: 'Register success' },
    { value: 'register-failed', label: '注册失败（单账号）', labelEn: 'Register failed' },
    { value: 'token-expired', label: 'Token 过期/刷新失败', labelEn: 'Token expired' }
]

export interface WebhookMessage {
    title: string
    message: string
    level: 'info' | 'warn' | 'error' | 'success'
    /** 可选的额外字段（追加到 message 后） */
    fields?: Record<string, string | number>
}

/** Telegram 的 URL 直接是 https://api.telegram.org/bot<token>/sendMessage */
export function buildTelegramUrl(webhook: WebhookEntry): string {
    return webhook.url.endsWith('/sendMessage') ? webhook.url : `${webhook.url.replace(/\/$/, '')}/sendMessage`
}

export function buildWebhookBody(webhook: WebhookEntry, payload: WebhookMessage): unknown {
    const icon = ({ info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅' } as const)[payload.level]
    const fieldsText = payload.fields
        ? '\n' + Object.entries(payload.fields).map(([k, v]) => `**${k}**: ${v}`).join('\n')
        : ''
    const plainFields = payload.fields
        ? '\n' + Object.entries(payload.fields).map(([k, v]) => `${k}: ${v}`).join('\n')
        : ''
    const fullText = `${icon} ${payload.title}\n\n${payload.message}${plainFields}`

    switch (webhook.kind) {
        case 'dingtalk':
            // 钉钉机器人 markdown
            return {
                msgtype: 'markdown',
                markdown: {
                    title: payload.title,
                    text: `### ${icon} ${payload.title}\n\n${payload.message}${fieldsText}`
                }
            }
        case 'wechat-work':
            // 企业微信机器人 markdown
            return {
                msgtype: 'markdown',
                markdown: {
                    content: `## ${icon} ${payload.title}\n\n${payload.message}${fieldsText}`
                }
            }
        case 'feishu':
            // 飞书机器人 text
            return {
                msg_type: 'text',
                content: { text: fullText }
            }
        case 'telegram':
            return {
                chat_id: webhook.telegramChatId,
                text: fullText,
                parse_mode: 'Markdown'
            }
        case 'discord':
            // Discord webhook
            return {
                username: 'Kiro Account Manager',
                embeds: [{
                    title: `${icon} ${payload.title}`,
                    description: payload.message,
                    color: payload.level === 'error' ? 0xff0000
                        : payload.level === 'warn' ? 0xffaa00
                        : payload.level === 'success' ? 0x00ff00
                        : 0x4a9eff,
                    fields: payload.fields
                        ? Object.entries(payload.fields).map(([name, value]) => ({ name, value: String(value), inline: true }))
                        : undefined,
                    timestamp: new Date().toISOString()
                }]
            }
        case 'custom':
        default: {
            if (webhook.customTemplate) {
                // 简易模板替换
                try {
                    const tpl = webhook.customTemplate
                        .replace(/\{\{title\}\}/g, escapeJsonString(payload.title))
                        .replace(/\{\{message\}\}/g, escapeJsonString(payload.message))
                        .replace(/\{\{level\}\}/g, payload.level)
                        .replace(/\{\{icon\}\}/g, icon)
                    return JSON.parse(tpl)
                } catch {
                    // 模板解析失败：退回简单 JSON
                }
            }
            return {
                title: payload.title,
                message: payload.message,
                level: payload.level,
                fields: payload.fields,
                timestamp: new Date().toISOString()
            }
        }
    }
}

export function escapeJsonString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
}
