import { defineStore, getActivePinia } from 'pinia'
import { ref } from 'vue'
/**
 * 全局任务中心
 *
 * 设计目标：把分散在各页面的"批量任务"（注册、订阅、Token 刷新、代理验活...）
 * 统一汇总到一个 store，由 TitleBar 显示总进度，侧栏抽屉显示明细。
 *
 * 任何长耗时任务调用方式：
 *   const id = useTaskStore().createTask({...})
 *   useTaskStore().updateTask(id, { progress: 50 })
 *   useTaskStore().completeTask(id, { successCount: 95, failedCount: 5 })
 */
export type TaskKind =
    | 'register-batch' // 批量注册
    | 'subscription-batch' // 批量订阅获取链接
    | 'overage-batch' // 批量开启超额
    | 'proxy-validation' // 代理池验活
    | 'token-refresh' // Token 批量刷新
    | 'account-check' // 账号状态批量检查
    | 'other'
export type TaskStatus = 'running' | 'paused' | 'success' | 'failed' | 'cancelled'
export interface TaskEntry {
    id: string
    kind: TaskKind
    /** 用户可见的任务标题，例如 "注册 50 个账号" */
    title: string
    /** 副标题，例如 "MoEmail 模式，并发 5" */
    subtitle?: string
    status: TaskStatus
    /** 0-100 进度百分比 */
    progress: number
    /** 已完成数 */
    done: number
    /** 总数 */
    total: number
    /** 成功数 */
    successCount: number
    /** 失败数 */
    failedCount: number
    /** 最后一条日志/状态描述 */
    lastMessage?: string
    /** 错误信息（失败时） */
    error?: string
    /** 取消回调：调用方注册，UI 可点击取消按钮调用 */
    onCancel?: () => void
    /** 暂停回调（仅支持暂停的任务） */
    onPause?: () => void
    /** 恢复回调 */
    onResume?: () => void
    createdAt: number
    updatedAt: number
    finishedAt?: number
}
// C7: 持久化键
const STORAGE_KEY = 'kiro-task-history'
const MAX_PERSISTED = 200 // 最多持久化最近 200 条已完成任务

/** 持久化任务（仅完成的任务，运行中任务不存） */
function persistTasks(tasks: Map<string, TaskEntry>): void {
    try {
        const finished = Array.from(tasks.values())
            .filter((t) => t.status !== 'running' && t.status !== 'paused')
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_PERSISTED)
            // 不持久化回调（函数无法序列化）
            .map(({ onCancel, onPause, onResume, ...rest }) => {
                void onCancel
                void onPause
                void onResume
                return rest
            })
        localStorage.setItem(STORAGE_KEY, JSON.stringify(finished))
    } catch {
        /* ignore */
    }
}
function loadPersistedTasks(): Map<string, TaskEntry> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return new Map()
        const arr = JSON.parse(raw) as TaskEntry[]
        const map = new Map<string, TaskEntry>()
        for (const t of arr) {
            // 启动时强制把"运行中"标记为"取消"（应用重启时已运行任务必然中断）
            const status: TaskStatus =
                t.status === 'running' || t.status === 'paused' ? 'cancelled' : t.status
            map.set(t.id, { ...t, status })
        }
        return map
    } catch {
        return new Map()
    }
}

