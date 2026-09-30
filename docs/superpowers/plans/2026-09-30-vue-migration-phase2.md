# Phase 2：Vue 应用外壳与 Pinia 数据层（细化方案）

状态：实现与静态/离线验证完成；用户实际启动反馈白屏，运行验收失败、根因待排查。接续先处理白屏，再开始 Phase 3。后续不使用 superpowers 插件技能组。日期：2026-09-30。

最新交接：用户要求把当前实现与 handoff 提交并推送到 `feat/vue-migration`，随后换设备继续；该指令更新下面原实施边界中的“不推送”约定。本次不发布 KAM。排查入口与剩余阶段见仓库根目录 [HANDOFF.md](../../../HANDOFF.md)。

依据：原总计划 `C:\Users\ALing\.claude\plans\eager-baking-music.md`、项目 `.Codex/memory/vue-migration.md`、现有 React 源码与 Phase 0 特征测试。应用目录为仓库内的 `Kiro-account-manager/`，下文源码路径均相对该应用目录。

## 已确认的本阶段决策

- 特征测试锁定的既有行为全部保留，不借迁移修复。用户已于本阶段准备过程中明确选择“全部保持现状”。
- 增加 Vue 专属 localStorage 主题偏好，保存浅色、深色或跟随系统；原 `AccountData.darkMode` 仍为当前生效的布尔值，原 `theme` 字段照常读写。用户已明确选择此方案。
- 保持并行入口：React 仍是默认构建与发布渠道；本阶段完成后 Vue 仍不是完整业务版本。
- 主代理负责方案、实现、样式与验收。本阶段按顺序执行，不沿用原 Claude 会话的子代理配置，也不创建新会话。

## 交付范围

完成 Vue 应用初始化、七个业务 Pinia store、统一持久化、应用生命周期、主题与多语言，以及 TitleBar、Sidebar、TaskCenter 和关闭确认弹窗。所有现有数据层动作都迁移，不能只实现外壳实际用到的动作。

保留 15 个页面 ID 和原导航顺序，提供明确标注“待 Phase 3 迁移”的页面占位。页面首次访问后用 `v-show` 保留实例，避免后续业务页在切页时重建。业务页面、业务编辑弹窗、更新弹窗仍在 Phase 3 迁移。

关闭确认弹窗提前到本阶段：标题栏 `window.api.window.close()` 会触发 `onShowCloseConfirmDialog`；没有接收者时关闭流程不可用。Vue 弹窗继续通过 `sendCloseConfirmResponse(action, rememberChoice)` 回复原主进程，不修改主进程关闭策略。

## 修改边界

- 主要新增和修改：`src/renderer-vue/`、离线 `test/renderer-*.mjs`、`package.json` 测试脚本，以及项目记忆和本方案。
- 按需要修改：`src/renderer-shared/` 的纯函数、类型、资源和双语文案；React 侧只允许为共用纯函数或静态资源调整引用，不改变业务行为。
- 保持现有主进程、preload API 和代理协议；剪贴板复用当前 `navigator.clipboard.writeText`，无需新增 IPC。
- 不删除 React、Zustand、Tailwind 或 framer-motion，不更改默认构建入口，不发布 KAM、不推送 KAM 分支。
- 不操作真实账号、真实 localStorage 或 Electron userData；不启动真实应用或运行消耗额度的 `test:e2e`。KAM 的运行与视觉验收交给用户。
- 新代码四空格缩进；页面与业务组件使用 JS `<script setup>`，store、composable、lib、types、持久化使用 TS。具名业务方法使用 `function`。
- 只使用 `@lingyzh/ui@0.2.1` 已有组件、utilities 和 tokens。若发现通用组件缺口，先返回 UI 仓库补齐并走原发布流程，不在 KAM 自建通用组件或覆盖库内部样式。

## 1. 建立共用验收基线

文件：`test/renderer-accounts-store.mjs`、新增 `test/renderer-accounts-scenarios.mjs`、`test/renderer-vue-accounts-store.mjs` 与测试专用 Vue 入口。

- 把现有五组场景及合成数据提取为同一套场景 runner，React 与 Vue 分别启动独立 Node 测试进程，避免模块、定时器和缓存互相污染。
- React 继续加载现有 Zustand store；Vue 测试入口用真实 `createPinia()` 创建拆分后的 store，通过仅测试使用的适配器提供现有断言需要的状态与动作。
- 适配器只拼接状态读取和动作调用，不模拟业务行为；生产代码不引入 Zustand `getState/setState` 兼容层。
- 保留现有断言与数据，先证明提取后的 React 基线通过，再用完全相同的五组场景验收 Vue：持久化往返、保存时序、筛选排序统计、导入导出、代理池。
- 两版使用相同浏览器/API mock 与合成账号；不得读取真实用户目录、请求上游或发送真实 Webhook。

