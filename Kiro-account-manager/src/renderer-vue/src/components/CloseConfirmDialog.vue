<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { UiDialog, UiButton, UiCheckbox } from '@lingyzh/ui'
import { useTranslation } from '../composables/useTranslation'
import { useCloseConfirmation } from '../composables/useCloseConfirmation'
const { t } = useTranslation()
const confirmation = useCloseConfirmation()
const { open, rememberChoice } = confirmation
onMounted(confirmation.initialize)
onBeforeUnmount(confirmation.dispose)
</script>

<template>
    <UiDialog
        :open="open"
        size="sm"
        scrollable
        :content-label="t('shell.closeWindow')"
        @update:open="confirmation.handleOpen"
    >
        <template #header>
            <h2 class="text-title">{{ t('shell.closeWindow') }}</h2>
        </template>
        <div class="d-flex flex-column ga-4">
            <p>{{ t('shell.closeQuestion') }}</p>
            <p class="text-body-2 text-muted">{{ t('shell.trayExplanation') }}</p>
            <UiButton @click="confirmation.respond('minimize')">
                {{ t('shell.minimizeToTray') }}
            </UiButton>
            <UiButton variant="danger" @click="confirmation.respond('quit')">
                {{ t('shell.quit') }}
            </UiButton>
            <UiCheckbox v-model="rememberChoice" :label="t('shell.rememberChoice')" />
        </div>
        <template #footer>
            <UiButton ghost @click="confirmation.respond('cancel')">
                {{ t('common.cancel') }}
            </UiButton>
        </template>
    </UiDialog>
</template>
