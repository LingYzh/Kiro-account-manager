# Vue 迁移 Phase 2 验证与运行交接

更新日期：2026-10-01。范围为 Vue 外壳和完整 Pinia 数据层；业务页与更新弹窗留到 Phase 3。默认 React 入口与发布渠道保持现状。

## 最新运行结果：白屏与整页反色已定位修复

2026-09-30 用户反馈白屏。2026-10-01 使用真实 Electron 和 Vue 开发入口复现，`#app` 为空，首条 Renderer 错误为 `highlight.js/lib/core.js` 没有 `default` 导出。Vue 构建配置现在由 Vue 插件处理 UI 库的 TS/Vue 源码，并显式预构建嵌套的 highlight.js 与 markdown-it CommonJS 依赖。用户随后执行 `npm run dev:vue`，确认标题栏、侧栏和页面正常显示。

侧栏按用户选择换为纵向 UiTabs/UiTabPanel，保留折叠/展开、15 项顺序和首次访问后页面实例；导航不再使用会粘住的 UiTooltip。关闭确认的“记住我的选择”改用 UiCheckbox 默认 slot，恢复可见文案。

用户进一步反馈主界面浅色蓝色、弹窗和菜单却是深色陶土橙。根因是 Sidebar 的 scoped 样式 `:global(:root[data-theme='dark']) .kam-logo` 编译后丢失后半段，实际成为根元素 `filter: invert(1)`。因此 computed tokens 与背景均正确，整页像素仍被反色，而 top layer 的弹窗/菜单没有反色。修复使用普通根元素祖先选择器，让 Vue 仅给 `.kam-logo` 添加 scoped 属性；减少动效的同类选择器同步修正。主代理通过 computer-use 检查用户实际运行窗口，已确认深色中性背景与陶土橙导航正常。

Vue 入口 CSP 单独允许 `font-src 'self' data:`，支持 UI 库生产构建内联的字体；其余脚本、样式和图片规则保持原约束。新的真实 Electron 回归使用临时 userData、合成空账号与离线 preload，不加载生产主进程或读取真实账号。

