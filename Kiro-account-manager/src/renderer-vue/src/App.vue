<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { UiSnackbarHost, UiConfirmHost, UiTabPanel } from '@lingyzh/ui'
import { useAppStore } from './stores/app'
import { useTaskStore } from './stores/tasks'
import { summarizeTasks } from './lib/taskPresentation'
import TitleBar from './components/layout/TitleBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import TaskCenter from './components/layout/TaskCenter.vue'
import PagePending from './components/layout/PagePending.vue'
import CloseConfirmDialog from './components/CloseConfirmDialog.vue'
import UpdateDialog from './components/UpdateDialog.vue'
import AboutPage from './components/pages/AboutPage.vue'
import WebhooksPage from './components/pages/WebhooksPage.vue'
import LogsPage from './components/pages/LogsPage.vue'
import MachineIdPage from './components/pages/MachineIdPage.vue'
import DiagnosePage from './components/pages/DiagnosePage.vue'
import ConfigSyncPage from './components/pages/ConfigSyncPage.vue'
import KiroSettingsPage from './components/pages/KiroSettingsPage.vue'
import KProxyPage from './components/pages/KProxyPage.vue'
import HomePage from './components/pages/HomePage.vue'
import SettingsPage from './components/pages/SettingsPage.vue'
import AccountManager from './components/accounts/AccountManager.vue'
import ProxyPoolPage from './components/pages/ProxyPoolPage.vue'
import ProxyPage from './components/pages/ProxyPage.vue'
import SubscriptionPage from './components/pages/SubscriptionPage.vue'
import RegisterPage from './components/pages/RegisterPage.vue'

const pageComponents = {
    home: HomePage,
    settings: SettingsPage,
    accounts: AccountManager,
    proxyPool: ProxyPoolPage,
    proxy: ProxyPage,
    subscription: SubscriptionPage,
    register: RegisterPage,
    about: AboutPage,
    webhooks: WebhooksPage,
    logs: LogsPage,
    machineId: MachineIdPage,
    diagnose: DiagnosePage,
    configSync: ConfigSyncPage,
    kiroSettings: KiroSettingsPage,
    kproxy: KProxyPage
}

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
                <!-- 全部业务页已接入，首次访问后保留实例。 -->
                <UiTabPanel
                    v-for="page in app.visitedPages"
                    :key="page"
                    :model-value="app.currentPage"
                    :value="page"
                    id-prefix="kam-navigation"
                >
                    <component :is="pageComponents[page]" v-if="pageComponents[page]" />
                    <PagePending v-else :page="page" />
                </UiTabPanel>
            </main>
        </div>
        <TaskCenter v-model:open="tasksOpen" />
        <CloseConfirmDialog />
        <UpdateDialog />
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