## 2. 拆分 Pinia setup stores

目录：`src/renderer-vue/src/stores/`。职责与迁移范围如下：

| 文件 | 职责 |
| --- | --- |
| `accounts.ts` | accounts/groups/tags、激活账号、筛选排序与选择、CRUD、导入导出、状态与 Token 刷新、后台结果应用、SSO 同步、统计 |
| `settings.ts` | 版本、语言、旧主题字段与 darkMode、隐私、用量精度、代理配置、自动刷新参数、主动续期与其他现有设置 |
| `autoSwitch.ts` | 自动换号设置、定时器、候选选择与切换触发，复用 accounts 的账号切换动作 |
| `proxyPool.ts` | 代理池、配置、游标、账号绑定、导入导出、策略选取、验活与自动补全 |
| `machineId.ts` | 机器码配置、纯内存机器码状态、历史和账号绑定、修改/恢复/备份动作 |
| `tasks.ts` | 任务创建、更新、结束、取消、清理、活动计数与任务历史 |
| `webhooks.ts` | 配置 CRUD、事件筛选、发送、测试、重试、限速与本地保存 |

- 使用 `ref` 与 `computed`，所有需要被追踪的状态从 setup store 返回。组件需要解构状态时用 `storeToRefs`。
- accounts 的 `_filterCache/_statsCache` 改为 computed；比较顺序、默认值、搜索、排序稳定性与统计分类保持现状。共享纯函数若需要抽取，先用现有特征测试验证 React 行为没有变化。
- 保持所有现有动作、参数、返回值和 IPC 调用顺序；按原模块分段迁移并核对动作清单，避免遗漏目前尚无 Vue 页面调用的接口。
- 跨 store 调用放在动作或 computed 内，禁止 setup 顶层彼此读取而形成初始化循环。持久化层只在加载/保存动作内取得相关 store。
- 定时器、在途 Promise 与退订函数归所属 Pinia 实例管理，不置于跨实例共享的可变模块全局中。
- 任务回调保持当前生命周期和取消语义；`kiro-task-history` 只存最近 200 条已完成任务，排除回调函数，读入历史时继续处理遗留运行态。
- `kiro-webhooks` 继续保存同样的 JSON 数组；保留当前每 Webhook 限速、重试次数与退避时序，消息体直接使用共享模块。

## 3. 统一 AccountData 持久化

文件：`src/renderer-vue/src/stores/persistence.ts`。对外提供加载、延迟保存、立即 flush、自动保存启停和保存状态。

- 实际写盘字段以 React `flushSaveImmediately()` 的对象为准，不能因 `AccountData` 类型声明了可选字段就全部序列化。
- 写盘白名单为：`accounts/groups/tags/activeAccountId`、`autoRefreshEnabled/autoRefreshInterval/autoRefreshConcurrency/statusCheckInterval`、`privacyMode/usagePrecision/proxyEnabled/proxyUrl`、`autoSwitchEnabled/autoSwitchThreshold/autoSwitchInterval/switchTarget`、`theme/darkMode/language`、`machineIdConfig/accountMachineIds/machineIdHistory`、`proxyPool/proxyPoolConfig/proxyPoolCursor/accountProxyBindings`。
- Map 按原规则转为对象，选中项、筛选缓存、任务回调与在途状态不进入 AccountData。
- `autoRefreshSyncInfo` 继续读入但不写回；`currentMachineId/originalMachineId/originalBackupTime` 继续不从文档读取也不写入。`batchImportConcurrency/loginPrivateMode` 等目前不在保存对象中的设置同样保持原状。
- 原样保留 500ms 防抖、5s 最大等待、同窗口 Promise 统一唤醒和立即 flush。已有保存请求在途时，等待并合并到该请求；不能顺手添加第二轮保存改变原时序。保存异常继续按当前方式记录并完成等待者。
- 保留每 30 秒按 accounts/groups/tags/activeAccountId 哈希变化触发的自动保存，不扩大哈希范围。
- 加载时保留当前默认值、激活状态校正、旧账号缺少 machineId 时补齐并延迟保存、代理 URL 规范化、自动换号与自动保存启动、异步本地 SSO 同步。
- 保留 `importAccounts` 不去重与 `importFromExportData` 已有的去重差异；共享日期和 rateLimiter 边界行为不改。
- 保持原 localStorage 键和值格式，包括任务、Webhook、账号分组/视图、注册、代理日志、诊断、验活与封禁通知去重。尚未迁移的页面键本阶段不读写或重命名。

