import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ClientConfigDialog } from '../src/renderer/src/components/proxy/ClientConfigDialog'
import '../src/renderer/src/styles/globals.css'

const models = ['claude-opus-4.6', 'claude-opus-4.8', 'claude-opus-5', 'claude-sonnet-4.5', 'claude-sonnet-4.6', 'claude-haiku-4.5', 'gpt-5.6-sol', 'qwen3-coder-next'].map(id => ({ id, name: id }))
async function call(name: string, input?: unknown) {
    return await (await fetch(`/fixture/${name}`, { method: 'POST', body: JSON.stringify(input) })).json()
}
Object.assign(window, { api: {
    proxyGetModels: async () => ({ success: true, models }),
    proxyDesktopState: () => call('state'),
    proxyDesktopPreview: input => call('preview', input),
    proxyDesktopApply: token => call('apply', token),
    proxyDesktopRestore: id => call('restore', id)
} })
function Fixture() {
    const [open, setOpen] = useState(true)
    return <main><button onClick={() => setOpen(true)}>打开配置</button><ClientConfigDialog open={open} onOpenChange={setOpen} isEn={false} /></main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
