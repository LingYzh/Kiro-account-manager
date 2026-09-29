import { app, ipcMain } from 'electron'
import { join } from 'path'
import { ClaudeDesktopConfigService, assertDesktopClosed, desktopConfigRoot, type DesktopConnection } from '../clientConfig/claudeDesktop'
import type { DesktopConfigInput, DesktopConfigReply } from '../../shared/desktopConfig'

let service: ClaudeDesktopConfigService | undefined

export function getDesktopConfigService(): ClaudeDesktopConfigService {
    service ??= new ClaudeDesktopConfigService(desktopConfigRoot(), join(app.getPath('userData'), 'client-config', 'claude-desktop'))
    return service
}

export function registerDesktopConfigHandlers(getConnection: () => DesktopConnection, isProxyRunning: () => boolean): void {
    async function reply<T>(operation: () => Promise<T>): Promise<DesktopConfigReply<T>> {
        try {
            return { success: true, data: await operation() }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Desktop configuration failed' }
        }
    }
    ipcMain.handle('proxy-desktop-state', () => reply(async () => ({
        input: await getDesktopConfigService().readRoutes(),
        operations: await getDesktopConfigService().transactions.list(),
        proxyRunning: isProxyRunning()
    })))
    ipcMain.handle('proxy-desktop-preview', (_event, input: DesktopConfigInput) => reply(async () => {
        const preview = await getDesktopConfigService().preview(input, getConnection())
        if (!isProxyRunning()) preview.warnings.unshift('反代尚未启动；配置完成后先启动反代，再启动 Desktop。 / Start the proxy before launching Desktop.')
        return preview
    }))
    ipcMain.handle('proxy-desktop-apply', (_event, token: string) => reply(async () => {
        await assertDesktopClosed()
        return await getDesktopConfigService().apply(token, getConnection())
    }))
    ipcMain.handle('proxy-desktop-restore', (_event, id: string) => reply(async () => {
        await assertDesktopClosed()
        await getDesktopConfigService().transactions.restore(id)
    }))
}