## 4. 应用初始化、事件与释放

文件：`src/renderer-vue/src/stores/app.ts`，必要的纯事件辅助函数放于 `lib/`。这是生命周期协调器，不再增加一份业务状态副本。

- `initialize()/dispose()` 成对且可重复调用；同一实例重复初始化不会重复订阅，释放后不会因尚未返回的初始化 Promise 或微任务重新启动定时器。
- 保留加载账号后启动自动 Token 刷新、单独加载主进程主动续期开关、读取 Webhook 配置的流程。
- 按实际源码迁移 App 的 **8 项 IPC 订阅**（原总计划“9 项”为粗略数量）：

| 订阅 | 必须保留的响应 |
| --- | --- |
| `onKiroIdeTokenChanged` | 从原持久化重新加载账号，同步 IDE 的新 Token |
| `onProxyWebhookTrigger` | 原事件名和 level 映射后触发 Webhook |
| `onTrayRefreshAccount` | 原 Token 检查/刷新与托盘更新 |
| `onTraySwitchAccount` | 按原候选与顺序切换下一账号 |
| `onBackgroundRefreshResult` | 120ms 批量应用刷新结果 |
| `onBackgroundCheckResult` | 120ms 批量应用检查结果 |
| `onProxyAccountSuspended` | 原封禁状态/错误更新与防抖保存 |
| `onProxyAccountUpdate` | 原 Enterprise profileArn 同步到账号与 credentials |

- 保留 `navigate-page` 与 `beforeunload` 两项 DOM 监听；后者继续触发立即保存，不声称浏览器 unload 能等待异步 IPC。
- 保留托盘语言与账号同步、400ms 更新防抖、后台结果缓冲处理、启动 8s 封禁通知宽限期、`kiro-notified-banned-ids` 去重与解封移除逻辑。
- `dispose()` 清理 watch、IPC、DOM、批处理、托盘与后台定时器；待应用的后台结果按原规则处理，已产生的待保存数据先 flush，避免仅清空计时器丢失等待者。
- 窗口最大化和关闭确认属于组件级订阅，分别在组件 mount/unmount 配对处理，不混入上述 8 项计数。

## 5. 主题与多语言

文件：`src/renderer-vue/src/composables/useTranslation.ts`、`useTheme.ts`，共享 locale 只添加外壳所需业务文案。

- `useTranslation` 保留嵌套 key、缺失 key 回退、参数替换以及 `auto/zh/en` 行为；返回明确的 `actualLanguage`，不通过翻译后的“Unknown”推断语言。
- 语言改变时同步 UI 库 `setLocale()` 与现有托盘语言 API，避免两个 watcher 重复触发同一 IPC。
- Vue 新增本地键 **`kiro-vue-theme-mode`**，值为 `light/dark/system`。不存在时从旧 `darkMode` 映射出 light/dark，不擅自把旧用户改为跟随系统。
- 有效的 Vue 本地偏好在 Vue 内优先；返回 React 时仍读取原 darkMode 布尔值。此键仅表示本地 Vue 外观，不添加到 AccountData 或现有配置同步导出字段中。
- 库当前只对 `data-theme="dark"` 提供深色 token；因此 `system` 偏好通过 `matchMedia('(prefers-color-scheme: dark)')` 解析为实际 `light/dark` 后写根属性，不能直接设置 `data-theme="system"` 后期待库自动变色。
- 完成原文档加载后，将生效颜色同步到内存 darkMode；模式/系统颜色导致实际值变化时走同一保存流程。旧 `theme` 原样保留，不转换为新的主题模式。
- 根据 `prefers-reduced-motion` 同步 `data-reduced-motion`，清理媒体查询监听，不新增持久化字段。
- 在应用外壳提供轻量主题与语言菜单，供 Phase 2 自身验收；后续设置页复用相同 store 动作，不维护另一份状态。

## 6. Vue 外壳与窗口操作

文件：`main.js`、`App.vue`、`components/layout/TitleBar.vue`、`Sidebar.vue`、`PagePending.vue`、应用布局样式与导航类型/元数据。

