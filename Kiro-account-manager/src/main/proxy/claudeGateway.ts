import { createHash } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

export interface ClaudeGatewayContext {
    requestHeaders: Record<string, string | string[]>
    version: string | undefined
    beta: string | undefined
    sessionId: string | undefined
    agentId: string | undefined
    parentAgentId: string | undefined
    requestClass: string | undefined
    agentType: string | undefined
    promptId: string | undefined
    compaction: string | undefined
    contextCompacted: string | undefined
    isClaudeCode: boolean
    preserveHistory: boolean
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value
}

export function captureClaudeGatewayContext(headers: IncomingHttpHeaders): ClaudeGatewayContext {
    const normalizedHeaders = new Map<string, string | string[]>()
    let hasClaudeCodeHeader = false

    for (const [rawName, value] of Object.entries(headers)) {
        const name = rawName.toLowerCase()
        if (name.startsWith('x-claude-code-')) {
            hasClaudeCodeHeader = true
        }

        if ((name.startsWith('anthropic-') || name.startsWith('x-claude-code-')) && value !== undefined) {
            normalizedHeaders.set(name, Array.isArray(value) ? [...value] : value)
        }
    }

    const header = (name: string): string | undefined => firstHeaderValue(normalizedHeaders.get(name))
    const userAgent = firstHeaderValue(headers['user-agent'] ?? headers['User-Agent'])
    const isClaudeCode = hasClaudeCodeHeader || /claude-(?:cli|code)\//i.test(userAgent ?? '')

    return {
        requestHeaders: Object.fromEntries(normalizedHeaders),
        version: header('anthropic-version'),
        beta: header('anthropic-beta'),
        sessionId: header('x-claude-code-session-id'),
        agentId: header('x-claude-code-agent-id'),
        parentAgentId: header('x-claude-code-parent-agent-id'),
        requestClass: header('x-claude-code-request-class'),
        agentType: header('x-claude-code-agent-type'),
        promptId: header('x-claude-code-prompt-id'),
        compaction: header('x-claude-code-compaction'),
        contextCompacted: header('x-claude-code-context-compacted'),
        isClaudeCode,
        preserveHistory: isClaudeCode
    }
}

export function buildClaudeConversationIdentity(
    context: ClaudeGatewayContext,
    fallbackHint: string | undefined,
    apiKeyId: string | undefined
): string | undefined {
    const session = context.sessionId || fallbackHint
    if (!session) return undefined

    const requestClass = context.requestClass
    const normalizedRequestClass = requestClass?.toLowerCase()
    const lane = !requestClass ||
        normalizedRequestClass === 'main' ||
        normalizedRequestClass === 'subagent' ||
        normalizedRequestClass === 'workflow'
        ? 'conversation'
        : requestClass

    const digest = createHash('sha256')
        .update(JSON.stringify([apiKeyId ?? 'default', session, context.agentId ?? '', lane]))
        .digest('hex')

    return `claude:${digest}`
}

export function cloneClaudeRequest<T>(request: T): T {
    return structuredClone(request)
}
