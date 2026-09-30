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

## Phase 2 待决策清单（Pinia 迁移前必须由用户确认，禁止实现者顺手修改）

特征测试已把以下 React 版既有行为锁定为基线。Pinia 版默认照搬；如要修复，需两版同时修改并同步更新测试，否则会破坏两版来回切换的兼容性或行为等价。

- `autoRefreshSyncInfo`：会读入，但从不写回（`flushSaveImmediately` 落盘对象里没有这个 key）。如果照直觉补上写回，Vue 版写出的文档会比 React 版多一个字段。
- `currentMachineId`、`originalMachineId`、`originalBackupTime`：`AccountData` 类型里声明了，实际不读不写，是纯内存态。照类型声明去实现持久化，就会引入跨会话保存机器码的新行为，风险最高。
- `importAccounts`：没有去重，同一邮箱重复导入会生成重复账号。去重只存在于 `importFromExportData` 的 `isAccountExists` 路径。
- 纯函数层：
    - `formatDateSafe` 对非法字符串原样返回，`null` 返回 `1970-01-01`，`undefined` 返回 `''`。
    - `rateLimiter` 一旦触发退避，一次成功不会解除。
    - `updateConfig({ burst })` 要等 `reset()` 才生效。

## 测试踩坑

- 给 esbuild 打包后的 zustand store 做特征测试时，用 `node:test` 的 `mock.timers.enable({ apis: ['setTimeout','setInterval','Date'] })` 可以直接拦截打包产物内部调用的全局定时器，无需修改源码或额外注入。
- `mock.timers.tick(ms)` 只触发"当前已到期"的定时器；如果还有 Promise 在等待尚未到期的定时器就直接 `await Promise.all(...)`，Node 会报 "Detected unsettled top-level await" 并以 exit code 13 退出——必须先 `tick` 够，让所有挂起定时器都触发过一轮，才能安全 await。
- Node 22 全局 `navigator` 只有 getter，`globalThis.navigator = {...}` 直接赋值会抛 TypeError，需要 `Object.defineProperty(globalThis, 'navigator', { value: {...}, configurable: true })`。

## Phase 0 配置结果（2026-09-30）

- electron-vite 默认渲染层入口固定为 `src/renderer/index.html`；`--mode vue` 必须在 `electron.vite.config.ts` 里显式改写 `renderer.root` 为 `src/renderer-vue`、`build.rollupOptions.input` 指向 `src/renderer-vue/index.html`，否则仍会打包 React 入口。`resolve.dedupe: ['vue']` 防止依赖树里出现两份 vue 实例。别名 `@`/`@renderer` 两版各自指向自己的 `src/`，`@shared` 两版共用同一个 `src/renderer-shared/`。
- `src/renderer-shared/` 现含 `types/`（account、machineId、proxy）、`i18n/locales/`（en、zh）、`lib/`（utils、dotVariants、rateLimiter、accountHelpers、webhookPayload），全部 `.ts`。React 侧原文件对可复用符号改为 `export { ... } from '@shared/...'` 重导出，只保留依赖 React/clsx/tailwind 类型的部分（如 `cn()`、返回 `CSSProperties` 的样式生成函数）。
- 特征测试：`test/renderer-shared.mjs`（共享纯函数，逐模块覆盖）、`test/renderer-accounts-store.mjs`（esbuild 打包 `src/renderer/src/store/accounts.ts` 后用 mock `window.api`/`localStorage`/定时器跑持久化、防抖落盘、筛选排序统计、导入导出、代理池五类场景），均已接入 `npm run test:compat` 末尾。两个文件均 4 空格缩进；打包对象只读现有 React 源码，不改源码行为。
- `npm run typecheck:vue`（`vue-tsc -p tsconfig.vue.json`）目前只验证了 `App.vue` 里 `import { UiCard } from '@lingyzh/ui'` 这一条路径，结果是零错误；`@lingyzh/ui` 其余组件尚未被任何 Vue 源码引用过，在 TS 5.9 + vue-tsc 3.3.11 下能否通过还未验证，后续每接入一个新组件都要留意 typecheck:vue 是否新增报错。
- ESLint：React 相关规则块（`flat.recommended`/`jsx-runtime`/react-hooks/react-refresh）原本无 `files` 限定、全局生效，改法是在这些块上加 `ignores: ['src/renderer-vue/**']`，不收窄 React 侧的匹配范围；Vue 专属块只作用于 `src/renderer-vue/**/*.{js,vue}`，用 `vue-eslint-parser` + `parserOptions.parser: tseslint.parser` 解析脚本部分，显式挂 `processor: 'vue/vue'`（缺失会让 `vue/comment-directive` 的占位报告冒出成真实 error）。规则表按字段名合并 `eslint-plugin-vue` flat/recommended 数组里各档 `rules`（不按数组下标取，避免插件升级后静默丢规则），并覆盖 `vue/html-indent: [error, 4]`。改动前后用 `eslint --format json` 统计 React 侧 errorCount/warningCount，确认未回退。
- Prettier：`.prettierrc.yaml` 用 `overrides` 对 `src/renderer-vue/**` 与 `src/renderer-shared/**` 单独设 `tabWidth: 4`，其余（React 侧）仍是默认 2 空格，两套缩进规则并存于同一份配置。

