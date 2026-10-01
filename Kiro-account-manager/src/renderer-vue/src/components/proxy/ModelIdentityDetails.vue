<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { UiBadge, UiButton } from '@lingyzh/ui'
import { Check, Copy } from 'lucide-vue-next'

const props = defineProps({
    sourceId: { type: String, required: true },
    clientId: { type: String, required: true },
    isEn: { type: Boolean, required: true }
})
const copied = ref('')
const unchanged = computed(() => props.sourceId === props.clientId)
let copyTimer
let active = true

async function copy(value, kind) {
    try {
        await navigator.clipboard.writeText(value)
        if (!active) return
        copied.value = kind
        if (copyTimer) clearTimeout(copyTimer)
        copyTimer = setTimeout(() => {
            if (active && copied.value === kind) copied.value = ''
        }, 2000)
    } catch {
        // The full ID remains selectable when clipboard access is unavailable.
    }
}

onBeforeUnmount(() => {
    active = false
    if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
    <div class="kam-model-identity" data-testid="model-identity-details">
        <div class="kam-model-identity-heading">
            <strong>{{ isEn ? 'Model IDs' : '模型 ID' }}</strong
            ><UiBadge v-if="unchanged" tone="neutral">{{ isEn ? 'Unchanged' : '未改写' }}</UiBadge>
        </div>
        <div v-for="kind in ['source', 'client']" :key="kind">
            <small class="kam-muted">{{
                kind === 'source'
                    ? isEn
                        ? 'Upstream source ID'
                        : '上游原始 ID'
                    : isEn
                      ? 'Client model ID'
                      : '客户端模型 ID'
            }}</small>
            <div class="kam-model-identity-row">
                <code class="kam-mono">{{ kind === 'source' ? sourceId : clientId }}</code>
                <UiButton
                    icon
                    size="sm"
                    variant="ghost"
                    :aria-label="`${isEn ? 'Copy' : '复制'} ${kind}`"
                    :data-testid="`model-copy-${kind}`"
                    @click="copy(kind === 'source' ? sourceId : clientId, kind)"
                    ><Check v-if="copied === kind" :size="14" /><Copy v-else :size="14"
                /></UiButton>
            </div>
        </div>
    </div>
</template>

<style scoped>
.kam-model-identity {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
}
.kam-model-identity-heading,
.kam-model-identity-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.kam-model-identity-row code {
    min-width: 0;
    flex: 1;
    overflow-wrap: anywhere;
    user-select: all;
}
</style>
