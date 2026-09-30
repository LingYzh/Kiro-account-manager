# Vue 迁移 Phase 2 验证与运行交接

日期：2026-09-30。范围为 Vue 外壳和完整 Pinia 数据层；业务页与更新弹窗留到 Phase 3。默认 React 入口与发布渠道保持现状。

## 最新运行结果：白屏待排查

2026-09-30 用户反馈实际窗口为白色，后台仍打印日志。Phase 2 的真实运行验收失败，根因未定位；当前没有 Renderer DevTools 报错堆栈或页面挂载证据。下面的静态/离线通过结果不能视为外壳可运行。

用户要求保存检查点后换设备继续，接续分支为 `feat/vue-migration`。白屏排查入口、跨设备恢复与剩余 Phase 3/4 见仓库根目录 [HANDOFF.md](../HANDOFF.md)。先处理白屏，再执行下面的运行清单。

## 已完成的验证

所有命令在仓库内的 `Kiro-account-manager/` 应用目录执行；旧设备完整路径是 `E:\WebstormProjects\Kiro-account-manager\Kiro-account-manager`。

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

主进程既有的 logger/tlsClientPool 混合动态、静态导入提示仍存在，与本次迁移无关。以上结果不代表真实 Electron 窗口、交互或视觉已验收；代理验证时没有启动真实应用、读取真实账号、发送真实 Webhook 或消耗上游额度。随后用户启动并反馈白屏，运行验收未通过。

## 数据与生命周期覆盖

- 共用场景覆盖实际 AccountData 字段、旧 theme 往返、500ms 防抖、5s 强制落盘、在途合并、筛选排序统计、导入导出和代理池策略。
- 新场景覆盖任务 200 条历史上限与回调排除、Webhook 本地格式/20 次每分钟限速/重试、事件合批、防抖、封禁通知宽限与去重、晚返回释放、主题与语言、窗口与关闭确认、跨 Pinia 实例隔离。
- IPC 保存使用 structuredClone 校验；响应式对象通过 `toIpcData` 转成普通对象，不改变字段或丢弃 undefined。
- 已确认的既有行为全部保留：autoRefreshSyncInfo 不写回，机器码三项不读不写，普通导入不去重，以及日期/限流的已记录边界。

## 用户运行验收

启动 Vue：

```powershell
Set-Location -LiteralPath 'E:\WebstormProjects\Kiro-account-manager\Kiro-account-manager'
npm run dev:vue
```

1. 窗口：拖动标题栏，检查最小化、最大化/还原；关闭时检查取消、最小化到托盘和退出，按需验证“记住选择”。macOS 保留系统按钮位置。
2. 侧栏：初始折叠，展开后核对 15 项菜单及顺序；折叠时悬停/键盘聚焦能识别菜单。切换页面显示对应标题和明确的 Phase 3 占位。
3. 外观：侧栏底部切换浅色、深色、跟随系统；在系统模式下改变系统外观，应同步变色。退出重开应记住模式。
4. 语言：切换中文、English、跟随系统；导航、关闭确认、任务界面和 UI 库内置文字同步，托盘语言也应改变。
5. 任务：有历史任务时打开标题栏入口，检查排序、状态、进度与清理。没有历史任务时隐藏入口属于既有行为，本阶段不生成演示任务；运行中任务的暂停/恢复/取消已离线检查，业务页迁移后再做实际操作验收。
6. 数据往返：退出 Vue 后用 `npm run dev` 启动 React，核对账号/分组/标签/代理绑定等原数据及当前明暗、语言。旧配色 theme 保留原值，Vue 只使用 UI 库明暗外观。

接续时记录第一条渲染报错及完整堆栈、启动命令、页面 URL、预期/实际结果。用户已要求把当前 Phase 2 实现与交接提交并推送到 `feat/vue-migration`，白屏保留为下一设备的首要待办。

## 后续

先修复白屏并完成外壳运行验收，再按原路线制定 Phase 3 的叶子页面分批方案，最后进行 Phase 4 切换与清理。完整剩余阶段见 [HANDOFF.md](../HANDOFF.md)。后续不使用 superpowers 插件技能组。
