import type { ProxyEntry } from '@shared/types/proxy'

export interface ProxyPoolFilters {
    text: string
    status: string
    protocol: string
    enabled: string
    latency: string
    testedWithin: string
}

export interface ProxyPoolHealth {
    total: number
    enabled: number
    alive: number
    slow: number
    dead: number
    untested: number
    testing: number
    totalUsed: number
    totalFailed: number
    totalSuccess: number
    successRate: number | null
    avgLatencyMs: number | null
    topUsed: Array<{
        id: string
        label: string
        used: number
        failed: number
        success: number
        rate: number | null
        status: ProxyEntry['status']
    }>
}

export function filterProxies(
    proxies: ProxyEntry[],
    filters: ProxyPoolFilters,
    now = Date.now()
): ProxyEntry[] {
    const hour = 60 * 60 * 1000
    const day = 24 * hour
    return proxies.filter((proxy) => {
        if (filters.status !== 'all' && proxy.status !== filters.status) return false
        if (filters.protocol !== 'all' && proxy.protocol !== filters.protocol) return false
        if (filters.enabled === 'enabled' && !proxy.enabled) return false
        if (filters.enabled === 'disabled' && proxy.enabled) return false
        const latency = proxy.latencyMs
        if (filters.latency === 'unknown' && typeof latency === 'number') return false
        if (filters.latency !== 'all' && filters.latency !== 'unknown') {
            if (typeof latency !== 'number') return false
            if (filters.latency === 'fast' && latency >= 200) return false
            if (filters.latency === 'medium' && (latency < 200 || latency >= 1000)) return false
            if (filters.latency === 'slow' && latency < 1000) return false
        }
        if (filters.testedWithin === 'never' && proxy.lastTestedAt) return false
        if (filters.testedWithin !== 'all' && filters.testedWithin !== 'never') {
            if (!proxy.lastTestedAt) return false
            const elapsed = now - proxy.lastTestedAt
            if (filters.testedWithin === '1h' && elapsed > hour) return false
            if (filters.testedWithin === '1d' && elapsed > day) return false
            if (filters.testedWithin === '7d' && elapsed > 7 * day) return false
        }
        if (filters.text) {
            const haystack = [
                proxy.host,
                String(proxy.port),
                proxy.protocol,
                proxy.username || '',
                proxy.label || '',
                proxy.lastBoundEmail || '',
                proxy.url || '',
                (proxy.tags || []).join(' '),
                proxy.source || ''
            ]
                .join(' ')
                .toLowerCase()
            if (!haystack.includes(filters.text.toLowerCase().trim())) return false
        }
        return true
    })
}

export function computePoolHealth(proxies: ProxyEntry[]): ProxyPoolHealth {
    const stats: ProxyPoolHealth = {
        total: proxies.length,
        enabled: 0,
        alive: 0,
        slow: 0,
        dead: 0,
        untested: 0,
        testing: 0,
        totalUsed: 0,
        totalFailed: 0,
        totalSuccess: 0,
        successRate: null,
        avgLatencyMs: null,
        topUsed: []
    }
    let latencySum = 0
    let latencyCount = 0
    for (const proxy of proxies) {
        if (proxy.enabled) stats.enabled++
        if (proxy.status === 'alive') stats.alive++
        else if (proxy.status === 'slow') stats.slow++
        else if (proxy.status === 'dead') stats.dead++
        else if (proxy.status === 'untested') stats.untested++
        else if (proxy.status === 'testing') stats.testing++
        stats.totalUsed += proxy.usedCount
        stats.totalFailed += proxy.failCount
        if (proxy.latencyMs && (proxy.status === 'alive' || proxy.status === 'slow')) {
            latencySum += proxy.latencyMs
            latencyCount++
        }
    }
    stats.totalSuccess = Math.max(0, stats.totalUsed - stats.totalFailed)
    stats.successRate = stats.totalUsed > 0 ? stats.totalSuccess / stats.totalUsed : null
    stats.avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : null
    stats.topUsed = proxies
        .slice()
        .filter((proxy) => proxy.usedCount > 0)
        .sort((a, b) => b.usedCount - a.usedCount)
        .slice(0, 5)
        .map((proxy) => {
            const success = Math.max(0, proxy.usedCount - proxy.failCount)
            return {
                id: proxy.id,
                label: proxy.label || `${proxy.protocol}://${proxy.host}:${proxy.port}`,
                used: proxy.usedCount,
                failed: proxy.failCount,
                success,
                rate: proxy.usedCount > 0 ? success / proxy.usedCount : null,
                status: proxy.status
            }
        })
    return stats
}
