import type { TaskEntry } from '../stores/tasks'

export function summarizeTasks(tasks: Map<string, TaskEntry>): {
    activeCount: number
    finishedCount: number
    hasFailure: boolean
    totalProgress: number
} {
    let activeCount = 0
    let finishedCount = 0
    let hasFailure = false
    let done = 0
    let total = 0
    for (const task of tasks.values()) {
        if (task.status === 'running' || task.status === 'paused') {
            activeCount++
            done += task.done
            total += task.total
        } else {
            finishedCount++
            if (task.status === 'failed') hasFailure = true
        }
    }
    return {
        activeCount,
        finishedCount,
        hasFailure,
        totalProgress: total > 0 ? Math.round((done / total) * 100) : 0
    }
}

export function isActiveTask(task: TaskEntry): boolean {
    return task.status === 'running' || task.status === 'paused'
}

export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
