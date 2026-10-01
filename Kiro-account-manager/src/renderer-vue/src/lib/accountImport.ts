import { splitCredentialLine } from '@shared/lib/utils'

export interface ImportCredential {
    refreshToken: string
    password?: string
    clientId?: string
    clientSecret?: string
    region?: string
    authMethod?: 'IdC' | 'social'
    provider?: string
    _email?: string
}

export interface ParsedCredentialInput {
    credentials: ImportCredential[]
    kami: boolean
}

export function parseCredentialInput(input: string): ParsedCredentialInput {
    const trimmed = input.trim()
    if (!trimmed) return { credentials: [], kami: false }
    try {
        const parsed: unknown = JSON.parse(trimmed)
        const items = Array.isArray(parsed) ? parsed : [parsed]
        return {
            credentials: items.filter(
                (item): item is ImportCredential =>
                    typeof item === 'object' && item !== null && !Array.isArray(item)
            ),
            kami: false
        }
    } catch {
        const lines = trimmed.split('\n').filter((line) => line.trim() && !line.startsWith('#'))
        const credentials = lines
            .map((line) => {
                const parts = splitCredentialLine(line)
                const password = parts[1]?.trim()
                const clientId = parts[3]?.trim() || undefined
                const clientSecret = parts[4]?.trim() || undefined
                return {
                    _email: parts[0]?.trim() || '',
                    password: password && password !== 'no_password' ? password : undefined,
                    refreshToken: parts[2]?.trim() || '',
                    clientId,
                    clientSecret,
                    provider:
                        parts[5]?.trim() || (!clientId && !clientSecret ? 'Google' : 'BuilderId')
                }
            })
            .filter((item) => item.refreshToken)
        return { credentials, kami: true }
    }
}

export function restoreFailedCredentials(
    credentials: ImportCredential[],
    failedIndices: number[],
    kami: boolean
): string {
    const failed = failedIndices.map((index) => credentials[index])
    if (!kami) return JSON.stringify(failed, null, 2)
    return failed
        .map((item) =>
            [
                item._email || '',
                item.password || '',
                item.refreshToken,
                item.clientId || '',
                item.clientSecret || '',
                item.provider || ''
            ].join('----')
        )
        .join('\n')
}
