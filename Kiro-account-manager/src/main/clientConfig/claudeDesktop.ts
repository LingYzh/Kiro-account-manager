import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { FileTransactionStore, hash, readOptional, type PlannedFile } from './fileTransaction'
import { DESKTOP_GATEWAY_PREFIX, desktopModelName, desktopClientModelId, validateDesktopInput, type DesktopConfigInput, type DesktopConfigPreview } from '../../shared/desktopConfig'

// KAM owns a distinct profile; never reuse CC Switch's profile ID.
export const DESKTOP_PROFILE_ID = 'a1697210-198d-4ab8-ae30-700000000001'
const execute = promisify(execFile)

export interface DesktopConnection {
    host: string
    port: number
    tlsEnabled?: boolean
    apiKey: string
}

export function desktopConfigRoot(platform = process.platform, env = process.env, home = homedir()): string {
    if (platform === 'win32') return env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    if (platform === 'darwin') return join(home, 'Library', 'Application Support')
    if (platform === 'linux') return env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config')
    throw new Error('Claude Desktop configuration is not supported on this platform')
}

export function desktopGatewayOrigin(connection: DesktopConnection): string {
    const host = connection.host === '0.0.0.0' ? '127.0.0.1' : connection.host === '::' ? '::1' : connection.host
    const origin = `${connection.tlsEnabled ? 'https' : 'http'}://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${connection.port}`
    const url = new URL(origin)
    if (!connection.apiKey.trim()) throw new Error('请先在反代配置中设置或启用 API Key / Enable a proxy API key first')
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        throw new Error('Claude Desktop requires HTTPS for non-loopback gateways')
    }
    return origin
}

