export class ContextLimitError extends Error {
    readonly statusCode = 400
    readonly code = 'context_length_exceeded'
    readonly anthropicType = 'invalid_request_error'

    constructor() {
        super('capability_rejected: prompt_too_long. The upstream model rejected this request because its context limit was exceeded. Shorten the conversation or start a new one.')
        this.name = 'ContextLimitError'
    }
}

export class PayloadSizeLimitError extends Error {
    readonly statusCode = 413
    readonly code = 'request_too_large'
    readonly anthropicType = 'request_too_large'

    constructor(limitBytes: number) {
        super(`Request payload exceeds the configured ${limitBytes} byte limit. Shorten the request or increase the payload size limit.`)
        this.name = 'PayloadSizeLimitError'
    }
}

export class KiroHttpError extends Error {
    readonly anthropicType: string

    constructor(readonly statusCode: number, readonly body: string, readonly reason?: string) {
        super(`${statusCode === 401 || statusCode === 403 ? 'Auth' : 'API'} error ${statusCode}: ${body}`)
        this.name = 'KiroHttpError'
        this.anthropicType = ({
            400: 'invalid_request_error',
            401: 'authentication_error',
            403: 'permission_error',
            404: 'not_found_error',
            413: 'request_too_large',
            429: 'rate_limit_error'
        } as Record<number, string>)[statusCode] ?? 'api_error'
    }
}

function findReason(body: string): string | undefined {
    try {
        const parsed: unknown = JSON.parse(body)
        if (parsed && typeof parsed === 'object') {
            const data = parsed as Record<string, unknown>
            const nested = data.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : undefined
            const reason = data.reason ?? data.code ?? nested?.reason ?? nested?.code
            if (typeof reason === 'string') return reason
        }
    } catch {
        // Some upstream errors are plain text.
    }
    if (body.trim() === 'CONTENT_LENGTH_EXCEEDS_THRESHOLD') return 'CONTENT_LENGTH_EXCEEDS_THRESHOLD'
    return undefined
}

export function createKiroHttpError(statusCode: number, body: string): Error {
    const reason = findReason(body)
    if (statusCode === 400 && reason === 'CONTENT_LENGTH_EXCEEDS_THRESHOLD') return new ContextLimitError()
    return new KiroHttpError(statusCode, body, reason)
}

export function getRequestErrorDetails(error: unknown): {
    statusCode: number
    anthropicType: string
    code?: string
    message: string
} | undefined {
    if (error instanceof ContextLimitError || error instanceof PayloadSizeLimitError) {
        return { statusCode: error.statusCode, anthropicType: error.anthropicType, code: error.code, message: error.message }
    }
    if (error instanceof KiroHttpError) {
        return { statusCode: error.statusCode, anthropicType: error.anthropicType, message: error.message }
    }
    return undefined
}
