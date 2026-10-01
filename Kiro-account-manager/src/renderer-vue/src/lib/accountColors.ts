export const TAG_PRESET_COLORS = [
    { name: '红色', value: '#ffef4444' },
    { name: '橙色', value: '#fff97316' },
    { name: '黄色', value: '#ffeab308' },
    { name: '绿色', value: '#ff22c55e' },
    { name: '青色', value: '#ff06b6d4' },
    { name: '蓝色', value: '#ff3b82f6' },
    { name: '紫色', value: '#ff8b5cf6' },
    { name: '粉色', value: '#ffec4899' },
    { name: '灰色', value: '#ff6b7280' },
    { name: '浅红', value: '#80ef4444' },
    { name: '浅绿', value: '#8022c55e' },
    { name: '浅蓝', value: '#803b82f6' },
    { name: '浅紫', value: '#808b5cf6' }
] as const

export function parseArgb(color: string): { alpha: number; rgb: string } {
    if (color.length === 9 && color.startsWith('#')) {
        return { alpha: parseInt(color.slice(1, 3), 16), rgb: `#${color.slice(3)}` }
    }
    return { alpha: 255, rgb: color }
}

export function toArgb(rgb: string, alpha: number): string {
    const hex = rgb.startsWith('#') ? rgb.slice(1) : rgb
    const alphaHex = Math.round(alpha).toString(16).padStart(2, '0')
    return `#${alphaHex}${hex}`
}
