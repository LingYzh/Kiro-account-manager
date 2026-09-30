<script setup>
// Phase 0 最小壳：仅用于验证 electron-vite --mode vue 能正确打包 @lingyzh/ui 源码，
// 不接任何业务逻辑，后续任务会替换为真实页面结构。
import { UiCard } from '@lingyzh/ui'
</script>

<template>
    <UiCard title="Kiro Account Manager">
        这是 Vue 迁移中的渲染层最小壳，用于验证构建链路。
    </UiCard>
</template>
