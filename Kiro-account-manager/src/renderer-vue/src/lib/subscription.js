/** The preflight rule is intentionally stricter than the FREE batch filter. */
export function checkUpgradeEligibility(account) {
    if (!account.credentials?.accessToken) return { eligible: false, reason: 'no-token' }
    const type = (account.subscription?.type || '').toUpperCase()
    const title = (account.subscription?.title || '').toUpperCase()
    const isFree = type.includes('FREE') || title.includes('FREE') || (!type && !title)
    const paid = ['PRO', 'ENTERPRISE', 'TEAMS'].some(
        (tier) => type.includes(tier) || title.includes(tier)
    )
    if (paid)
        return {
            eligible: false,
            reason: 'already-pro',
            detail: account.subscription?.title || account.subscription?.type
        }
    if (!isFree)
        return {
            eligible: false,
            reason: 'unknown-status',
            detail: account.subscription?.title || account.subscription?.type || '未检测'
        }
    const lastError = (account.lastError || '').toLowerCase()
    if (
        account.status === 'error' &&
        ['suspended', '封禁', 'temporarily'].some((part) => lastError.includes(part))
    ) {
        return { eligible: false, reason: 'banned', detail: account.lastError }
    }
    const upgradeCap = account.subscription?.upgradeCapability
    if (upgradeCap?.toUpperCase().includes('NOT'))
        return { eligible: false, reason: 'cant-upgrade', detail: upgradeCap }
    return { eligible: true, reason: 'ok' }
}

export function isFreeForBatch(account) {
    const type = (account.subscription?.type || '').toUpperCase()
    const title = (account.subscription?.title || '').toUpperCase()
    return (
        Boolean(account.credentials?.accessToken) &&
        (type.includes('FREE') || title.includes('FREE') || (!type && !title))
    )
}

export function isSubscribed(account) {
    if (!account.credentials?.accessToken) return false
    const type = (account.subscription?.type || '').toUpperCase()
    const title = (account.subscription?.title || '').toUpperCase()
    return ['PRO', 'ENTERPRISE', 'TEAMS'].some(
        (tier) => type.includes(tier) || title.includes(tier)
    )
}

export function parseImportedLinks(text) {
    const out = []
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) continue
        const match = line.match(/https?:\/\/[^\s,|]+/i)
        if (!match || match.index === undefined) continue
        const url = match[0].replace(/[)\]}>.,;'"]+$/, '')
        const prefix = line.slice(0, match.index).trim()
        const email = prefix.match(/[^\s,|<>"']+@[^\s,|<>"']+\.[^\s,|<>"']+/)?.[0] || ''
        out.push({ email, url })
    }
    return out
}

export function subscriptionUrlArgs(account, planType) {
    return [
        account.credentials.accessToken,
        planType,
        account.credentials?.region,
        account.profileArn,
        account.machineId,
        account.credentials?.provider || account.idp,
        account.credentials?.authMethod,
        account.id
    ]
}

export function subscriptionAccountArgs(account) {
    const [, , ...rest] = subscriptionUrlArgs(account, undefined)
    return [account.credentials.accessToken, ...rest]
}

export function overageArgs(account, state) {
    return subscriptionUrlArgs(account, state)
}
