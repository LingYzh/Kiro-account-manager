# 渲染层 React → Vue 3 + @lingyzh/ui 迁移

## 目标与决策（2026-09-29）

- 渲染层从 React 19 + zustand + Tailwind 4 迁到 Vue 3.5 + Pinia + `@lingyzh/ui`（自研 UI 库，源码仓库 `E:\WebstormProjects\UI`，参考消费方 `E:\WebstormProjects\UAH-desktop`）。
- 并行目录 `src/renderer-vue/` 逐步替换，electron-vite `--mode vue` 切换渲染入口；React 版照常发版，Vue 版功能对齐后一次切换并删除 React。
- 页面/业务组件 `<script setup>` JS；store、lib、types、composables、持久化层 TS。
- 外观完全采用 UI 库，移除 Tailwind，布局用 UI 库 `utilities.css`；只保留明暗/跟随系统主题，放弃 31 套 `theme-*` 色板与 glass 风格。
- UI 库缺失的可复用组件必须先在 UI 仓库实现、demo、验收、发布，KAM 再升级依赖；KAM 内不自建通用组件。UI 库新增 locale 机制支持 zh/en。
- 图标用 `lucide-vue-next@0.555.0`，虚拟列表用 `@tanstack/vue-virtual@3.13.12`（均与现 React 依赖同版本）。
- 完整路线与 UI 缺口清单见会话计划；每阶段开工前再写细化计划并确认。

## 数据兼容边界

- 两版需能在同一台机器来回切换：`window.api.saveAccounts` 文档字段（以 `src/preload/index.d.ts` 的 `AccountData` 为准）与 localStorage 键名、值格式不变；Vue 版不用的 `theme` 字段原样读入并回写。
- 保留 `accounts.ts` 的 500ms 防抖 + 5s 强制落盘 + 在途合并时序。
- `currentMachineId/originalMachineId/originalBackupTime` 不在 `flushSaveImmediately` 写入字段内，迁移不改变这一语义。
- 迁移前先用 `test/renderer-*.mjs` 特征测试锁定 React 版行为，Pinia 版必须同样通过。
- `test/renderer-accounts-store.mjs`（Task 6）已用特征测试锁定 accounts store 持久化、保存时序、筛选排序统计、导入导出、代理池行为，作为 Pinia 版验收基线；`autoRefreshSyncInfo` 是"读入内存但从不写回磁盘"的疑似 bug（`loadFromStorage` 会读，`flushSaveImmediately` 落盘对象里没有这个 key）——与 `currentMachineId` 系三个字段不同：那三个字段 `loadFromStorage` 根本不读取 `data` 里的值（完全不参与持久化往返，不读不写），不是"读了不写"。

## 测试踩坑

- 给 esbuild 打包后的 zustand store 做特征测试时，用 `node:test` 的 `mock.timers.enable({ apis: ['setTimeout','setInterval','Date'] })` 可以直接拦截打包产物内部调用的全局定时器，无需修改源码或额外注入。
- `mock.timers.tick(ms)` 只触发"当前已到期"的定时器；如果还有 Promise 在等待尚未到期的定时器就直接 `await Promise.all(...)`，Node 会报 "Detected unsettled top-level await" 并以 exit code 13 退出——必须先 `tick` 够，让所有挂起定时器都触发过一轮，才能安全 await。
- Node 22 全局 `navigator` 只有 getter，`globalThis.navigator = {...}` 直接赋值会抛 TypeError，需要 `Object.defineProperty(globalThis, 'navigator', { value: {...}, configurable: true })`。

## 子代理配置

- 项目 `.claude/agents/` 定义 `kam-explore`（medium，只读）、`kam-assemble`（high）、`kam-logic`（xhigh），均为 `claude-sonnet-5[1m]`。调用时不传 `model` 参数，否则工具参数会覆盖 frontmatter 退回 200K 窗口；新建或修改后需重启会话生效。
- Agent 工具的 `model` 别名与内置 Explore/Plan 都跑在 200K 窗口（transcript `preTokens` 约 16–18 万即压缩），不能用于长程任务。
- 2026-09-29 已实测 `kam-explore` 生效：transcript 系统提示显示 `claude-sonnet-5[1m]`，KAM 日志 `contextUsageEvent … modelContext=1000000, model=claude-sonnet-5`。子代理起始上下文约 13.4 万 token，200K 窗口下几乎没有工作余量。
- 子代理提示必须限定：超过 800 行的文件只 Grep 或分段 Read，单一主题、限定输出长度。整读 RegisterPage 等大文件曾导致子代理反复压缩失败。
