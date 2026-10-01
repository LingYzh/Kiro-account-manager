import type { Account, AccountExportData } from '@shared/types/account'

export type AccountExportFormat = 'json' | 'oidc' | 'txt' | 'csv' | 'kami' | 'clipboard'

export function formatAccountExport(
    format: AccountExportFormat,
    accounts: Account[],
    includeCredentials: boolean,
    exportData?: AccountExportData
): string {
    switch (format) {
        case 'json': {
            if (!exportData) throw new Error('JSON export data is required')
            const data = includeCredentials
                ? exportData
                : {
                      ...exportData,
                      accounts: exportData.accounts.map((account) => ({
                          ...account,
                          credentials: {
                              ...account.credentials,
                              accessToken: '',
                              refreshToken: '',
                              csrfToken: ''
                          }
                      }))
                  }
            return JSON.stringify(data, null, 2)
        }
        case 'oidc':
            return JSON.stringify(
                accounts.map((account) => {
                    const item: Record<string, string> = {
                        email: account.email,
                        refreshToken: account.credentials?.refreshToken || '',
                        provider: account.idp || 'BuilderId'
                    }
                    if (account.password) item.password = account.password
                    if (account.credentials?.clientId) item.clientId = account.credentials.clientId
                    if (account.credentials?.clientSecret)
                        item.clientSecret = account.credentials.clientSecret
                    return item
                }),
                null,
                2
            )
        case 'txt':
            return includeCredentials
                ? accounts
                      .map((account) =>
                          [
                              account.email,
                              account.credentials?.refreshToken || '',
                              account.nickname || '',
                              account.idp || 'Google'
                          ].join(',')
                      )
                      .join('\n')
                : accounts
                      .map((account) =>
                          [
                              `邮箱: ${account.email}`,
                              account.nickname ? `昵称: ${account.nickname}` : null,
                              account.idp ? `登录方式: ${account.idp}` : null,
                              account.subscription?.title
                                  ? `订阅: ${account.subscription.title}`
                                  : null,
                              account.usage
                                  ? `用量: ${account.usage.current ?? 0}/${account.usage.limit ?? 0}`
                                  : null
                          ]
                              .filter(Boolean)
                              .join('\n')
                      )
                      .join('\n\n---\n\n')
        case 'csv': {
            const headers = includeCredentials
                ? ['邮箱', '昵称', '登录方式', 'RefreshToken', 'ClientId', 'ClientSecret', 'Region']
                : ['邮箱', '昵称', '登录方式', '订阅类型', '订阅标题', '已用量', '总额度']
            const rows = accounts.map((account) =>
                includeCredentials
                    ? [
                          account.email,
                          account.nickname || '',
                          account.idp || '',
                          account.credentials?.refreshToken || '',
                          account.credentials?.clientId || '',
                          account.credentials?.clientSecret || '',
                          account.credentials?.region || 'us-east-1'
                      ]
                    : [
                          account.email,
                          account.nickname || '',
                          account.idp || '',
                          account.subscription?.type || '',
                          account.subscription?.title || '',
                          String(account.usage?.current ?? ''),
                          String(account.usage?.limit ?? '')
                      ]
            )
            return (
                '\ufeff' +
                [headers, ...rows]
                    .map((row) =>
                        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
                    )
                    .join('\n')
            )
        }
        case 'kami':
            return accounts
                .map((account) =>
                    [
                        account.email,
                        account.password || 'no_password',
                        account.credentials?.refreshToken || '',
                        account.credentials?.clientId || '',
                        account.credentials?.clientSecret || '',
                        account.idp || 'BuilderId'
                    ].join('----')
                )
                .join('\n')
        case 'clipboard':
            return includeCredentials
                ? accounts
                      .map(
                          (account) => `${account.email},${account.credentials?.refreshToken || ''}`
                      )
                      .join('\n')
                : accounts
                      .map(
                          (account) =>
                              `${account.email}${account.nickname ? ` (${account.nickname})` : ''} - ${account.subscription?.title || '未知订阅'}`
                      )
                      .join('\n')
    }
}
