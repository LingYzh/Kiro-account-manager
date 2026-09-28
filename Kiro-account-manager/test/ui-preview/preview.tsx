import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '../../src/renderer/src/components/ui'
import { ModelIdentitySettings } from '../../src/renderer/src/components/proxy/ModelIdentitySettings'
import { ModelIdentityDetails } from '../../src/renderer/src/components/proxy/ModelIdentityDetails'
import { ModelsDialog } from '../../src/renderer/src/components/proxy/ModelsDialog'
import './preview.css'

const models = [
    { name: 'Claude Opus 5.5', sourceId: 'claude-opus-5.5', mappedId: 'claude-opus-5-5' },
    { name: 'GPT-6 Sol', sourceId: 'gpt-6-sol', mappedId: 'gpt-6-sol' },
    {
        name: 'Long model ID',
        sourceId: 'vendor/custom.claude-experimental-version-20260929-with-a-very-long-identifier-for-layout-checks',
        mappedId: 'vendor/custom.claude-experimental-version-20260929-with-a-very-long-identifier-for-layout-checks'
    }
]

let mockEnabled = true
let mockFailNext = false
Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
        proxyGetModels: async () => ({
            success: true,
            fromCache: true,
            models: models.map(model => ({
                id: model.sourceId,
                upstreamId: model.sourceId,
                clientId: mockEnabled ? model.mappedId : model.sourceId,
                name: model.name,
                description: 'Synthetic model for layout and interaction review.',
                inputTypes: ['TEXT', 'IMAGE'],
                maxInputTokens: 200000,
                maxOutputTokens: 32000
            }))
        }),
        proxyUpdateConfig: async (config: { claudeModelIdMappingEnabled?: boolean }) => {
            await new Promise(resolve => window.setTimeout(resolve, 650))
            if (mockFailNext) {
                mockFailNext = false
                return { success: false, error: 'Preview save failed. Try again.' }
            }
            mockEnabled = config.claudeModelIdMappingEnabled !== false
            return { success: true }
        }
    }
})

function Preview() {
    const [enabled, setEnabled] = useState(true)
    const [isEn, setIsEn] = useState(false)
    const [dark, setDark] = useState(false)
    const [failNext, setFailNext] = useState(false)
    const [showDialog, setShowDialog] = useState(false)

    async function saveEnabled(nextEnabled: boolean) {
        const result = await window.api.proxyUpdateConfig({ claudeModelIdMappingEnabled: nextEnabled })
        if (!result.success) {
            setFailNext(false)
            throw new Error(isEn ? 'Preview save failed. Try again.' : '演示保存失败，请重试。')
        }
        setEnabled(nextEnabled)
    }

    return (
        <div className={dark ? 'dark' : ''}>
            <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
                <div className="mx-auto max-w-5xl space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h1 className="text-2xl font-semibold">{isEn ? 'Available Models' : '可用模型'}</h1>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {isEn ? 'Model identity component preview · synthetic data' : '模型名称组件预览 · 合成数据'}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => setIsEn(value => !value)}>
                                {isEn ? '中文' : 'English'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setDark(value => !value)}>
                                {dark ? (isEn ? 'Light' : '浅色') : (isEn ? 'Dark' : '深色')}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => { mockFailNext = true; setFailNext(true) }}>
                                {failNext ? (isEn ? 'Failure queued' : '已设置失败') : (isEn ? 'Fail next save' : '下次保存失败')}
                            </Button>
                            <Button variant="default" size="sm" onClick={() => setShowDialog(true)}>
                                {isEn ? 'Open full dialog' : '打开完整弹窗'}
                            </Button>
                        </div>
                    </div>
                    <ModelIdentitySettings enabled={enabled} onEnabledChange={saveEnabled} isEn={isEn} />
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Badge variant={enabled ? 'default' : 'secondary'}>{enabled ? (isEn ? 'Enabled' : '已开启') : (isEn ? 'Disabled' : '已关闭')}</Badge>
                        <span>{isEn ? 'Client IDs below reflect the current switch state.' : '下方客户端 ID 随开关状态变化。'}</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        {models.map(model => (
                            <Card key={model.sourceId} variant="glass" className="min-w-0">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">{model.name}</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <ModelIdentityDetails
                                        sourceId={model.sourceId}
                                        clientId={enabled ? model.mappedId : model.sourceId}
                                        isEn={isEn}
                                    />
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
                <ModelsDialog
                    open={showDialog}
                    onOpenChange={setShowDialog}
                    isEn={isEn}
                    mappingEnabled={enabled}
                    onMappingEnabledChange={saveEnabled}
                    onOpenModelMapping={() => setShowDialog(false)}
                    mappingCount={2}
                />
            </main>
        </div>
    )
}

createRoot(document.getElementById('root')!).render(<Preview />)
