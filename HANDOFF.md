# Vue 迁移接续交接

更新日期：2026-09-30。接续分支：`feat/vue-migration`。应用代码和 npm 命令位于仓库内的 `Kiro-account-manager/`，不是仓库根目录。

## 当前阻塞：Vue 窗口白屏

用户运行后反馈“白色窗口，但是能打印出后台日志”。Phase 2 的实现、类型检查、构建与离线测试已通过，但真实 Electron 渲染验收失败，不能视为 Phase 2 已验收完成。

目前没有取得 Renderer DevTools 的报错堆栈、Network 失败记录或挂载状态，白屏根因尚未定位。后台日志只能说明后台有代码在运行，不能证明 Vue 入口加载、组件挂载或页面绘制成功。用户要求先保存交接、提交推送，再到另一设备继续；本次检查点保留这个问题，不追加修复。

下一步先排查白屏并完成外壳运行验收，再开始业务页迁移。不要直接把白屏归因于账号数据、主题、UI 库或 Pinia，也不要通过清空真实账号、localStorage 或 userData 试错。

## 阶段状态

| 阶段 | 当前状态 | 接续工作 |
| --- | --- | --- |
| Phase 0：并行 Vue 入口、共享模块、特征测试 | 完成 | 保持 React/Vue 并行和共享边界 |
| Phase 1：补齐 UI 库、发布、升级依赖 | 完成 | KAM 精确使用已发布的 `@lingyzh/ui@0.2.1` |
| Phase 2：Vue 外壳与完整 Pinia 数据层 | 代码与静态/离线检查完成；实际窗口白屏 | 定位渲染问题、补对应验证、完成运行与视觉验收 |
| Phase 3：业务页分批迁移 | 尚未开始 | 按下方批次迁移 15 个业务页及业务弹窗 |
| Phase 4：默认入口切换与清理 | 尚未开始 | 功能对齐且运行验收通过后切换与删除旧依赖 |

KAM 应用版本仍是 `1.7.9`，默认 `dev/build` 和发布渠道仍为 React。本次是迁移分支检查点，不发布 KAM 版本或标签。

## 换设备恢复

仓库：`git@github.com:LingYzh/Kiro-account-manager.git`。

已有 checkout 时先 `git fetch origin`，切到 `feat/vue-migration`；该本地分支尚不存在时使用 `git switch --track origin/feat/vue-migration`。已有本地分支则 `git switch feat/vue-migration`，确认没有未提交修改后 `git pull --ff-only`。

在仓库根目录读取本文件、`AGENTS.md`、`.Codex/memory/vue-migration.md`，再进入应用目录：

```sh
cd Kiro-account-manager
npm ci
```

Windows 上用 `npm run dev:vue` 启动 Vue。当前 `dev` 与 `dev:vue` 脚本含 Windows 的 `chcp`；若另一设备是 macOS/Linux，启动 Vue 可用 `npx electron-vite dev --mode vue`，React 则 `npx electron-vite dev`。原生依赖须在目标设备安装，不能复制当前设备的 `node_modules` 或 `out`。

UI 已在 npm 发布，无需依赖当前设备的 UI checkout 或本地链接。lockfile 使用官方 registry 的 0.2.1 tarball；新版本镜像同步延迟时优先核对官方源，不随意改回镜像或本地路径。

全部接续所需源文件、方案和交接随本检查点提交。当前设备的 Claude transcript、临时迁移脚本、构建目录与用户账号数据都不是接续依赖。

## 白屏排查入口

以下是排查顺序，不是已确认的根因：

1. 记录启动命令和渲染页面 URL，确认带 `--mode vue`。查看应用 `electron.vite.config.ts` 的 Vue 分支、`src/renderer-vue/index.html`、`src/renderer-vue/src/main.js`，确认加载 Vue 入口及 `#app`。
2. 打开 Electron Renderer DevTools，保留第一条错误及完整堆栈，并检查 Network 的失败模块、入口脚本、样式或资源请求。优先使用渲染进程证据，不用主进程日志替代。
3. 检查 `document.querySelector('#app')` 和其子节点：没有挂载内容时沿模块加载、`createApp().use(createPinia()).mount()`、`App.vue` setup 查；已有外壳节点时再沿容器尺寸、可见性和实际 CSS 查。
4. 按首条错误检查 `@lingyzh/ui` 的源码导出与依赖、Vue 实例去重和 `@shared` 别名；检查 `window.api` preload 是否可用及 `useAppStore()` 等 store 初始化调用。组件级窗口/关闭订阅也可能早于异步初始化运行，须依据堆栈判断。
5. 不把上述候选项直接写成结论。修复后复现原启动路径，增加能覆盖实际失败入口的组件挂载或渲染验证，再执行下面的检查与用户运行验收。

