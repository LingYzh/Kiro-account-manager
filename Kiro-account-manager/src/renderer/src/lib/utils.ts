import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// 其余纯函数已迁移到 src/renderer-shared/lib/utils.ts（供 Vue 版共用），此处重导出保持旧引用不变
export { formatBytes, formatDate, formatPercentage, generatePKCE, generateState, splitCredentialLine } from '@shared/lib/utils'