export async function assertDesktopClosed(): Promise<void> {
    if (process.platform === 'win32') {
        const { stdout } = await execute('tasklist.exe', ['/FI', 'IMAGENAME eq Claude.exe', '/FO', 'CSV', '/NH'], { windowsHide: true })
        if (/"Claude\.exe"/i.test(stdout)) throw new Error('请先完全退出 Claude Desktop（包括托盘）/ Quit Claude Desktop, including its tray process, first')
    } else {
        try {
            await execute('pgrep', ['-i', '-x', 'claude'])
        } catch (error) {
            if ((error as { code?: number }).code === 1) return
            throw error
        }
        throw new Error('Quit Claude Desktop before changing its configuration')
    }
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function planJson(path: string, fields: string[], patch: (value: Record<string, unknown>) => void): Promise<PlannedFile> {
    const before = await readOptional(path)
    let value: unknown
    try {
        value = before === null ? {} : JSON.parse(before.toString('utf8').replace(/^\uFEFF/, ''))
    } catch {
        // Parser errors may include credentials from the original input. Only return the path.
        throw new Error(`Invalid JSON; file left unchanged: ${path}`)
    }
    if (!object(value)) throw new Error(`Expected a JSON object: ${path}`)
    const original = JSON.stringify(value)
    patch(value)
    // Preserve exact bytes on idempotent applications, including formatting and BOM.
    const after = before !== null && JSON.stringify(value) === original ? before : Buffer.from(`${JSON.stringify(value, null, 4)}\n`)
    return { path, before, after, fields }
}

export class ClaudeDesktopConfigService {
    readonly transactions: FileTransactionStore
    private readonly previews = new Map<string, { files: PlannedFile[]; fingerprint: string; expires: number }>()
    readonly routingPath: string

    constructor(private readonly root: string, stateDirectory: string) {
        this.routingPath = join(stateDirectory, 'routes.json')
        this.transactions = new FileTransactionStore(join(stateDirectory, 'operations'))
    }

    async readRoutes(): Promise<DesktopConfigInput | undefined> {
        const bytes = await readOptional(this.routingPath)
        if (!bytes) return undefined
        const input = JSON.parse(bytes.toString('utf8')) as DesktopConfigInput
        validateDesktopInput(input)
        return input
    }

    async preview(input: DesktopConfigInput, connection: DesktopConnection): Promise<DesktopConfigPreview> {
        input = { ...input, routes: input.routes.map(route => ({ ...route, label: desktopModelName(route.modelId) })) }
        validateDesktopInput(input)
        const origin = desktopGatewayOrigin(connection)
        const library = join(this.root, 'Claude-3p', 'configLibrary')
        const ordered = [input.routes.find(route => route.id === input.defaultRouteId)!, ...input.routes.filter(route => route.id !== input.defaultRouteId)]
        const files: PlannedFile[] = []
        // Publish routing/profile first and activation last, so a fresh launch never points to a missing profile.
        files.push(await planJson(this.routingPath, ['routes', 'defaultRouteId'], value => {
            value.routes = input.routes
            value.defaultRouteId = input.defaultRouteId
        }))
        files.push(await planJson(join(library, `${DESKTOP_PROFILE_ID}.json`), [
            'inferenceProvider', 'inferenceGatewayBaseUrl', 'inferenceGatewayAuthScheme',
            'inferenceGatewayApiKey (hidden)', 'inferenceModels', 'disableDeploymentModeChooser'
        ], value => {
            value.inferenceProvider = 'gateway'
            value.inferenceGatewayBaseUrl = `${origin}${DESKTOP_GATEWAY_PREFIX}`
            value.inferenceGatewayAuthScheme = 'bearer'
            value.inferenceGatewayApiKey = connection.apiKey
            value.inferenceModels = ordered.map(route => ({ name: desktopClientModelId(route), labelOverride: route.label }))
            value.disableDeploymentModeChooser = true
            // Keep policies, network restrictions and MCP settings outside KAM's owned fields.
        }))
        files.push(await planJson(join(library, '_meta.json'), ['entries (KAM only)', 'appliedId'], value => {
            if (value.entries !== undefined && !Array.isArray(value.entries)) throw new Error('Claude Desktop configLibrary.entries must be an array')
            const entries = (value.entries || []) as unknown[]
            const own = entries.find(entry => object(entry) && entry.id === DESKTOP_PROFILE_ID)
            if (object(own)) own.name = 'Kiro Account Manager'
            else entries.push({ id: DESKTOP_PROFILE_ID, name: 'Kiro Account Manager' })
            value.entries = entries
            value.appliedId = DESKTOP_PROFILE_ID
        }))
        for (const directory of ['Claude-3p', 'Claude']) {
            files.push(await planJson(join(this.root, directory, 'claude_desktop_config.json'), ['deploymentMode'], value => { value.deploymentMode = '3p' }))
        }
        this.previews.clear()
        const token = randomUUID()
        this.previews.set(token, { files, fingerprint: hash(Buffer.from(JSON.stringify(connection)))!, expires: Date.now() + 10 * 60_000 })
        return {
            token, proxyOrigin: `${origin}${DESKTOP_GATEWAY_PREFIX}`,
            models: ordered.map(route => `${desktopClientModelId(route)} → ${route.modelId}`),
            files: files.map(file => ({ path: file.path, exists: file.before !== null, changed: hash(file.before) !== hash(file.after), fields: file.fields })),
            warnings: [
                '首次启动前应用；已运行时需完全退出。KAM 反代必须保持运行。 / Apply before first launch; otherwise quit Desktop first. Keep the KAM proxy running.',
                '设备管理策略可能覆盖本地配置；自定义 CLAUDE_USER_DATA_DIR 不在此默认路径内。 / Managed policies can override local settings; custom CLAUDE_USER_DATA_DIR is not targeted.',
                ...(connection.tlsEnabled ? ['Desktop 必须信任反代 TLS 证书。 / Desktop must trust the proxy TLS certificate.'] : [])
            ]
        }
    }

    async apply(token: string, connection: DesktopConnection) {
        const preview = this.previews.get(token)
        if (!preview || preview.expires < Date.now()) throw new Error('Preview expired; preview the configuration again')
        if (preview.fingerprint !== hash(Buffer.from(JSON.stringify(connection)))) throw new Error('Proxy settings changed; preview again')
        this.previews.delete(token)
        return await this.transactions.apply(preview.files)
    }
}
