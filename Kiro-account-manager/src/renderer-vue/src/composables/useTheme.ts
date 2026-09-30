import { ref, watch, type Ref, type WatchStopHandle } from 'vue'
import { useSettingsStore } from '../stores/settings'

export type ThemeMode = 'light' | 'dark' | 'system'
export const THEME_MODE_KEY = 'kiro-vue-theme-mode'

function readPreference(): ThemeMode | null {
    try {
        const value = localStorage.getItem(THEME_MODE_KEY)
        return value === 'light' || value === 'dark' || value === 'system' ? value : null
    } catch {
        return null
    }
}

/** 一个应用实例只创建一次；跟随系统是 Vue 外观偏好，旧文档仍存有效布尔值。 */
export function useTheme(): {
    mode: Ref<ThemeMode>
    initialize: () => void
    setMode: (value: ThemeMode) => void
    syncAfterLoad: () => void
    dispose: () => void
} {
    const settings = useSettingsStore()
    const mode = ref<ThemeMode>(readPreference() ?? (settings.darkMode ? 'dark' : 'light'))
    let initialized = false
    let colorQuery: MediaQueryList | null = null
    let motionQuery: MediaQueryList | null = null
    let stop: WatchStopHandle | null = null

    function apply(): void {
        const dark = mode.value === 'system' ? Boolean(colorQuery?.matches) : mode.value === 'dark'
        document.documentElement.dataset.theme = dark ? 'dark' : 'light'
        if (settings.darkMode !== dark) settings.setDarkMode(dark)
    }

    function applyMotion(): void {
        document.documentElement.dataset.reducedMotion = String(Boolean(motionQuery?.matches))
    }

    function initialize(): void {
        if (initialized) return
        initialized = true
        mode.value = readPreference() ?? (settings.darkMode ? 'dark' : 'light')
        colorQuery = window.matchMedia('(prefers-color-scheme: dark)')
        motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
        colorQuery.addEventListener('change', apply)
        motionQuery.addEventListener('change', applyMotion)
        stop = watch(mode, apply, { flush: 'sync' })
        apply()
        applyMotion()
    }

    function setMode(value: ThemeMode): void {
        mode.value = value
        try {
            localStorage.setItem(THEME_MODE_KEY, value)
        } catch {
            /* 当前进程仍可切换外观。 */
        }
    }

    function syncAfterLoad(): void {
        if (!initialized) return
        if (!readPreference()) mode.value = settings.darkMode ? 'dark' : 'light'
        apply()
    }

    function dispose(): void {
        initialized = false
        stop?.()
        stop = null
        colorQuery?.removeEventListener('change', apply)
        motionQuery?.removeEventListener('change', applyMotion)
        colorQuery = null
        motionQuery = null
    }

    return { mode, initialize, setMode, syncAfterLoad, dispose }
}