用户截图的底部三个按钮涟漪出现在左上角，根因在 UI 库 `vRipple`：mounted 加的 `ui-ripple-target` 在侧栏展开时被 Vue 动态 class patch 删除，按钮变为 static，涟漪 layer 的 offsetParent 变成页面。库在 updated 后恢复该定位类，先完成真实 demo、66 项专项断言、完整组件 20/20、A 批 7/7、B 批 6/6、23 单测与浅深 held 截图的 root 视觉验收。用户授权后发布提交 `cd9d3ce` 与标签 `v0.2.2` 已推送，Actions [36757427137](https://github.com/LingYzh/UI/actions/runs/36757427137) 成功；官方 npm latest 为 0.2.2，KAM package/lock/实际安装已一致升级。`D:/UI` main 已快进到上游，旧四个本地提交只留备份分支。

`npm run test:vue-shell -- --ui-source D:\UI-ripple-fix` 仍可显式验证候选库，只给测试 renderer 配置添加精确源码/样式别名，报告注明候选来源；无参数使用项目正式 npm 依赖并覆盖开发冷启动。此模式不改变生产配置、package/lock 或安装目录。正式升级正常读取 lockfile，仅替换 UI 包，使用官方 tarball `https://registry.npmjs.org/@lingyzh/ui/-/ui-0.2.2.tgz`，integrity 为 `sha512-m0j1u26pgS0e+PSnl8aTvzTp6GQ9FuJmgoVgSMaQcGnsLuV7yCNfzTd5iMlpQXZgcyEDgi5OliExeoMXotgP7A==`。运行中的旧 Vite 需重新启动才能加载新库。

用户随后提供的透明 PNG 原样保存为 `src/renderer-shared/assets/kam-logo.png`，Vue/React 的应用品牌入口共用新 Logo；深色滤镜全部移除，macOS 托盘不再设置 Template 图标。应用、托盘与安装器的 PNG/ICO/ICNS 已同步；ICO、ICNS 使用现有 electron-builder 图标转换器生成并检查可解码，未重绘原图。

### 正式 0.2.2 与新 Logo 最终验收

- `npm run test:vue-shell`：dev 65、prod 64 项检查通过，Renderer 错误均为零。证据 `C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-tgLyHi/`，共八张截图和两份报告；使用正式 npm 0.2.2、无候选别名、开发依赖无预热。
- 覆盖 15 项 Tabs 顺序、键盘与页签关联、懒创建、窗口/关闭确认的离线 IPC、主题/语言持久化、三个底部按钮展开前后 ripple 的定位类与 offsetParent，以及最终组件颜色。
- Logo 在浅深 × 折叠展开四种状态均 complete=true、naturalWidth/Height=1254×1254、filter=none；主代理检查 dev 深色展开与 prod 浅色折叠截图，原色、透明边缘和侧栏布局正常。
- 深色卡片与八层祖先 filter=none、opacity=1；PNG 像素与背景、表面、边框 tokens 一致，不仅依赖 computed style。
- `npm run typecheck:vue`、`npm run build`（含主进程/React 类型检查）、`npm run build:vue` 通过。最后一次完整构建为 Vue；离线协议、共用 accounts 与生命周期检查在本次接续已通过，未改动相关业务实现。
- Vue 修改文件、构建配置与三个外壳测试文件 ESLint 无错误；涉及 Logo 的 React/托盘文件有八个既有 lint 错误，逐文件对比 HEAD 的错误集合完全一致，未引入新错误。未为 Logo 改动批量格式化旧代码。
- UI 已提交/推送/发布；KAM 本次修改仍在迁移分支工作区，未发布 KAM 版本。桌面打包产物及真实 OS 托盘效果尚未运行验收。

接续分支为 `feat/vue-migration`。跨设备恢复与剩余 Phase 3/4 见仓库根目录 [HANDOFF.md](../HANDOFF.md)。下面仍保留用户系统集成验收清单。

## 已完成的验证

所有命令在仓库内的 `Kiro-account-manager/` 应用目录执行；当前设备完整路径是 `D:\Kiro-account-manager\Kiro-account-manager`。下表原有结果保留 2026-09-30 检查点，2026-10-01 接续结果另行记录。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck:vue` | 通过；包含新增 store、composable 与 UI 库组件引用 |
| `npx eslint src/renderer-vue --no-cache` | 通过，无错误或警告 |
| `npm run test:compat` | 通过，包含原代理/协议检查与 43 项模拟 HTTP 检查 |
| React / Pinia 共用 accounts 场景 | 两版同一套五类断言全部通过 |
| `node test/renderer-vue-runtime.mjs` | 8 组离线场景通过 |
| `npm run build` | 通过，包含主进程与 React 类型检查 |
| `npm run build:vue` | 通过，最后一次构建，当前 `out/renderer` 为 Vue |
| 动作清单与引用边界 | 原 accounts 97、tasks 9、webhooks 8 个动作均已导出；Vue/shared 无 React/Zustand/Tailwind 或 React 目录依赖 |

主进程既有的 logger/tlsClientPool 混合动态、静态导入提示仍存在，与本次迁移无关。历史静态/离线检查没有挂载真实 App.vue，因此没有捕获白屏与根元素反色；接续测试增加真实 Electron 页面与像素检查。未读取真实账号、发送真实 Webhook 或消耗上游额度。

## 数据与生命周期覆盖

- 共用场景覆盖实际 AccountData 字段、旧 theme 往返、500ms 防抖、5s 强制落盘、在途合并、筛选排序统计、导入导出和代理池策略。
- 新场景覆盖任务 200 条历史上限与回调排除、Webhook 本地格式/20 次每分钟限速/重试、事件合批、防抖、封禁通知宽限与去重、晚返回释放、主题与语言、窗口与关闭确认、跨 Pinia 实例隔离。
- IPC 保存使用 structuredClone 校验；响应式对象通过 `toIpcData` 转成普通对象，不改变字段或丢弃 undefined。
- 已确认的既有行为全部保留：autoRefreshSyncInfo 不写回，机器码三项不读不写，普通导入不去重，以及日期/限流的已记录边界。

## 用户运行验收

启动 Vue：

```powershell
Set-Location -LiteralPath 'D:\Kiro-account-manager\Kiro-account-manager'
npm run dev:vue
```

1. 窗口：拖动标题栏，检查最小化、最大化/还原；关闭时检查取消、最小化到托盘和退出，按需验证“记住选择”。macOS 保留系统按钮位置。
2. 侧栏：初始折叠，展开后核对 15 项 Tabs 及顺序；折叠图标有悬停 title 和无障碍名称，展开无 Tooltip。验证上下箭头、Home/End 切换和页签/面板关联，切换页面显示对应标题和明确的 Phase 3 占位。
3. 外观：侧栏底部切换浅色、深色、跟随系统；在系统模式下改变系统外观，应同步变色。退出重开应记住模式。
4. 语言：切换中文、English、跟随系统；导航、关闭确认、任务界面和 UI 库内置文字同步，托盘语言也应改变。
5. 任务：有历史任务时打开标题栏入口，检查排序、状态、进度与清理。没有历史任务时隐藏入口属于既有行为，本阶段不生成演示任务；运行中任务的暂停/恢复/取消已离线检查，业务页迁移后再做实际操作验收。
6. 数据往返：退出 Vue 后用 `npm run dev` 启动 React，核对账号/分组/标签/代理绑定等原数据及当前明暗、语言。旧配色 theme 保留原值，Vue 只使用 UI 库明暗外观。

接续时记录第一条渲染报错及完整堆栈、启动命令、页面 URL、预期/实际结果。不能只核对 tokens 或 computed style；影响祖先的 filter 会使它们与实际像素不同。KAM 本次接续修改尚未提交或推送，UI 0.2.2 已发布。

## 后续

Phase 3 第一批细化方案见 [小页面迁移方案](vue-phase3-small-pages-plan.md)。完成外壳回归与系统集成验收后按批次替换占位，Phase 4 等全部业务功能对齐后切换。完整剩余阶段见 [HANDOFF.md](../HANDOFF.md)。后续不使用 superpowers 插件技能组。
