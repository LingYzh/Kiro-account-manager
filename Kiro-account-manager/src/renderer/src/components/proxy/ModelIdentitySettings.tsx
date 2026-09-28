import { useId, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, Label, Switch } from '../ui'

export interface ModelIdentitySettingsProps {
    enabled: boolean
    onEnabledChange: (enabled: boolean) => Promise<void>
    isEn: boolean
}

export function ModelIdentitySettings({ enabled, onEnabledChange, isEn }: ModelIdentitySettingsProps) {
    const switchId = useId()
    const pendingRef = useRef(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function changeEnabled(nextEnabled: boolean) {
        if (pendingRef.current || nextEnabled === enabled) return
        pendingRef.current = true
        setPending(true)
        setError(null)
        try {
            await onEnabledChange(nextEnabled)
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : (isEn ? 'Unable to save this setting.' : '无法保存此设置。'))
        } finally {
            pendingRef.current = false
            setPending(false)
        }
    }

    return (
        <Card variant="glass-subtle" className="p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={switchId} className="block text-sm font-semibold leading-5">
                        {isEn ? 'Claude Code model name compatibility' : 'Claude Code 模型名称兼容'}
                    </Label>
                    <p className="text-xs leading-5 text-muted-foreground">
                        {isEn
                            ? 'Use Claude-style IDs in model discovery and one-click Claude Code setup (for example, claude-opus-5-5). The upstream model stays the same.'
                            : '模型发现和一键配置 Claude Code 使用 Claude 风格的 ID（例如 claude-opus-5-5）；上游模型不变。'}
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                        {isEn
                            ? 'New model list requests use the saved setting. Reconfigure and restart an existing Claude Code client.'
                            : '保存后对新的模型列表请求生效；已有 Claude Code 请重新配置并重启。'}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    {pending && <Loader2 aria-label={isEn ? 'Saving' : '保存中'} className="h-4 w-4 animate-spin text-muted-foreground" />}
                    <Switch
                        id={switchId}
                        checked={enabled}
                        disabled={pending}
                        onCheckedChange={nextEnabled => { void changeEnabled(nextEnabled) }}
                    />
                </div>
            </div>
            {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
        </Card>
    )
}