export const useTaskStore = defineStore('kam-tasks', () => {
    const pinia = getActivePinia()!
    const tasks = ref<Map<string, TaskEntry>>(loadPersistedTasks())
    function createTask(
        input: Omit<
            TaskEntry,
            | 'id'
            | 'createdAt'
            | 'updatedAt'
            | 'status'
            | 'progress'
            | 'done'
            | 'successCount'
            | 'failedCount'
        > & {
            fixedId?: string
            status?: TaskStatus
            progress?: number
            done?: number
            successCount?: number
            failedCount?: number
        }
    ): string {
        const id = input.fixedId || crypto.randomUUID()
        const now = Date.now()
        const entry: TaskEntry = {
            id,
            kind: input.kind,
            title: input.title,
            subtitle: input.subtitle,
            status: input.status ?? 'running',
            progress: input.progress ?? 0,
            done: input.done ?? 0,
            total: input.total,
            successCount: input.successCount ?? 0,
            failedCount: input.failedCount ?? 0,
            lastMessage: input.lastMessage,
            error: input.error,
            onCancel: input.onCancel,
            onPause: input.onPause,
            onResume: input.onResume,
            createdAt: now,
            updatedAt: now
        }
        {
            const state = {
                tasks: useTaskStore(pinia).tasks
            }
            const next = new Map(state.tasks)
            next.set(id, entry)
            const changes: {
                tasks: Map<string, TaskEntry>
            } = { tasks: next }
            useTaskStore(pinia).$patch((state) => {
                state.tasks = changes.tasks
            })
        }
        return id
    }
    function updateTask(id: string, updates: Partial<TaskEntry>): void {
        {
            const changes: {
                tasks: Map<string, TaskEntry>
            } = ((state: {
                tasks: Map<string, TaskEntry>
            }): {
                tasks: Map<string, TaskEntry>
            } => {
                const next = new Map(state.tasks)
                const existing = next.get(id)
                if (!existing) return state
                next.set(id, { ...existing, ...updates, updatedAt: Date.now() })
                return { tasks: next }
            })({
                tasks: useTaskStore(pinia).tasks
            })
            useTaskStore(pinia).$patch((state) => {
                state.tasks = changes.tasks
            })
        }
    }
    function completeTask(
        id: string,
        summary?: {
            successCount?: number
            failedCount?: number
            error?: string
        }
    ): void {
        {
            const changes: {
                tasks: Map<string, TaskEntry>
            } = ((state: {
                tasks: Map<string, TaskEntry>
            }): {
                tasks: Map<string, TaskEntry>
            } => {
                const next = new Map(state.tasks)
                const existing = next.get(id)
                if (!existing) return state
                const successCount = summary?.successCount ?? existing.successCount
                const failedCount = summary?.failedCount ?? existing.failedCount
                const status: TaskStatus = summary?.error
                    ? 'failed'
                    : failedCount > 0 && successCount === 0
                      ? 'failed'
                      : 'success'
                next.set(id, {
                    ...existing,
                    status,
                    progress: 100,
                    successCount,
                    failedCount,
                    error: summary?.error,
                    finishedAt: Date.now(),
                    updatedAt: Date.now()
                })
                return { tasks: next }
            })({
                tasks: useTaskStore(pinia).tasks
            })
            useTaskStore(pinia).$patch((state) => {
                state.tasks = changes.tasks
            })
        }
        persistTasks(useTaskStore(pinia).tasks)
    }
    function failTask(id: string, error: string): void {
        {
            const changes: {
                tasks: Map<string, TaskEntry>
            } = ((state: {
                tasks: Map<string, TaskEntry>
            }): {
                tasks: Map<string, TaskEntry>
            } => {
                const next = new Map(state.tasks)
                const existing = next.get(id)
                if (!existing) return state
                next.set(id, {
                    ...existing,
                    status: 'failed',
                    error,
                    finishedAt: Date.now(),
                    updatedAt: Date.now()
                })
                return { tasks: next }
            })({
                tasks: useTaskStore(pinia).tasks
            })
            useTaskStore(pinia).$patch((state) => {
                state.tasks = changes.tasks
            })
        }
        persistTasks(useTaskStore(pinia).tasks)
    }
    function cancelTask(id: string): void {
        const task = useTaskStore(pinia).tasks.get(id)
        try {
            task?.onCancel?.()
        } catch {
            /* 取消回调异常不阻止任务进入取消状态。 */
        }
        {
            const changes: {
                tasks: Map<string, TaskEntry>
            } = ((state: {
                tasks: Map<string, TaskEntry>
            }): {
                tasks: Map<string, TaskEntry>
            } => {
                const next = new Map(state.tasks)
                const existing = next.get(id)
                if (!existing) return state
                next.set(id, {
                    ...existing,
                    status: 'cancelled',
                    finishedAt: Date.now(),
                    updatedAt: Date.now()
                })
                return { tasks: next }
            })({
                tasks: useTaskStore(pinia).tasks
            })
            useTaskStore(pinia).$patch((state) => {
                state.tasks = changes.tasks
            })
        }
        persistTasks(useTaskStore(pinia).tasks)
    }
    function removeTask(id: string): void {
        {
            const state = {
                tasks: useTaskStore(pinia).tasks
            }
            const next = new Map(state.tasks)
            next.delete(id)
            const changes: {
                tasks: Map<string, TaskEntry>
            } = { tasks: next }
            useTaskStore(pinia).$patch((state) => {
                state.tasks = changes.tasks
            })
        }
        persistTasks(useTaskStore(pinia).tasks)
    }
    function clearFinished(): void {
        {
            const state = {
                tasks: useTaskStore(pinia).tasks
            }
            const next = new Map<string, TaskEntry>()
            for (const [id, t] of state.tasks) {
                if (t.status === 'running' || t.status === 'paused') {
                    next.set(id, t)
                }
            }
            const changes: {
                tasks: Map<string, TaskEntry>
            } = { tasks: next }
            useTaskStore(pinia).$patch((state) => {
                state.tasks = changes.tasks
            })
        }
        persistTasks(useTaskStore(pinia).tasks)
    }
    function clearAll(): void {
        {
            const changes: {
                tasks: Map<string, TaskEntry>
            } = { tasks: new Map() }
            useTaskStore(pinia).$patch((state) => {
                state.tasks = changes.tasks
            })
        }
        persistTasks(useTaskStore(pinia).tasks)
    }
    function getActiveCount(): number {
        let count = 0
        for (const t of useTaskStore(pinia).tasks.values()) {
            if (t.status === 'running' || t.status === 'paused') count++
        }
        return count
    }

    return {
        tasks,
        createTask,
        updateTask,
        completeTask,
        failTask,
        cancelTask,
        removeTask,
        clearFinished,
        clearAll,
        getActiveCount
    }
})
