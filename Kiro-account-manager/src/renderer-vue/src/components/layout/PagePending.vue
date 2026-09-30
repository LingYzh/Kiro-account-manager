<script setup>
import { UiCard, UiBadge } from '@lingyzh/ui'
import { useTranslation } from '../../composables/useTranslation'
defineProps({ page: { type: String, required: true } })
const { t } = useTranslation()
</script>

<template>
    <section class="kam-page">
        <div class="d-flex align-center ga-3 mb-4">
            <h1 class="text-title">{{ t(`nav.${page}`) }}</h1>
            <UiBadge dense>Phase 2</UiBadge>
        </div>
        <UiCard :title="t('shell.pendingTitle')">
            <p class="text-body-1 text-muted">{{ t('shell.pendingDescription') }}</p>
        </UiCard>
    </section>
</template>

<style scoped>
.kam-page {
    padding: 28px;
    max-width: 1100px;
    margin: 0 auto;
}
</style>
