<script setup>
import { UiButton, UiTooltip, UiMenu, UiMenuItem } from '@lingyzh/ui'
import {
    Home,
    Users,
    Settings,
    Info,
    Fingerprint,
    Sparkles,
    Server,
    Shield,
    UserPlus,
    CreditCard,
    ScrollText,
    Network,
    Bell,
    Stethoscope,
    Archive,
    PanelLeftClose,
    PanelLeftOpen,
    Palette,
    Languages
} from 'lucide-vue-next'
import logo from '@shared/assets/Kiro Logo.svg'
import { useTranslation } from '../../composables/useTranslation'
import { useAppStore } from '../../stores/app'
import { useSettingsStore } from '../../stores/settings'

const props = defineProps({ currentPage: { type: String, required: true }, collapsed: Boolean })
const emit = defineEmits(['navigate', 'toggle'])
defineOptions({ name: 'KiroSidebar' })
const app = useAppStore()
const settings = useSettingsStore()
const { t } = useTranslation()
const pages = [
    { id: 'home', icon: Home },
    { id: 'accounts', icon: Users },
    { id: 'machineId', icon: Fingerprint },
    { id: 'kiroSettings', icon: Sparkles },
    { id: 'proxy', icon: Server },
    { id: 'kproxy', icon: Shield },
    { id: 'proxyPool', icon: Network },
    { id: 'register', icon: UserPlus },
    { id: 'subscription', icon: CreditCard },
    { id: 'webhooks', icon: Bell },
    { id: 'diagnose', icon: Stethoscope },
    { id: 'configSync', icon: Archive },
    { id: 'logs', icon: ScrollText },
    { id: 'settings', icon: Settings },
    { id: 'about', icon: Info }
]
const themeModes = ['light', 'dark', 'system']
const languages = ['auto', 'zh', 'en']

function navigate(page) {
    emit('navigate', page)
}
function toggle() {
    emit('toggle')
}
function setTheme(mode) {
    app.setThemeMode(mode)
}
function setLanguage(language) {
    settings.setLanguage(language)
}
</script>

<template>
    <aside
        class="kam-sidebar"
        :class="{ 'is-collapsed': props.collapsed }"
        :aria-label="t('shell.navigation')"
    >
        <div class="kam-brand">
            <img class="kam-logo" :src="logo" alt="Kiro" />
            <span v-if="!props.collapsed" class="text-subtitle text-no-wrap">{{
                t('shell.accountManager')
            }}</span>
        </div>
        <nav class="kam-navigation" :aria-label="t('shell.navigation')">
            <UiTooltip
                v-for="page in pages"
                :key="page.id"
                :text="t(`nav.${page.id}`)"
                :focusable="false"
            >
                <UiButton
                    class="kam-nav-item"
                    :variant="props.currentPage === page.id ? 'primary' : 'ghost'"
                    :rounded="false"
                    :icon="props.collapsed"
                    :aria-label="t(`nav.${page.id}`)"
                    :aria-current="props.currentPage === page.id ? 'page' : undefined"
                    @click="navigate(page.id)"
                >
                    <component :is="page.icon" :size="18" aria-hidden="true" />
                    <span v-if="!props.collapsed" class="text-truncate">{{
                        t(`nav.${page.id}`)
                    }}</span>
                </UiButton>
            </UiTooltip>
        </nav>
        <div class="kam-sidebar-footer">
            <UiMenu placement="top-start" :label="t('shell.theme')">
                <template #activator="{ props: activatorProps }">
                    <UiButton
                        v-bind="activatorProps"
                        ghost
                        :icon="props.collapsed"
                        :aria-label="t('shell.theme')"
                    >
                        <Palette :size="18" aria-hidden="true" />
                        <span v-if="!props.collapsed">{{ t('shell.theme') }}</span>
                    </UiButton>
                </template>
                <UiMenuItem
                    v-for="mode in themeModes"
                    :key="mode"
                    :checked="app.themeMode === mode"
                    @click="setTheme(mode)"
                >
                    {{ t(`shell.${mode}`) }}
                </UiMenuItem>
            </UiMenu>
            <UiMenu placement="top-start" :label="t('shell.language')">
                <template #activator="{ props: activatorProps }">
                    <UiButton
                        v-bind="activatorProps"
                        ghost
                        :icon="props.collapsed"
                        :aria-label="t('shell.language')"
                    >
                        <Languages :size="18" aria-hidden="true" />
                        <span v-if="!props.collapsed">{{ t('shell.language') }}</span>
                    </UiButton>
                </template>
                <UiMenuItem
                    v-for="language in languages"
                    :key="language"
                    :checked="settings.language === language"
                    @click="setLanguage(language)"
                >
                    {{ t(`shell.language_${language}`) }}
                </UiMenuItem>
            </UiMenu>
            <UiButton
                ghost
                :icon="props.collapsed"
                :aria-label="t(props.collapsed ? 'shell.expandSidebar' : 'shell.collapseSidebar')"
                @click="toggle"
            >
                <component
                    :is="props.collapsed ? PanelLeftOpen : PanelLeftClose"
                    :size="18"
                    aria-hidden="true"
                />
                <span v-if="!props.collapsed">{{ t('shell.collapseSidebar') }}</span>
            </UiButton>
        </div>
    </aside>
</template>

<style scoped>
.kam-sidebar {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 224px;
    min-height: 0;
    overflow: hidden;
    background: var(--sidebar);
    border-right: 1px solid var(--border);
    transition: width var(--motion-layout) var(--ease);
}
.kam-sidebar.is-collapsed {
    width: 64px;
}
.kam-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 64px;
    padding: 12px 16px;
}
.kam-logo {
    width: 30px;
    height: 30px;
    object-fit: contain;
}
:global(:root[data-theme='dark']) .kam-logo {
    filter: invert(1);
}
.kam-navigation {
    display: grid;
    align-content: start;
    gap: 4px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 12px 12px;
}
.kam-nav-item {
    width: 100%;
    justify-content: flex-start;
    gap: 12px;
}
.is-collapsed .kam-nav-item {
    justify-content: center;
}
.kam-sidebar-footer {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
}
:global(:root[data-reduced-motion='true']) .kam-sidebar {
    transition: none;
}
@media (prefers-reduced-motion: reduce) {
    .kam-sidebar {
        transition: none;
    }
}
</style>
