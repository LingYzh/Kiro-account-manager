<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { UiButton } from '@lingyzh/ui'
import { Minus, Square, Copy, X, ListChecks } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { useWindowControls } from '../../composables/useWindowControls'

defineProps({
    taskCount: { type: Number, default: 0 },
    activeCount: { type: Number, default: 0 },
    progress: { type: Number, default: 0 }
})
defineEmits(['tasks'])
const { t } = useTranslation()
const controls = useWindowControls()
const { platform, maximized, version } = controls
onMounted(controls.initialize)
onBeforeUnmount(controls.dispose)

function minimize() {
    window.api.window.minimize()
}
function maximize() {
    window.api.window.maximizeToggle()
}
function close() {
    window.api.window.close()
}
</script>

<template>
    <header class="kam-titlebar" :class="{ 'is-mac': platform === 'darwin' }">
        <span class="text-caption text-truncate"
            >{{ t('shell.title') }}{{ version ? ` v${version}` : '' }}</span
        >
        <div class="kam-window-actions d-flex align-center ga-1">
            <UiButton
                v-if="taskCount"
                dense
                ghost
                :aria-label="t('shell.tasks')"
                @click="$emit('tasks')"
            >
                <ListChecks :size="14" aria-hidden="true" />
                {{ t('shell.tasks') }}{{ activeCount ? ` (${activeCount}) ${progress}%` : '' }}
            </UiButton>
            <template v-if="platform !== 'darwin'">
                <UiButton
                    dense
                    ghost
                    icon
                    :aria-label="t('shell.minimize')"
                    :title="t('shell.minimize')"
                    @click="minimize"
                >
                    <Minus :size="14" aria-hidden="true" />
                </UiButton>
                <UiButton
                    dense
                    ghost
                    icon
                    :aria-label="t(maximized ? 'shell.restore' : 'shell.maximize')"
                    :title="t(maximized ? 'shell.restore' : 'shell.maximize')"
                    @click="maximize"
                >
                    <component :is="maximized ? Copy : Square" :size="14" aria-hidden="true" />
                </UiButton>
                <UiButton
                    dense
                    ghost
                    icon
                    variant="danger"
                    :aria-label="t('common.close')"
                    :title="t('common.close')"
                    @click="close"
                >
                    <X :size="14" aria-hidden="true" />
                </UiButton>
            </template>
        </div>
    </header>
</template>

<style scoped>
.kam-titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    height: 36px;
    padding-left: 16px;
    padding-right: 4px;
    border-bottom: 1px solid var(--line);
    background: var(--sidebar);
    -webkit-app-region: drag;
    user-select: none;
}
.kam-titlebar.is-mac {
    padding-left: 80px;
    padding-right: 12px;
}
.kam-titlebar.is-mac > span {
    flex: 1;
    text-align: center;
}
.kam-window-actions {
    -webkit-app-region: no-drag;
}
</style>
