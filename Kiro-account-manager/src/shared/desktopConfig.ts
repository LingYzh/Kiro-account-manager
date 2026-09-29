import { toClaudeClientModelId } from './modelIdentity'

export type DesktopModelFamily = 'opus' | 'sonnet' | 'haiku'

export interface DesktopModelRoute {
    id: string
    family: DesktopModelFamily
    label: string
    modelId: string
}

export interface DesktopConfigInput {
    routes: DesktopModelRoute[]
    defaultRouteId: string
}

export const DESKTOP_GATEWAY_PREFIX = '/claude-desktop'

export interface DesktopModelOption {
    id: string
    name?: string
}

// Route IDs are client-facing compatibility aliases, never upstream capability declarations.
export const DESKTOP_ROLE_IDS: Record<DesktopModelFamily, string> = {
    opus: 'claude-opus-4-6',
    sonnet: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5'
}

export function latestClaudeModel(models: DesktopModelOption[], family: DesktopModelFamily): string {
    function version(model: DesktopModelOption): number[] | null {
        const id = model.id.toLowerCase().replace(/_/g, '-').replace(/\./g, '-')
        const match = id.match(new RegExp(`^claude-${family}-(\\d+)(?:-(\\d{1,2})(?:-|$))?`))
            || id.match(new RegExp(`^claude-(\\d+)(?:-(\\d{1,2}))?-${family}(?:-|$)`))
        return match ? [Number(match[1]), Number(match[2] || 0)] : null
    }
    return models.filter(model => version(model)).sort((a, b) => {
        const av = version(a)!
        const bv = version(b)!
        const aInternal = a.id.includes('_') ? 1 : 0
        const bInternal = b.id.includes('_') ? 1 : 0
        return bv[0] - av[0] || bv[1] - av[1] || aInternal - bInternal || a.id.localeCompare(b.id)
    })[0]?.id || ''
}

// Stable route keys remain independent of the client model identity. Claude targets
// advertise their real version; non-Claude targets retain the explicit tier alias.
export function desktopClientModelId(route: DesktopModelRoute): string {
    return /^claude-/i.test(route.modelId) ? toClaudeClientModelId(route.modelId) : route.id
}

// Display names describe the target model, independently of the client routing alias.
export function desktopModelName(modelId: string): string {
    const id = toClaudeClientModelId(modelId)
    const modern = id.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i)
    const legacy = id.match(/^claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)(?:-\d{8})?(\[1m\])?$/i)
    if (modern || legacy) {
        const family = modern ? modern[1] : legacy![3]
        const major = modern ? modern[2] : legacy![1]
        const minor = modern ? modern[3] : legacy![2]
        const context = (modern || legacy)![4] ? ' [1m]' : ''
        return `Claude ${family[0].toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? `.${minor}` : ''}${context}`
    }
    return modelId.split(/[-_]/).filter(Boolean).map(part => {
        if (/^(gpt|glm|api)$/i.test(part)) return part.toUpperCase()
        if (/^deepseek$/i.test(part)) return 'DeepSeek'
        if (/^minimax$/i.test(part)) return 'MiniMax'
        return part[0].toUpperCase() + part.slice(1)
    }).join(' ')
}

export function defaultDesktopRoutes(models: DesktopModelOption[]): DesktopConfigInput {
    return {
        routes: (['opus', 'sonnet', 'haiku'] as const).map(family => ({
            id: DESKTOP_ROLE_IDS[family], family,
            label: desktopModelName(latestClaudeModel(models, family)),
            modelId: latestClaudeModel(models, family)
        })),
        defaultRouteId: DESKTOP_ROLE_IDS.sonnet
    }
}

export function validateDesktopInput(input: DesktopConfigInput): void {
    if (!input || !Array.isArray(input.routes) || !input.routes.length || input.routes.length > 50) {
        throw new Error('Configure between 1 and 50 Desktop model entries')
    }
    const ids = new Set<string>()
    for (const route of input.routes) {
        if (!route || !['opus', 'sonnet', 'haiku'].includes(route.family)
            || typeof route.id !== 'string' || !new RegExp(`^claude-${route.family}-[a-z0-9-]+$`).test(route.id)
            || ids.has(route.id) || typeof route.modelId !== 'string' || !route.modelId.trim()
            || /[\r\n\0]/.test(route.modelId) || typeof route.label !== 'string' || !route.label.trim()) {
            throw new Error('Each Desktop entry needs a unique Claude route, a display name and a target model')
        }
        ids.add(route.id)
    }
    const clientIds = input.routes.map(desktopClientModelId)
    if (new Set(clientIds).size !== clientIds.length) throw new Error('Desktop 客户端模型 ID 重复，请为条目选择不同模型 / Duplicate Desktop client model IDs')
    if (!ids.has(input.defaultRouteId)) throw new Error('Select a Desktop default model')
}

export function resolveDesktopModel(input: DesktopConfigInput, model: string): string {
    // Bare tier requests from subagents use the first configured entry of that tier.
    const route = input.routes.find(route => desktopClientModelId(route) === model)
        || input.routes.find(route => route.family === model)
    if (!route) throw new Error(`Unknown Desktop model route: ${model}`)
    return route.modelId
}

export interface DesktopConfigPreview {
    token: string
    proxyOrigin: string
    files: Array<{ path: string; exists: boolean; changed: boolean; fields: string[] }>
    models: string[]
    warnings: string[]
}

export interface DesktopConfigOperation {
    id: string
    createdAt: string
    status: 'pending' | 'applied' | 'restored'
    paths: string[]
}

export type DesktopConfigReply<T> = { success: true; data: T } | { success: false; error: string }

export interface DesktopConfigApi {
    proxyDesktopState: () => Promise<DesktopConfigReply<{ input?: DesktopConfigInput; operations: DesktopConfigOperation[]; proxyRunning: boolean }>>
    proxyDesktopPreview: (input: DesktopConfigInput) => Promise<DesktopConfigReply<DesktopConfigPreview>>
    proxyDesktopApply: (token: string) => Promise<DesktopConfigReply<DesktopConfigOperation | null>>
    proxyDesktopRestore: (id: string) => Promise<DesktopConfigReply<void>>
}
