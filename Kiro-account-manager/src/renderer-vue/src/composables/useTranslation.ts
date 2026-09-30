import { computed, type Ref, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import en from '@shared/i18n/locales/en'
import zh from '@shared/i18n/locales/zh'
import { useSettingsStore } from '../stores/settings'

type Translations = { [key: string]: string | Translations }
const locales: Record<'zh' | 'en', Translations> = { zh, en }

export function resolveLanguage(language: 'auto' | 'en' | 'zh'): 'en' | 'zh' {
    return language === 'auto'
        ? navigator.language.toLowerCase().startsWith('zh')
            ? 'zh'
            : 'en'
        : language
}

export function useTranslation(): {
    t: (key: string, params?: Record<string, string | number>) => string
    language: Ref<'auto' | 'en' | 'zh'>
    actualLanguage: ComputedRef<'en' | 'zh'>
} {
    const { language } = storeToRefs(useSettingsStore())
    const actualLanguage = computed(() => resolveLanguage(language.value))

    function t(key: string, params?: Record<string, string | number>): string {
        let current: Translations | string = locales[actualLanguage.value]
        for (const part of key.split('.')) {
            if (typeof current === 'string' || current[part] === undefined) return key
            current = current[part]
        }
        if (typeof current !== 'string') return key
        let text = current
        for (const [name, value] of Object.entries(params ?? {})) {
            text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value))
        }
        return text
    }

    return { t, language, actualLanguage }
}
