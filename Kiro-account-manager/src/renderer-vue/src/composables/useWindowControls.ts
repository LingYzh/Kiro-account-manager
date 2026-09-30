import { ref, type Ref } from 'vue'

export function useWindowControls(): {
    platform: Ref<NodeJS.Platform>
    maximized: Ref<boolean>
    version: Ref<string>
    initialize: () => Promise<void>
    dispose: () => void
} {
    const platform = ref<NodeJS.Platform>('win32')
    const maximized = ref(false)
    const version = ref('')
    let generation = 0
    let unsubscribe: (() => void) | null = null

    async function initialize(): Promise<void> {
        const current = ++generation
        unsubscribe?.()
        unsubscribe = window.api.window.onMaximizeChange((value) => {
            maximized.value = value
        })
        try {
            const [nextPlatform, nextMaximized, nextVersion] = await Promise.all([
                window.api.window.getPlatform(),
                window.api.window.isMaximized(),
                window.api.getAppVersion()
            ])
            if (current !== generation) return
            platform.value = nextPlatform
            maximized.value = nextMaximized
            version.value = nextVersion
        } catch (error) {
            console.warn('[TitleBar] init failed', error)
        }
    }

    function dispose(): void {
        generation++
        unsubscribe?.()
        unsubscribe = null
    }

    return { platform, maximized, version, initialize, dispose }
}
