import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function shouldEnableAutoUpdater(
    isDevelopment: boolean,
    resourcesPath: string,
    configExists: (path: string) => boolean = existsSync
): boolean {
    return !isDevelopment && configExists(join(resourcesPath, 'app-update.yml'))
}
