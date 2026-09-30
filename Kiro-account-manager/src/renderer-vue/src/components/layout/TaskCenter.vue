<script setup>
import { computed } from 'vue'
import { UiDialog, UiButton, UiBadge, UiProgress } from '@lingyzh/ui'
import {
    X,
    Pause,
    Play,
    Trash2,
    ListChecks,
    Network,
    UserPlus,
    CreditCard,
    RefreshCw,
    Zap
} from 'lucide-vue-next'
import { useTaskStore } from '../../stores/tasks'
import { useTranslation } from '../../composables/useTranslation'
import { isActiveTask, formatDuration } from '../../lib/taskPresentation'

const open = defineModel('open', { type: Boolean, default: false })
const tasks = useTaskStore()
const { t } = useTranslation()
const sortedTasks = computed(() =>
    Array.from(tasks.tasks.values()).sort((a, b) => {
        if (isActiveTask(a) !== isActiveTask(b)) return isActiveTask(a) ? -1 : 1
        return b.updatedAt - a.updatedAt
    })
)
const activeCount = computed(() => tasks.getActiveCount())
const icons = {
    'register-batch': UserPlus,
    'subscription-batch': CreditCard,
    'overage-batch': Zap,
    'proxy-validation': Network,
    'token-refresh': RefreshCw,
    'account-check': RefreshCw,
    other: ListChecks
}
const tones = {
    running: 'accent',
    paused: 'warning',
    success: 'success',
    failed: 'error',
    cancelled: 'neutral'
}

function cancelAll() {
    for (const task of sortedTasks.value.filter(isActiveTask)) tasks.cancelTask(task.id)
}
function cancel(task) {
    tasks.cancelTask(task.id)
}
function remove(task) {
    tasks.removeTask(task.id)
}
function pause(task) {
    task.onPause?.()
}
function resume(task) {
    task.onResume?.()
}
function clearFinished() {
    tasks.clearFinished()
}
function close() {
    open.value = false
}
</script>

<template>
    <UiDialog
        v-model:open="open"
        placement="end"
        size="md"
        scrollable
        :content-label="t('shell.tasks')"
    >
        <template #header>
            <div class="d-flex align-center justify-space-between ga-3">
                <div class="d-flex align-center ga-2">
                    <h2 class="text-title">{{ t('shell.tasks') }}</h2>
                    <UiBadge dense>{{ sortedTasks.length }}</UiBadge>
                </div>
                <UiButton ghost icon dense :aria-label="t('common.close')" @click="close">
                    <X :size="16" aria-hidden="true" />
                </UiButton>
            </div>
        </template>
        <div v-if="!sortedTasks.length" class="kam-task-empty text-muted">
            <ListChecks :size="32" aria-hidden="true" />
            <p>{{ t('shell.noTasks') }}</p>
        </div>
        <div v-else class="d-flex flex-column ga-4">
            <article v-for="task in sortedTasks" :key="task.id" class="kam-task-row">
                <div class="d-flex align-center justify-space-between ga-3">
                    <div class="d-flex align-center ga-2 kam-task-title">
                        <component
                            :is="icons[task.kind] || ListChecks"
                            :size="16"
                            aria-hidden="true"
                        />
                        <h3 class="text-subtitle text-truncate" :title="task.title">
                            {{ task.title }}
                        </h3>
                    </div>
                    <UiBadge dense :tone="tones[task.status]">{{
                        t(`shell.task_${task.status}`)
                    }}</UiBadge>
                </div>
                <p v-if="task.subtitle" class="text-body-2 text-muted mt-1">{{ task.subtitle }}</p>
                <div v-if="task.total > 0 || isActiveTask(task)" class="mt-3">
                    <UiProgress
                        dense
                        :value="task.progress"
                        :tone="
                            task.status === 'failed'
                                ? 'error'
                                : task.status === 'success'
                                  ? 'success'
                                  : 'accent'
                        "
                        :label="task.title"
                    />
                    <div class="d-flex justify-space-between ga-2 text-caption text-muted mt-2">
                        <span
                            >{{ task.done }}/{{ task.total }} ·
                            {{
                                t('shell.taskCounts', {
                                    success: task.successCount,
                                    failed: task.failedCount
                                })
                            }}</span
                        >
                        <span>{{
                            formatDuration((task.finishedAt || Date.now()) - task.createdAt)
                        }}</span>
                    </div>
                </div>
                <p v-if="task.error" class="text-body-2 text-error text-break mt-2">
                    {{ task.error }}
                </p>
                <p v-else-if="task.lastMessage" class="text-body-2 text-muted text-break mt-2">
                    {{ task.lastMessage }}
                </p>
                <div class="d-flex align-center ga-2 mt-3">
                    <UiButton
                        v-if="task.status === 'running' && task.onPause"
                        dense
                        ghost
                        @click="pause(task)"
                    >
                        <Pause :size="14" aria-hidden="true" /> {{ t('shell.pause') }}
                    </UiButton>
                    <UiButton
                        v-if="task.status === 'paused' && task.onResume"
                        dense
                        ghost
                        @click="resume(task)"
                    >
                        <Play :size="14" aria-hidden="true" /> {{ t('shell.resume') }}
                    </UiButton>
                    <UiButton
                        v-if="isActiveTask(task)"
                        dense
                        ghost
                        variant="danger"
                        @click="cancel(task)"
                    >
                        {{ t('common.cancel') }}
                    </UiButton>
                    <UiButton v-else dense ghost @click="remove(task)">
                        <Trash2 :size="14" aria-hidden="true" /> {{ t('shell.remove') }}
                    </UiButton>
                </div>
            </article>
        </div>
        <template #footer>
            <div class="d-flex ga-2">
                <UiButton v-if="activeCount" dense ghost variant="danger" @click="cancelAll">
                    {{ t('shell.cancelAll') }}
                </UiButton>
                <UiButton dense ghost @click="clearFinished">
                    {{ t('shell.clearFinished') }}
                </UiButton>
            </div>
        </template>
    </UiDialog>
</template>

<style scoped>
.kam-task-row {
    padding-bottom: 20px;
    border-bottom: 1px solid var(--line);
}
.kam-task-row:last-child {
    border-bottom: 0;
    padding-bottom: 0;
}
.kam-task-title {
    min-width: 0;
}
.kam-task-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px 16px;
}
</style>
