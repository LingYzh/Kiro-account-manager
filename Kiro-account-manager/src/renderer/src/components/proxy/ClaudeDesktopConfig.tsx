import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '../ui'
import {
    defaultDesktopRoutes, desktopModelName, desktopClientModelId, DESKTOP_ROLE_IDS,
    type DesktopConfigInput, type DesktopConfigOperation, type DesktopConfigPreview,
    type DesktopModelFamily, type DesktopModelOption
} from '../../../../shared/desktopConfig'

interface Props {
    models: DesktopModelOption[]
    loading: boolean
    isEn: boolean
    busy: boolean
    onBusyChange: (busy: boolean) => void
    onReload: () => void
}

export function ClaudeDesktopConfig({ models, loading, isEn, busy, onBusyChange, onReload }: Props) {
    const [input, setInput] = useState<DesktopConfigInput>(() => defaultDesktopRoutes([]))
    const [ready, setReady] = useState(false)
    const [preview, setPreview] = useState<DesktopConfigPreview | null>(null)
    const [operations, setOperations] = useState<DesktopConfigOperation[]>([])
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [restoreId, setRestoreId] = useState('')
    const initialized = useRef(false)
    const working = useRef(false)
    const modelKey = models.map(model => model.id).join('\0')

    useEffect(() => {
        let cancelled = false
        window.api.proxyDesktopState().then(result => {
            if (cancelled) return
            if (!result.success) {
                setError(result.error)
                return
            }
            if (result.data.input) {
                initialized.current = true
                setInput(result.data.input)
            }
            setOperations(result.data.operations)
            setReady(true)
        }).catch(error => { if (!cancelled) setError(String(error)) })
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        setPreview(null)
        if (ready && models.length && !initialized.current) {
            initialized.current = true
            setInput(defaultDesktopRoutes(models))
        }
    }, [ready, modelKey]) // Preserve manual choices when the catalog reloads.

    function change(next: DesktopConfigInput): void {
        initialized.current = true
        setInput(next)
        setPreview(null)
        setError('')
        setMessage('')
    }

    function addRoute(): void {
        let suffix = 2
        while (input.routes.some(route => route.id === `${DESKTOP_ROLE_IDS.sonnet}-kam-${suffix}`)) suffix++
        change({ ...input, routes: [...input.routes, {
            id: `${DESKTOP_ROLE_IDS.sonnet}-kam-${suffix}`, family: 'sonnet',
            label: isEn ? `Model ${suffix}` : `模型 ${suffix}`, modelId: ''
        }] })
    }

    async function refreshOperations(refreshInput = false): Promise<void> {
        const result = await window.api.proxyDesktopState()
        if (!result.success) throw new Error(result.error)
        setOperations(result.data.operations)
        if (refreshInput) setInput(result.data.input || defaultDesktopRoutes(models))
    }

    async function run(action: 'preview' | 'apply' | 'restore'): Promise<void> {
        if (working.current) return
        working.current = true
        onBusyChange(true)
        setError('')
        setMessage('')
        try {
            if (action === 'preview') {
                const result = await window.api.proxyDesktopPreview(input)
                if (!result.success) throw new Error(result.error)
                setPreview(result.data)
            } else if (action === 'apply' && preview) {
                const result = await window.api.proxyDesktopApply(preview.token)
                setPreview(null)
                if (!result.success) throw new Error(result.error)
                setMessage(isEn ? 'Configuration written. Start the KAM proxy, then launch Claude Desktop. Live inference has not been tested.' : '配置已写入。先启动 KAM 反代，再启动 Claude Desktop；尚未验证真实推理请求。')
                await refreshOperations()
            } else if (action === 'restore' && restoreId) {
                const result = await window.api.proxyDesktopRestore(restoreId)
                if (!result.success) throw new Error(result.error)
                setRestoreId('')
                setPreview(null)
                setMessage(isEn ? 'Restored the files to their state before this operation.' : '已恢复到此次操作之前的文件状态。')
                await refreshOperations(true)
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error))
            await refreshOperations().catch(() => {})
        } finally {
            working.current = false
            onBusyChange(false)
        }
    }

    const missingModels = input.routes.some(route => !models.some(model => model.id === route.modelId))
    const recoverable = operations.filter(operation => operation.status !== 'restored')
    const pending = recoverable.some(operation => operation.status === 'pending')
    const controlClass = 'w-full rounded-lg border bg-background px-3 py-2 text-sm min-w-0'

    return <div className="space-y-4">
        <div className="rounded-xl border bg-primary/5 p-4 space-y-2">
            <h3 className="font-semibold">{isEn ? 'Claude Desktop · First-launch gateway setup' : 'Claude Desktop · 首次启动网关配置'}</h3>
            <p className="text-sm text-muted-foreground">{isEn
                ? 'Creates and activates a dedicated KAM 3P profile. Each menu entry maps to the actual target model below; other clients are unaffected.'
                : '创建并选中独立的 KAM 3P 配置。每个菜单条目映射到下方实际目标模型，不影响其他客户端。'}</p>
            <p className="text-xs text-muted-foreground">{isEn
                ? 'Apply before first launch, or fully quit Desktop first. Existing MCP, preferences and other gateway profiles are preserved.'
                : '可在首次启动前配置；已运行时请先完全退出 Desktop。保留已有 MCP、偏好和其他网关配置。'}</p>
        </div>
        <fieldset disabled={busy || !ready} className="space-y-3 min-w-0">
            <div className="flex justify-between items-center gap-2">
                <span className="font-medium text-sm">{isEn ? 'Desktop model menu' : 'Desktop 模型菜单'}</span>
                <Button variant="outline" size="sm" onClick={onReload} disabled={loading || busy}>
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}{isEn ? 'Reload models' : '刷新模型'}
                </Button>
            </div>
            {input.routes.map((route, index) => <div key={route.id} className="rounded-xl border p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" name="desktop-default-model" checked={input.defaultRouteId === route.id}
                            onChange={() => change({ ...input, defaultRouteId: route.id })} />
                        {input.defaultRouteId === route.id ? (isEn ? 'Default model' : '默认模型') : (isEn ? 'Set as default' : '设为默认')}
                    </label>
                    {index >= 3 && <Button size="sm" variant="ghost" aria-label={isEn ? 'Remove model' : '删除模型'} onClick={() => change({
                        routes: input.routes.filter(item => item.id !== route.id),
                        defaultRouteId: input.defaultRouteId === route.id ? input.routes[0].id : input.defaultRouteId
                    })}><Trash2 className="h-4 w-4" /></Button>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] gap-3">
                    <label className="space-y-1 text-xs text-muted-foreground">{isEn ? 'Role' : '档位'}
                        <select className={controlClass} value={route.family} disabled={index < 3} onChange={event => {
                            const family = event.target.value as DesktopModelFamily
                            const id = `${DESKTOP_ROLE_IDS[family]}-kam-${crypto.randomUUID().slice(0, 8)}`
                            change({ routes: input.routes.map(item => item.id === route.id ? { ...item, family, id } : item), defaultRouteId: input.defaultRouteId === route.id ? id : input.defaultRouteId })
                        }}>
                            <option value="opus">Opus</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option>
                        </select>
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">{isEn ? 'Menu label' : '菜单名称'}
                        <input className={controlClass} value={desktopModelName(route.modelId)} readOnly />
                    </label>
                </div>
                <label className="block space-y-1 text-xs text-muted-foreground">{isEn ? 'Actual target model' : '实际调用的模型'}
                    <select className={controlClass} value={route.modelId} onChange={event => change({ ...input, routes: input.routes.map(item => item.id === route.id ? { ...item, modelId: event.target.value } : item) })}>
                        <option value="">{isEn ? 'Select a model' : '请选择模型'}</option>
                        {route.modelId && !models.some(model => model.id === route.modelId) && <option value={route.modelId}>{route.modelId} · {isEn ? 'not in catalog' : '当前列表中不可用'}</option>}
                        {models.map(model => <option key={model.id} value={model.id}>{model.id}{model.name && model.name !== model.id ? ` · ${model.name}` : ''}</option>)}
                    </select>
                </label>
                <p className="text-xs text-muted-foreground break-all">{isEn ? 'Client request ID: ' : '客户端请求 ID：'}{desktopClientModelId(route)}</p>
            </div>)}
            <Button variant="outline" onClick={addRoute} disabled={input.routes.length >= 50}><Plus className="h-4 w-4" />{isEn ? 'Add model entry' : '添加模型条目'}</Button>
        </fieldset>
        {missingModels && !loading && <p className="text-xs text-warning">{isEn ? 'Select an available target for each role. Missing roles are not silently substituted.' : '请为每档选择可用模型；缺少对应档位时不会自动替换为其他模型。'}</p>}
        {error && <p role="alert" className="rounded-lg bg-destructive/10 text-destructive p-3 text-sm break-words">{error}</p>}
        {message && <p role="status" className="rounded-lg bg-success/10 p-3 text-sm">{message}</p>}
        {preview && <div className="rounded-xl border p-4 space-y-3">
            <h4 className="font-medium">{isEn ? 'Review changes' : '确认写入内容'}</h4>
            <p className="font-mono text-xs break-all">{preview.proxyOrigin}</p>
            {preview.models.map(model => <p key={model} className="text-xs break-all">{model}</p>)}
            {preview.files.map(file => <div key={file.path} className="text-xs border-t pt-2 space-y-1">
                <p className="font-mono break-all">{file.path}</p>
                <p className="text-muted-foreground">{!file.changed ? (isEn ? 'Unchanged' : '无需更改') : file.exists ? (isEn ? 'Update with backup' : '备份后更新') : (isEn ? 'Create' : '新建')} · {file.fields.join(', ')}</p>
            </div>)}
            {preview.warnings.map(warning => <p key={warning} className="text-xs text-warning">{warning}</p>)}
        </div>}
        <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy || loading || !ready || missingModels || pending} onClick={() => run('preview')}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{isEn ? 'Preview configuration' : '预览配置'}</Button>
            <Button disabled={busy || loading || !preview || pending} onClick={() => run('apply')}>{isEn ? 'Apply 3P gateway' : '应用 3P 网关配置'}</Button>
        </div>
        {recoverable.length > 0 && <details className="rounded-xl border p-3 text-sm" open={pending || undefined}>
            <summary className="cursor-pointer">{isEn ? 'Backups and recovery' : '备份与恢复'} ({recoverable.length})</summary>
            <p className="text-xs text-muted-foreground my-2">{isEn ? 'Restores all files changed by the selected operation, including model routes. External edits block restoration.' : '恢复所选操作修改的全部文件（含模型映射）。文件若被外部改动，会阻止恢复。'}</p>
            <select aria-label={isEn ? 'Operation to restore' : '选择恢复记录'} className={controlClass} value={restoreId} disabled={busy} onChange={event => setRestoreId(event.target.value)}>
                <option value="">{isEn ? 'Select an operation' : '选择操作记录'}</option>
                {recoverable.map(operation => <option key={operation.id} value={operation.id}>{operation.createdAt} · {operation.status}</option>)}
            </select>
            {restoreId && <div className="mt-2 space-y-1">
                {recoverable.find(operation => operation.id === restoreId)?.paths.map(path => <p key={path} className="text-xs font-mono break-all">{path}</p>)}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => run('restore')}><RotateCcw className="h-4 w-4" />{isEn ? 'Restore these files' : '恢复上述文件'}</Button>
            </div>}
        </details>}
    </div>
}
