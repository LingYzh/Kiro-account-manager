<script setup>
import { computed } from 'vue'
import { UiButton, UiTabs, UiMenu, UiMenuItem } from '@lingyzh/ui'
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
import logo from '@shared/assets/kam-logo.png'
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
const pageIcons = Object.fromEntries(pages.map((page) => [page.id, page.icon]))
const tabItems = computed(() => pages.map((page) => ({ id: page.id, label: t(`nav.${page.id}`) })))

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
            <UiTabs
                :model-value="props.currentPage"
                :items="tabItems"
                id-prefix="kam-navigation"
                orientation="vertical"
                indicator-side="start"
                dense
                :aria-label="t('shell.navigation')"
                @update:model-value="navigate"
            >
                <template #default="{ item }">
                    <span
                        class="kam-tab-content d-flex align-center ga-3"
                        :title="props.collapsed ? item.label : undefined"
                    >
                        <component
                            :is="pageIcons[item.id]"
                            :size="18"
                            :role="props.collapsed ? 'img' : undefined"
                            :aria-label="props.collapsed ? item.label : undefined"
                            :aria-hidden="!props.collapsed"
                        />
                        <span v-if="!props.collapsed" class="text-truncate">{{ item.label }}</span>
                    </span>
                </template>
            </UiTabs>
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
.kam-navigation {
    display: grid;
    align-content: start;
    gap: 4px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 0 12px;
}
.kam-tab-content {
    min-width: 0;
}
.kam-sidebar-footer {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
}
:root[data-reduced-motion='true'] .kam-sidebar {
    transition: none;
}
@media (prefers-reduced-motion: reduce) {
    .kam-sidebar {
        transition: none;
    }
}
</style>