- `main.js` 保持 createApp + Pinia，样式仅导入一次；注册基于 `navigator.clipboard.writeText` 的 `setClipboardWriter`，根挂一次 `UiSnackbarHost/UiConfirmHost`。
- App mount 时初始化、unmount 时释放生命周期。使用明确的 currentPage 状态与已访问页面集合，页面切换遵守原 `navigate-page` ID。
- Sidebar 保留原 15 项菜单、顺序和初始折叠状态，使用 UI Button/Tooltip/Menu；图标来自既有 `lucide-vue-next`，折叠时仍具可访问名称和键盘操作。
- TitleBar 保留平台判断、版本显示、窗口拖拽区域、最小化/最大化切换/关闭和最大化状态订阅；macOS 继续为原生窗口按钮留空间。任务入口按现有条件显示。
- 共享 logo 放在框架无关资源目录，Vue 不从 React 源码目录导入；若移动现有资源，React 仅调整路径。
- 业务布局 CSS 限于窗口、侧栏、内容区域与拖拽，不复刻 UI 组件；使用库的表面、边框、文字、间距与 motion tokens，移除 Vue 外壳的玻璃/渐变样式。
- 保持合理的滚动归属和 `min-width/min-height: 0`，正文不溢出窗口；不使用负 z-index 容器承载可交互内容。

## 7. TaskCenter 与关闭确认

文件：`components/layout/TaskCenter.vue`、`components/CloseConfirmDialog.vue`。

- TaskCenter 使用 `UiDialog placement="end"`，保留历史/活动分组、进度、状态、计数、耗时、取消、暂停/恢复、删除和清理已完成任务的原行为。
- 进度、状态与动作由 `UiProgress/UiBadge/UiButton/UiTooltip` 等已有组件呈现；不把回调序列化，不生成演示任务混入真实任务历史。
- 关闭确认用 `UiDialog/UiCheckbox/UiButton`，保留最小化到托盘、退出、取消及“记住选择”。每次主进程打开事件重置记住选择。
- Esc、遮罩、关闭按钮和取消都向原 IPC 回复 cancel；一次交互仅回复一次，不因 `update:open/closed` 重复回传。继续让主进程保存退出偏好。
- 更新弹窗订阅与界面属于 Phase 3。本阶段手工验收不把升级下载/安装作为外壳完成条件。

## 8. 离线验收与交接

除共用五组 accounts 特征测试外，新增针对迁移风险的检查：

- tasks 历史格式、200 条上限、回调排除和取消动作；webhooks 原 JSON 格式、事件映射、限速与重试（mock fetch）。
- 应用初始化两次仅一套订阅，dispose 后全部退订；异步加载晚于 dispose 返回时不重新注册或启动；后台 120ms 合批、托盘 400ms 防抖、封禁 8s 基线及去重。
- 主题旧布尔值导入、新键优先、系统颜色变化和旧 theme 回写；语言 auto/zh/en、参数替换及 UI locale 同步。
- 所有测试使用合成账号和隔离临时目录，通知、网络、IPC、媒体查询均 mock。组件视觉不以这些测试替代用户验收。

在应用目录依次执行：

```powershell
npm run typecheck
npm run typecheck:vue
npm run test:compat
npx eslint src/renderer-vue --no-cache
npm run build
npm run build:vue
```

- 将新增离线检查接入 `test:compat`，两种构建顺序执行（共用 `out/renderer`）。完成后明确最后一次构建是哪种入口。
- 检查 Vue/shared 没有 React、Zustand、Tailwind 或 React 目录依赖；按上述允许边界检查 diff，原 React 回归仍须通过。
- 若 UI 库源码在 TS 5.9/vue-tsc 下出现新类型问题，在 UI 库修复并发布，不在 KAM 用类型屏蔽绕过。
- 同步 `.Codex/memory/vue-migration.md` 与 AGENTS.md 的新结构、测试命令和实际完成情况；仓库内目前没有相邻 CLAUDE.md，不修改全局 Claude 配置。
- 给用户提供 `npm run dev:vue` 的简洁验收清单：窗口操作与关闭确认、15 项导航与折叠、任务抽屉、明暗/系统主题、中文/英文、两版数据往返。未访问的业务页明确仍为占位，不宣称 Phase 3 已完成。
- 记录静态/离线检查证据与用户尚未验收的项目，完成 Phase 2 后再制定 Phase 3 分批细化方案。

## 开工条件

上述产品决策与本方案均已由用户确认，Phase 2 实现完成。验证记录与运行步骤见 `docs/vue-phase2-validation.md`，后续不使用 superpowers 插件技能组。
