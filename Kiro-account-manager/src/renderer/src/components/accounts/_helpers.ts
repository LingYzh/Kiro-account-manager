/**
 * 账号视图共享工具 — AccountCard / AccountListRow 复用
 * 保证两种视图（卡片 / 列表）视觉系统一致
 *
 * 框架无关的纯函数已迁移到 src/renderer-shared/lib/accountHelpers.ts（供 Vue 版共用），
 * 此处重导出保持旧引用不变；返回 CSSProperties 的函数（依赖 React 类型）留在本文件。
 */
import type { CSSProperties } from 'react'
export {
  toRgba,
  getSubscriptionColor,
  StatusLabelsZh,
  StatusLabelsEn,
  getStatusBadgeClass,
  getDisplayName,
  formatTokenExpiry,
  isBannedError,
  formatDateSafe
} from '@shared/lib/accountHelpers'
import { toRgba } from '@shared/lib/accountHelpers'

// ============ 标签光环 ============

// 生成卡片版标签光环样式：单标签 → box-shadow；多标签 → 渐变 border
export function generateGlowStyle(tagColors: string[]): CSSProperties {
  if (tagColors.length === 0) return {}
  if (tagColors.length === 1) {
    const color = toRgba(tagColors[0])
    const colorTransparent = color.replace('1)', '0.15)')
    return {
      boxShadow: `0 0 0 1px ${color}, 0 4px 12px -2px ${colorTransparent}`
    }
  }
  const gradientColors = tagColors.map((c, i) => {
    const percent = (i / tagColors.length) * 100
    const nextPercent = ((i + 1) / tagColors.length) * 100
    return `${toRgba(c)} ${percent}%, ${toRgba(c)} ${nextPercent}%`
  }).join(', ')
  return {
    background: `linear-gradient(var(--card-solid), var(--card-solid)) padding-box, linear-gradient(135deg, ${gradientColors}) border-box`,
    border: '1.5px solid transparent',
    boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.05)'
  }
}

// 列表行用：标签色带 — 只保留左边 3px 色带作为身份识别，不染色行背景避免多行列表花花绿绿
export function generateRowGlowStyle(tagColors: string[]): CSSProperties {
  if (tagColors.length === 0) return {}
  if (tagColors.length === 1) {
    return {
      borderLeftColor: toRgba(tagColors[0]),
      borderLeftWidth: '3px'
    }
  }
  // 多标签：垂直渐变左边色带（双层 backgroundClip trick，渐变只在 border-box 的 3px 区域显示）
  const gradientStops = tagColors.map((c, i) => {
    const percent = (i / (tagColors.length - 1)) * 100
    return `${toRgba(c)} ${percent}%`
  }).join(', ')
  return {
    borderLeftWidth: '3px',
    borderLeftColor: 'transparent',
    backgroundImage: `linear-gradient(var(--card-solid), var(--card-solid)), linear-gradient(180deg, ${gradientStops})`,
    backgroundOrigin: 'padding-box, border-box',
    backgroundClip: 'padding-box, border-box',
    backgroundRepeat: 'no-repeat'
  }
}

// ============ 封禁状态样式 ============

// 卡片版封禁背景样式（用 CSS 变量）
export const unauthorizedCardStyle: CSSProperties = {
  backgroundColor: 'var(--card-unauthorized-bg)',
  borderColor: 'var(--card-unauthorized-border)',
  boxShadow: `
    0 0 0 1px var(--card-unauthorized-ring),
    0 4px 12px -2px var(--card-unauthorized-shadow)
  `
}

// 列表行封禁背景样式（更轻量，不抢眼）
export const unauthorizedRowStyle: CSSProperties = {
  backgroundColor: 'var(--card-unauthorized-bg)',
  borderColor: 'var(--card-unauthorized-border)',
  boxShadow: `0 0 0 1px var(--card-unauthorized-ring)`
}
