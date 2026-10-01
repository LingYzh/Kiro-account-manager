import type { AccountExportData, AccountImportItem } from '@shared/types/account'
import { splitCredentialLine } from '@shared/lib/utils'

export type ParsedAccountFile =
    | { kind: 'export'; data: AccountExportData }
    | { kind: 'accounts'; source: 'csv' | 'kami' | 'txt'; items: AccountImportItem[] }

export type AccountImportParseErrorCode =
    | 'invalid-json'
    | 'empty-csv'
    | 'empty-csv-accounts'
    | 'empty-kami-accounts'
    | 'empty-txt-accounts'
    | 'unsupported-format'

export class AccountImportParseError extends Error {
    constructor(
        public readonly code: AccountImportParseErrorCode,
        public readonly format?: string
    ) {
        super(code)
        this.name = 'AccountImportParseError'
    }
}

export function parseCsvLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let index = 0; index < line.length; index++) {
        const char = line[index]
        if (char === '"') {
            if (inQuotes && line[index + 1] === '"') {
                current += '"'
                index++
            } else {
                inQuotes = !inQuotes
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim())
            current = ''
        } else {
            current += char
        }
    }
    result.push(current.trim())
    return result
}

export function parseAccountFile(
    content: string,
    format: string,
    currentGroupId?: string
): ParsedAccountFile {
    if (format === 'json') {
        let data: unknown
        try {
            data = JSON.parse(content)
        } catch {
            throw new AccountImportParseError('invalid-json')
        }
        if (
            !data ||
            typeof data !== 'object' ||
            !('version' in data) ||
            !('accounts' in data) ||
            !data.version ||
            !data.accounts
        ) {
            throw new AccountImportParseError('invalid-json')
        }
        return { kind: 'export', data: data as AccountExportData }
    }

    if (format === 'csv') {
        const lines = content.split('\n').filter((line) => line.trim())
        if (lines.length < 2) throw new AccountImportParseError('empty-csv')
        const items = lines
            .slice(1)
            .map((line): AccountImportItem => {
                const cols = parseCsvLine(line)
                return {
                    email: cols[0] || '',
                    nickname: cols[1] || undefined,
                    idp: cols[2] || 'Google',
                    refreshToken: cols[3] || '',
                    clientId: cols[4] || '',
                    clientSecret: cols[5] || '',
                    region: cols[6] || 'us-east-1',
                    groupId: currentGroupId
                }
            })
            .filter((item) => item.email && item.refreshToken)
        if (!items.length) throw new AccountImportParseError('empty-csv-accounts')
        return { kind: 'accounts', source: 'csv', items }
    }

    if (format === 'txt') {
        const lines = content.split('\n').filter((line) => line.trim() && !line.startsWith('#'))
        const isKamiFormat = lines.some((line) => {
            if (line.includes('----')) return true
            if (!line.includes('\t') && !/\s{2,}/.test(line)) return false
            return splitCredentialLine(line).length >= 5
        })
        if (isKamiFormat) {
            const items = lines
                .map((line): AccountImportItem => {
                    const parts = splitCredentialLine(line)
                    const rawPassword = parts[1]?.trim()
                    const clientId = parts[3]?.trim() || undefined
                    const clientSecret = parts[4]?.trim() || undefined
                    const rawIdp = parts[5]?.trim()
                    return {
                        email: parts[0]?.trim() || '',
                        password:
                            rawPassword && rawPassword !== 'no_password' ? rawPassword : undefined,
                        refreshToken: parts[2]?.trim() || '',
                        clientId,
                        clientSecret,
                        idp: rawIdp || (!clientId && !clientSecret ? 'Google' : 'BuilderId'),
                        groupId: currentGroupId
                    }
                })
                .filter((item) => item.email && item.refreshToken)
            if (!items.length) throw new AccountImportParseError('empty-kami-accounts')
            return { kind: 'accounts', source: 'kami', items }
        }
        const items = lines
            .map((line): AccountImportItem => {
                const parts = line.includes('|') ? line.split('|') : line.split(',')
                return {
                    email: parts[0]?.trim() || '',
                    refreshToken: parts[1]?.trim() || '',
                    nickname: parts[2]?.trim() || undefined,
                    idp: parts[3]?.trim() || 'Google',
                    groupId: currentGroupId
                }
            })
            .filter((item) => item.email && item.refreshToken)
        if (!items.length) throw new AccountImportParseError('empty-txt-accounts')
        return { kind: 'accounts', source: 'txt', items }
    }
    throw new AccountImportParseError('unsupported-format', format)
}
