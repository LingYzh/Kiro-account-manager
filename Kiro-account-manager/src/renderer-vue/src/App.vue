<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { UiSnackbarHost, UiConfirmHost } from '@lingyzh/ui'
import { useAppStore } from './stores/app'
import { useTaskStore } from './stores/tasks'
import { summarizeTasks } from './lib/taskPresentation'
import TitleBar from './components/layout/TitleBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import TaskCenter from './components/layout/TaskCenter.vue'
import PagePending from './components/layout/PagePending.vue'
import CloseConfirmDialog from './components/CloseConfirmDialog.vue'

const app = useAppStore()
const tasks = useTaskStore()
const taskSummary = computed(() => summarizeTasks(tasks.tasks))
const tasksOpen = ref(false)
onMounted(app.initialize)
onBeforeUnmount(() => {
    void app.dispose()
})

function openTasks() {
    tasksOpen.value = true
}
</script>

<template>
    <div class="kam-shell">
        <TitleBar
            :task-count="tasks.tasks.size"
            :active-count="taskSummary.activeCount"
            :progress="taskSummary.totalProgress"
            @tasks="openTasks"
        />
        <div class="kam-workspace">
            <Sidebar
                :current-page="app.currentPage"
                :collapsed="app.sidebarCollapsed"
                @navigate="app.navigate"
                @toggle="app.toggleSidebar"
            />
            <main class="kam-content">
                <!-- 首次访问后保留实例；Phase 3 逐项替换占位页。 -->
                <PagePending
                    v-for="page in app.visitedPages"
                    v-show="app.currentPage === page"
                    :key="page"
                    :page="page"
                />
            </main>
        </div>
        <TaskCenter v-model:open="tasksOpen" />
        <CloseConfirmDialog />
        <UiSnackbarHost />
        <UiConfirmHost />
    </div>
</template>

<style>
html,
body,
#app {
    width: 100%;
    height: 100%;
    margin: 0;
}
body {
    overflow: hidden;
}
* {
    box-sizing: border-box;
}
.kam-shell {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--background);
    color: var(--text);
    font-family: var(--font);
}
.kam-workspace {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
}
.kam-content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
}
</style>
