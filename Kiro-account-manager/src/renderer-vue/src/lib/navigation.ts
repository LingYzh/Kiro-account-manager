export const pageIds = [
    'home',
    'accounts',
    'machineId',
    'kiroSettings',
    'proxy',
    'kproxy',
    'proxyPool',
    'register',
    'subscription',
    'webhooks',
    'diagnose',
    'configSync',
    'logs',
    'settings',
    'about'
] as const
export type PageType = (typeof pageIds)[number]

export function isPageType(value: unknown): value is PageType {
    return typeof value === 'string' && (pageIds as readonly string[]).includes(value)
}