## 子代理配置

- 项目 `.claude/agents/` 定义 `kam-explore`（medium，只读）、`kam-assemble`（high）、`kam-logic`（xhigh），均为 `claude-sonnet-5[1m]`。调用时不传 `model` 参数，否则工具参数会覆盖 frontmatter 退回 200K 窗口；新建或修改后需重启会话生效。
- Agent 工具的 `model` 别名与内置 Explore/Plan 都跑在 200K 窗口（transcript `preTokens` 约 16–18 万即压缩），不能用于长程任务。
- 2026-09-29 已实测 `kam-explore` 生效：transcript 系统提示显示 `claude-sonnet-5[1m]`，KAM 日志 `contextUsageEvent … modelContext=1000000, model=claude-sonnet-5`。子代理起始上下文约 13.4 万 token，200K 窗口下几乎没有工作余量。
- 子代理提示必须限定：超过 800 行的文件只 Grep 或分段 Read，单一主题、限定输出长度。整读 RegisterPage 等大文件曾导致子代理反复压缩失败。

## @lingyzh/ui 升级踩坑

- 本机 `~/.npmrc` 的默认源是 `registry.npmmirror.com`。用它 `npm install @lingyzh/ui` 时，lockfile 的 resolved 会写成镜像地址，而刚发布的版本镜像还没同步，可能根本装不到。
- 做法：升级后把 lockfile 中 `node_modules/@lingyzh/ui` 的 resolved 改回 `https://registry.npmjs.org/@lingyzh/ui/-/ui-<版本>.tgz`，并确认 integrity 与 `npm view @lingyzh/ui@<版本> dist.integrity --registry https://registry.npmjs.org/` 一致。
- 当前版本 0.2.1（2026-09-30），包含 A 批 locale、Badge/Alert/Spinner/Menu/confirmDialog、Button danger、Dialog size 与 placement=end、Input 数字模式，以及 B 批 Checkbox/Radio/Progress/CopyButton/ColorSwatches。

## Phase 1 B 批接续检查点（2026-09-30）

- 接续 Claude Desktop 会话“安装 @lingyzh/ui 依赖”（`3b754c04-578a-400a-b27e-a88972a2c295`）。最后一轮测试在 17:03 完成，17:04 的月度额度 402 发生在工具结果返回之后，不能把本轮测试记为未完成。
- UI 仓库 main 已提交 B 批五个组件（UiCheckbox、UiRadio、UiProgress、UiCopyButton、UiColorSwatches）及文档、demo、测试与评审修复；发布准备提交为 `449183b`，源码与 lockfile 版本均为 0.2.1。
- 已复核原会话结果及落盘报告：类型检查、单元测试 23/23、文档与库构建、TS 5.9.3 兼容检查通过；最终完整 UI 回归 20/20（44 个文档路由，`UI/artifacts/ui-r0qXEX/report.json`）、A 批专项 7/7（`feedback-BrclXY/report.json`）、B 批专项 6/6（`controls-JpdjPc/report.json`）通过。Codex root 另直接复核了 Checkbox 禁用与半选、Radio、Progress、CopyButton 浅深成功态和色板外已保存颜色的截图。
- 发布前打包预览包含五个新组件与 controls.css，共 154 个文件；没有带入测试或 artifacts。接续初检时 npm 官方 registry 的 latest 为 0.2.0，UI 本地尚无 v0.2.1 标签；首次远端标签查询因连接重置未能确认。
- 2026-09-30 用户已明确确认发布，npm 网页授权由用户完成；发布与 KAM 升级结果见下节。
- 接续初检时 KAM 在 feat/vue-migration，实际依赖、lockfile 与安装目录均为 @lingyzh/ui 0.2.0。Phase 2 尚未开工，开工前仍须细化计划并确认上面的待决策清单。

## Phase 1 完成：0.2.1 发布与 KAM 升级（2026-09-30）

- 官方 npm 已发布 @lingyzh/ui 0.2.1，latest 指向 0.2.1；UI main 与注释标签 v0.2.1 已原子推送，标签解引用为发布准备提交 `449183b2f8095d7b2f4b9a097ca9c6213fbd84c5`。UI 发布记录位于其 `.Codex/memory/publishing.md` 与 HANDOFF.md。
- KAM package.json 精确依赖、lockfile 和实际安装目录均已升级为 0.2.1；安装目录是普通目录，非本地链接。lockfile tarball 为 `https://registry.npmjs.org/@lingyzh/ui/-/ui-0.2.1.tgz`，integrity 与官方 registry 一致（`sha512-c7oSquzKLuYbfb/fI0yT2Z98N1zGxZCQ4Rov+h/u74RA/hR2dusIxPosYONVmnwWiDYZhdMnkYJ2El3dM9fEEw==`）。
- 升级后已通过 npm run typecheck:vue、npm run build（含主进程与 React 类型检查）、npm run build:vue、npm run test:compat；后者包含 43 项模拟 HTTP 检查、共享模块与 accounts store 特征测试。未运行消费真实账号额度的在线测试。
- Phase 1 的 UI 库补缺与两批发布完成。KAM 升级仅本地提交到 feat/vue-migration；Phase 2 仍须细化计划并确认既有行为待决策清单后再开始。
