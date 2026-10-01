<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { UiAlert, UiCard, UiSwitch } from '@lingyzh/ui'

const props = defineProps({
    enabled: { type: Boolean, required: true },
    onEnabledChange: { type: Function, required: true },
    isEn: { type: Boolean, required: true }
})
const pending = ref(false)
const error = ref('')
let active = true
let generation = 0

async function changeEnabled(nextEnabled) {
    if (pending.value || nextEnabled === props.enabled) return
    pending.value = true
    error.value = ''
    const current = generation
    try {
        await props.onEnabledChange(nextEnabled)
    } catch (cause) {
        if (active && current === generation) {
            error.value =
                cause instanceof Error
                    ? cause.message
                    : props.isEn
                      ? 'Unable to save this setting.'
                      : '无法保存此设置。'
        }
    } finally {
        if (active && current === generation) pending.value = false
    }
}

onBeforeUnmount(() => {
    active = false
    generation += 1
})
</script>

<template>
    <UiCard density="compact">
        <div class="kam-identity-setting">
            <div>
                <strong>{{
                    isEn ? 'Claude Code model name compatibility' : 'Claude Code 模型名称兼容'
                }}</strong>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Use Claude-style IDs in model discovery and one-click Claude Code setup. The upstream model stays the same.'
                            : '模型发现和一键配置 Claude Code 使用 Claude 风格的 ID；上游模型不变。'
                    }}
                </p>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'New model list requests use the saved setting. Reconfigure and restart an existing Claude Code client.'
                            : '保存后对新的模型列表请求生效；已有 Claude Code 请重新配置并重启。'
                    }}
                </p>
            </div>
            <UiSwitch
                :model-value="enabled"
                :disabled="pending"
                data-testid="model-identity-enabled"
                :aria-label="
                    isEn ? 'Claude Code model name compatibility' : 'Claude Code 模型名称兼容'
                "
                @update:model-value="changeEnabled"
            />
        </div>
        <UiAlert
            v-if="error"
            tone="error"
            :title="isEn ? 'Unable to save' : '保存失败'"
            data-testid="model-identity-error"
            >{{ error }}</UiAlert
        >
    </UiCard>
</template>

<style scoped>
.kam-identity-setting {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
}
.kam-identity-setting strong {
    display: block;
    margin-bottom: 6px;
}
.kam-identity-setting p + p {
    margin-top: 6px;
}
</style>
