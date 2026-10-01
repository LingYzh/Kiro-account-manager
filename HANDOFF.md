# Vue 迁移接续交接

更新日期：2026-10-01。发布接续分支：`master`；迁移历史保留于 `feat/vue-migration`。应用源码和 npm 命令位于仓库内 `Kiro-account-manager/`。

## 当前进展：Phase 4 默认 Vue 与清理

用户在 Phase 3 全页面离线验收后明确要求“开始phase4吧”，随后授权合并 master 并发布。默认 `dev/build/typecheck:web` 已切换到 Vue，旧 React 渲染源码、专用预览和 17 项直接依赖已归档/移除；package/lock 和双语日志同步至 1.8.0。迁移已快进合并并推送 master，`v1.8.0` 标签指向发布提交 `a69a6a6f17c46ea1f846f742ec1d94223665bc9d`。[Build & Release 36839452848](https://github.com/LingYzh/Kiro-account-manager/actions/runs/36839452848) 全部成功，[正式 Release](https://github.com/LingYzh/Kiro-account-manager/releases/tag/v1.8.0) 已发布 22 个产物。品牌、托盘和图标修改随迁移保存，原有 IDE 工作区文件保持本地。

15 个业务页及业务弹窗全部实现：首页、账号、机器码、Kiro 设置、API 反代、KProxy、代理池、注册、订阅、Webhooks、诊断、配置同步、日志、设置与关于。页面首次访问创建，隐藏保留实例，卸载释放订阅/定时器。ExportDialog、UpdateDialog 与关闭确认均已接入。按用户要求，应用没有加入群聊按钮或二维码弹窗；README 联络图片保留于 `resources/community-qr.png`。

Phase 4 的默认入口回归、Windows x64 解包构建、安装包资源和三平台发布结果见 [当前验收](docs/vue-phase4-validation.md)，范围见 [Phase 4 方案](docs/vue-phase4-plan.md)。真实账号、收费订阅、注册、系统变更及各平台实际安装/运行/自动更新仍待对应环境验收；不能将离线 fixture 或 CI 打包结果写成实机业务成功。

## 恢复与启动

仓库：`git@github.com:LingYzh/Kiro-account-manager.git`。换设备先检查本地修改，再获取/切换 `master` 并快进；发布代码可从 `v1.8.0` 标签恢复，迁移分支保留阶段历史。

读取 `AGENTS.md`、本文件和 `.Codex/memory/vue-migration.md`，进入应用目录：

```sh
cd Kiro-account-manager
npm ci
npm run dev
```

Node 支持 20.x >=20.19 或 >=22.12。默认命令适用于 Windows/macOS/Linux，Node 启动器只在 Windows 交互控制台设置 UTF-8，electron-vite 继承控制台；无需 `--mode vue`。`dev:vue/build:vue/typecheck:vue` 保留兼容别名。原生依赖需在目标平台安装，不复制旧设备的 `node_modules` 或 `out`。

正式 UI 为 `@lingyzh/ui@0.2.2`，package/lock/实际安装一致，使用官方 tarball/integrity，不依赖 UI checkout 或本地链接。候选可显式使用 `npm run test:vue-shell -- --ui-source D:\\UI-ripple-fix`；默认测试使用正式依赖并覆盖开发冷启动。

## 入口、打包与源码清理

- `electron.vite.config.ts` 所有模式使用 Vue 插件与 `src/renderer-vue/index.html`，保留 `@/@renderer/@shared` 和 Vue dedupe；源码路径不改名，产物保持 `out/renderer/`，主进程仍加载 `../renderer/index.html`。
- `tsconfig.web.json` 是 Vue 检查入口，`tsconfig.vue.json` 兼容继承；调试、ESLint 与发行脚本均已更新。macOS/Linux 发行脚本也先运行完整类型检查和构建。
- 旧 `src/renderer/`、`test/ui-preview/`、React client-config 预览及 accounts wrapper 已移出工作区；原五组账号 golden 特征断言保留，由真实 Pinia store 执行。
- React、React DOM、Zustand、Tailwind、framer-motion、React 虚拟列表/图标、cva/clsx/tailwind-merge 以及对应类型/构建/lint 插件已从 manifest/lock 移除。主进程网络/原生依赖保留。
- 安装包排除源码、测试和开发启动器。三平台 CI 继续调用默认 Vue 构建；Windows universal NSIS 与 latest.yml 多架构契约未改。

旧源码先逐文件校验 100 个文件的 ZIP 快照，再归档移出。当前设备可恢复副本：
`C:/Users/AnnaC/AppData/Local/Temp/kam-phase4-backup-ed99690ec13a43e391ca397f3ccc0987/`。
包含 `react-source.zip`、`inventory.json` 和 `retired/`，ZIP SHA256 为 `63DB50C12205F2BE7E067FB8FF418609E87F40D0D7402B8093276E95C830F4C5`。这是当前设备临时备份，跨设备接续依赖仓库源码/历史，不能假定该目录同步。归档包含先前未提交的 React 品牌和群聊移除修改。

## 已锁定的行为边界

- AccountData 和原 localStorage 键/格式保持。保存使用 500ms 防抖、5s 强制落盘和在途合并；`autoRefreshSyncInfo` 读而不写，机器码三项纯内存，普通 `importAccounts` 不去重。其他日期/限流 golden 边界也保留。
- Vue 主题键为 `kiro-vue-theme-mode`（light/dark/system）；旧 `theme` 原样透传，`darkMode` 保存实际布尔值。设置页复用 `app.setThemeMode`。
- IPC 入参用 `lib/ipcData.ts` 的 `toIpcData()` 递归移除 Vue Proxy，保留字段/undefined。替换嵌套状态使用 `$patch(state => ...)`，避免对象 patch 的合并语义。跨 store 操作绑定当前 Pinia。
- app 管理 8 项 IPC、2 项 DOM 监听、120ms 后台合批、400ms 托盘同步和 8s 封禁通知；初始化晚返回不得在 dispose 后恢复任务。组件窗口/关闭订阅成对释放。
- tasks 保存最近 200 条完成历史并排除回调；webhooks 保持 JSON 数组、20 次/分钟与三次重试。旧 store 吞掉发送失败的行为不在迁移中改变。
- 代理配置串行写入，启动等待队列；完整上下文、未知模型 ID、effort、Key 作用域、客户端配置与 Desktop 应用/恢复保持。代理池四策略/五状态及 alive 候选语义保持。
- 订阅状态绑定当前 Pinia，注册在订阅页创建前可写链接；在途清空不复活旧链接，超额切换跨 tab 互斥。注册六邮箱源、手动三阶段、批量/并发/重试/暂停/取消和自动/手动导入差异保留，原 SWRR 零权重增 1 的边界由 golden 锁定。
- 易变业务页面/composable 用 JS `<script setup>`，稳定基础/store/types 用 TS；四空格、具名业务 function。仅使用正式 UI tokens/控件与 lucide-vue-next。通用缺口先在 UI 仓库实现、demo、验收、发布，再升级 KAM。
- 不使用 superpowers 插件技能组；历史方案目录仅为历史文件。当前会话均衡编排，以 GPT-6 Sol medium 替代 Terra；Luna 不参与决策或美学，root 负责设计和最终验收。

## 历史故障与排查入口

白屏曾由 UI 源码 SFC 内的 highlight.js CommonJS 预构建引起。当前配置排除 UI 本体预构建，显式 include 嵌套 highlight.js core/语言及 markdown-it 插件；必须保留。用户确认修复后可正常显示。

原整页反色来自 Logo scoped `:global(:root[...])` 误编译根元素滤镜，已修正；用户新 PNG 浅深均原色。侧栏改为纵向 UiTabs/UiTabPanel，折叠/展开与导航顺序保留。底部 ripple class 更新修复已在 UI 0.2.2 发布，正式依赖和真实 Electron 像素检查通过。

遇到新白屏，记录命令/页面 URL、首条 Renderer 错误/堆栈、Network 失败和 `#app` DOM；不要用主进程日志证明挂载。现在所有模式都是 Vue，检查当前 renderer root/input、别名、预构建和 preload。prod 离线测试必须保留 CLI 的 `NODE_ENV_ELECTRON_VITE=production`，确保 `./assets` 相对路径。store/runtime 测试不能替代真实 Electron 页面验收。

## 当前验证与后续工作

```sh
npm run typecheck
npm run test:compat
npm run test:vue-contracts
npm run test:vue-shell
npm run build
npm run test:packaged-renderer -- <app.asar绝对路径>
```

当前结果和本机临时证据路径以 [Phase 4 验收](docs/vue-phase4-validation.md) 为准。离线测试使用合成数据、临时 userData 和离线 preload，不加载生产主进程/账号或运行消费额度的 `test:e2e`。logger/tlsClientPool 原有混合动态/静态导入提示保留。

Release CI 已通过 Windows 三架构通用 NSIS、macOS x64/arm64 和 Linux x64/arm64/armv7l 打包。正式发布的 Windows latest.yml 仅指向通用 setup.exe，latest-mac.yml 包含双架构 ZIP/DMG，Linux 分架构清单齐全；全部清单的版本、引用资源、文件大小及 SHA512 格式已核对。实际安装/自动更新、托盘、OS/文件、账号往返、证书及真实服务仍需在相应环境验收，离线结果不能替代。

## 参考资料

- [项目约定](AGENTS.md)、[迁移记忆](.Codex/memory/vue-migration.md)
- [Phase 2 运行和系统清单](docs/vue-phase2-validation.md)
- [Phase 3 验收及各批次记录](docs/vue-phase3-validation.md)
- [Phase 4 方案](docs/vue-phase4-plan.md)、[Phase 4 验收](docs/vue-phase4-validation.md)
- [品牌与视觉来源](Kiro-account-manager/src/renderer-vue/brand-spec.md)

历史 Phase 0/1/2 方案位于 `docs/superpowers/plans/`，Phase 3 各模块方案位于 `docs/vue-phase3-*-plan.md`。原 Claude 接续会话“安装 @lingyzh/ui 依赖”（`3b754c04-578a-400a-b27e-a88972a2c295`）和旧设备本地 transcript 不是接续依赖。