现有 `renderer-vue-runtime.mjs` 使用浏览器/API mock，覆盖 store、composable 和生命周期，**没有挂载真实 `App.vue` 或 Electron 页面**。它通过不等于 Vue 外壳能显示；当前白屏说明这项验证边界必须补足。

## Phase 2 已落盘内容

以下源码路径相对应用目录：

- `src/renderer-vue/src/stores/`：accounts、settings、autoSwitch、proxyPool、machineId、tasks、webhooks 七个业务 setup store，以及 persistence/app 协调层。原 accounts 97、tasks 9、webhooks 8 个动作已迁移并核对公开导出。
- `src/renderer-vue/src/components/`：TitleBar、Sidebar、TaskCenter、PagePending 和 CloseConfirmDialog。15 个导航 ID 与顺序保留，侧栏初始折叠，已访问页面用 `v-show` 保留；业务页目前全部是 Phase 3 占位。
- `src/renderer-vue/src/composables/`：主题、语言、窗口控制、关闭确认。`App.vue` 接入提示和确认 Host；`main.js` 注册 UI 剪贴板 writer。
- `src/renderer-vue/src/lib/`：IPC 数据转换、导航、任务展示和账号运行辅助逻辑。共享目录增加双语 shell 文案与原 Kiro Logo；React 业务行为保持原样。
- `test/renderer-accounts-scenarios.mjs`：React/Pinia 共用原五组特征断言；两版 wrapper 分别运行。`test/fixtures/vue-*.ts` 仅为测试适配器，不是生产兼容 facade。
- `test/renderer-vue-runtime.mjs`：八组离线场景；已加入 `npm run test:compat`。ESLint/Prettier 只对本次 Vue/shared/测试范围作必要配置调整。

## 已确认的兼容边界

- React/Vue 能来回切换；`AccountData` 与原 localStorage 键、值格式保持。实际保存白名单以 React 保存代码为准，不按类型的全部可选字段扩写。
- 保存保持 500ms 防抖、5s 强制落盘和在途合并。用户明确要求本阶段既有行为全部保留：`autoRefreshSyncInfo` 读但不写；机器码三项纯内存，不读不写；普通 `importAccounts` 不去重；日期和限流的已记录边界也保留。
- Vue 新主题键为 `kiro-vue-theme-mode`（light/dark/system）；旧 `theme` 原样透传，`darkMode` 仍保存实际布尔值。业务设置页复用 `app.setThemeMode`，不能另建冲突的主题状态。
- 跨 Electron IPC 前用 `lib/ipcData.ts` 的 `toIpcData()` 递归移除 Vue Proxy，保留字段与 undefined；不能直接发送 Pinia 对象。
- 需要 Zustand 式替换时用 `$patch(state => { state.field = value })`；`$patch(object)` 会合并嵌套对象，可能保留旧筛选/配置键。跨 store 调用绑定当前 Pinia 实例。
- app 管理 8 项 IPC 和 2 项 DOM 监听、120ms 后台合批、400ms 托盘同步和 8s 封禁通知基线；初始化晚返回不得在 dispose 后恢复任务。窗口与关闭订阅在组件中成对释放。
- `onProxyAccountUpdate` 仅同步 Enterprise profileArn；`onProxyAccountSuspended` 沿原状态更新与防抖保存；语言托盘 IPC 避免重复触发。
- tasks 只保存最近 200 条完成历史且排除回调；webhooks 保持原 JSON 数组、20 次/分钟限速与三次重试。测试全部使用合成数据和 mock。
- 新页面用 JS `<script setup>`；store/lib/composable/types 用 TS。四空格缩进，具名业务方法用 `function`。
- 外观使用 `@lingyzh/ui`、tokens/utilities 和 `lucide-vue-next`；KAM 不自建通用组件。通用缺口先到 UI 仓库实现、demo、验证、发布后再升级 KAM。
- 后续不使用 superpowers 插件技能组。历史方案目录名称不代表启用该插件。旧 Claude 子代理配置只作历史记录，不能覆盖当前 harness/用户编排约定。

