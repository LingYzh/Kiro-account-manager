export // ============================================
// 账号管理 Store
// ============================================
// 生成随机 64 位十六进制设备 ID
function generateRandomMachineId(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

export function isBannedAccountError(error?: string): boolean {
    if (!error) return false
    const lowerError = error.toLowerCase()
    const hasSuspendedSignal =
        lowerError.includes('accountsuspendedexception') ||
        lowerError.includes('account suspended') ||
        lowerError.includes('temporarily_suspended') ||
        lowerError.includes('temporarily suspended') ||
        (lowerError.includes('user id is') && lowerError.includes('suspended')) ||
        lowerError.includes('账户已封禁') ||
        lowerError.includes('已封禁') ||
        /\b423\b/.test(lowerError)
    if (hasSuspendedSignal) return true
    if (
        lowerError.includes('fetch failed') ||
        lowerError.includes('network') ||
        lowerError.includes('token expired') ||
        lowerError.includes('token 过期') ||
        lowerError.includes('刷新失败') ||
        lowerError.includes('unauthorizedexception')
    ) {
        return false
    }
    return false
}
