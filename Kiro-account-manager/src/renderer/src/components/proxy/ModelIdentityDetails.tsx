import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Badge, Button } from '../ui'

export interface ModelIdentityDetailsProps {
    sourceId: string
    clientId: string
    isEn: boolean
}

export function ModelIdentityDetails({ sourceId, clientId, isEn }: ModelIdentityDetailsProps) {
    const [copied, setCopied] = useState<'source' | 'client' | null>(null)
    const unchanged = sourceId === clientId

    async function copy(value: string, kind: 'source' | 'client') {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(kind)
            window.setTimeout(() => setCopied(current => current === kind ? null : current), 2000)
        } catch {
            // The full ID stays selectable when clipboard access is unavailable.
        }
    }

    return (
        <div className="min-w-0 space-y-2 rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{isEn ? 'Model IDs' : '模型 ID'}</p>
                {unchanged && <Badge variant="secondary" className="shrink-0">{isEn ? 'Unchanged' : '未改写'}</Badge>}
            </div>
            {([
                ['source', sourceId, isEn ? 'Upstream source ID' : '上游原始 ID'],
                ['client', clientId, isEn ? 'Client model ID' : '客户端模型 ID']
            ] as const).map(([kind, value, label]) => (
                <div key={kind} className="min-w-0">
                    <p className="mb-1 text-xs text-muted-foreground">{label}</p>
                    <div className="flex min-w-0 items-start gap-1.5">
                        <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-muted/70 px-2 py-1.5 font-mono text-xs leading-5 text-foreground">
                            {value}
                        </code>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            aria-label={`${isEn ? 'Copy' : '复制'} ${label}`}
                            title={isEn ? 'Copy ID' : '复制 ID'}
                            onClick={() => { void copy(value, kind) }}
                        >
                            {copied === kind ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                    </div>
                </div>
            ))}
        </div>
    )
}
