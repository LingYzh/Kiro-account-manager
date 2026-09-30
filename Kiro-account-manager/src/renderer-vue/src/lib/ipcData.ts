import { toRaw } from 'vue'

/** Electron IPC 不能克隆 Vue Proxy；仅复制业务文档的对象/数组，保留 undefined 字段。 */
export function toIpcData<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value
    const raw = toRaw(value)
    if (Array.isArray(raw)) return raw.map(toIpcData) as T
    return Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, toIpcData(item)])) as T
}