## 验证记录与下一次验收

本检查点前已通过以下检查；用户随后报告白屏，尚未修复，也未重新完成真实运行验收：

```sh
npm run typecheck:vue
npx eslint src/renderer-vue --no-cache
npm run test:compat
npm run build
npm run build:vue
```

`test:compat` 包含 43 项模拟 HTTP 检查、共享模块、两版共用五组 accounts 场景和新增八组 Vue 离线场景。React 构建包含主进程和 React 类型检查。主进程既有 logger/tlsClientPool 混合动态、静态导入提示仍存在。

当前设备最后一次构建为 Vue，因此本机忽略目录 `out/renderer` 对应 Vue；新设备必须自行构建，不能从默认脚本名或旧 out 内容推断当前窗口入口。

白屏修复后按 [Phase 2 验收清单](docs/vue-phase2-validation.md) 复核窗口/关闭、侧栏、主题、双语、任务及 React/Vue 数据往返。实际账号与交互测试由用户进行；不要自行运行消费真实额度的 `test:e2e`。

## 剩余 Phase 3：逐批迁移业务页

每批开工前基于当前源码细化范围、组件缺口和验收，再按项目协作约定确认。原计划中的文件数/IPC 数只是迁移前盘点，接续时须核对当前源码。

1. 小页面：About、Webhooks、Logs、Diagnose、ConfigSync、MachineId、KiroSettings（含 `kiro/` 编辑器）、KProxy。
2. Home、Settings（含 ExportDialog）、UpdateDialog。原路线还列了 CloseConfirmDialog，它已提前进入 Phase 2，接续只检查集成与运行验收，避免重复迁移。
3. `accounts/` 模块，原盘点 15 个文件，包含账号列表、工具栏、卡片/行及业务弹窗。
4. `proxy/` 模块与 ProxyPool，原盘点 13 个 proxy 文件，ProxyPanel 有 47 处 IPC；保持代理行为、订阅与释放语义。
5. Subscription、Register：先拆业务 composable，再迁模板，保持原流程、副作用和用户数据。

每批逐项替换 PagePending，并保留页面首次访问后实例。核对 IPC 参数、调用顺序、主题/双语、加载/错误/空态、取消及释放；按页面真实行为验证，不能靠构建成功确认页面可用。

发现 UI 通用缺口走 UI 仓库流程；业务组件可留 KAM。不要在页面迁移中顺手修复已锁定的兼容行为或变更代理协议。

## 剩余 Phase 4：切换与清理

进入条件：Phase 2 白屏已解决，Phase 3 全部功能对齐，Vue 真实运行与用户验收通过。

- 把默认开发/构建入口切换到 Vue，并核对 Windows/macOS/Linux 打包、preload、资源路径和自动更新产物。
- 删除旧 `src/renderer/` 与确认无引用的脚手架残留；按实际引用移除 React/Zustand/Tailwind/framer-motion、React 虚拟列表/图标、cva/clsx/tailwind-merge、React 类型和构建/lint 插件等旧依赖，更新 lockfile。
- 调整 TS、ESLint、测试入口与引用；迁移或按价值清理 `test/ui-preview`，确认共享模块没有旧渲染目录依赖。删除前先核对引用，不凭原清单机械删除。
- 更新 AGENTS、项目记忆、README/变更日志与验证文档。发布版本、标签、GitHub Release 按用户后续明确发布指令执行；Windows 保持通用 NSIS 与正确 latest.yml 约定。

## 仓库内参考资料

- [项目约定](AGENTS.md)
- [迁移记忆与兼容细节](.Codex/memory/vue-migration.md)
- [Phase 0 方案](docs/superpowers/plans/2026-09-30-vue-migration-phase0.md)
- [Phase 1 方案](docs/superpowers/plans/2026-09-30-vue-migration-phase1.md)
- [Phase 2 细化方案](docs/superpowers/plans/2026-09-30-vue-migration-phase2.md)
- [Phase 2 运行验收](docs/vue-phase2-validation.md)
- [Vue 品牌与视觉来源](Kiro-account-manager/src/renderer-vue/brand-spec.md)

原 Claude Desktop 接续会话为“安装 @lingyzh/ui 依赖”（`3b754c04-578a-400a-b27e-a88972a2c295`）。原总计划只在旧设备的 Claude 本地目录；本文件已经补齐剩余阶段，另一设备无需寻找该目录。
