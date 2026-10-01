# Vue 迁移 Phase 3 第一批细化

日期：2026-10-01。分支：`feat/vue-migration`。源码路径相对应用目录 `Kiro-account-manager/`。

## 进入条件与范围

先完成 Phase 2 白屏修复、真实 Electron 渲染回归、主代理视觉检查，以及用户原启动路径的运行验收。本文件是下一批的具体实施范围，不代表业务页已迁移或 Phase 2 用户验收已完成。

按 HANDOFF 第一批迁移八个页面：About、Webhooks、Logs、Diagnose、ConfigSync、MachineId、KiroSettings、KProxy，以及它们直接使用的业务编辑器/面板。保留 React 默认入口、发布渠道、协议层和既有存储契约；不切换默认入口，不发布版本。

## 当前源码核对

行数用于判断阅读范围，不作为拆分组件的理由。以下为 2026-10-01 当前源码行数，不含末尾空行。

| 页面 | 现有 React 源码 | 业务范围与重点 |
| --- | --- | --- |
| About | `src/renderer/src/components/pages/AboutPage.tsx` | 版本、手动检查更新、更新信息弹窗、外链；按用户本次要求移除加入群聊按钮及二维码弹窗，不增加自动检查更新 |
| Webhooks | `src/renderer/src/components/pages/WebhooksPage.tsx`，315 行 | 六类通知渠道、七种事件、增改删、启停、测试结果；复用现有 Pinia webhook store |
| Logs | `src/renderer/src/components/pages/LogsPage.tsx`，412 行 | 1500ms 拉取、等级/类别/时间/文本过滤、虚拟列表、自动跟随与新日志提示、导出/清理 |
| Diagnose | `src/renderer/src/components/pages/DiagnosePage.tsx`，945 行 | 连通性诊断、模型缓存、单个与并发测活、停止/重测、失败账号操作；需要消费额度的路径只用 mock 验证 |
| ConfigSync | `src/renderer/src/components/pages/ConfigSyncPage.tsx`，616 行 | PortableConfig v1、选项导出、代理凭据处理、AES-GCM、导入与替换确认；保留原文档字段和注册配置键 |
| MachineId | `src/renderer/src/components/pages/MachineIdPage.tsx`，1062 行 | OS/权限、当前与原机器码、账号绑定、备份恢复与切号配置；复用 machineId/accounts/autoSwitch stores |
| KiroSettings | `src/renderer/src/components/pages/KiroSettingsPage.tsx`，887 行 | 设置加载/保存、模型列表、MCP、Steering 文件；另含 `kiro/McpServerEditor.tsx` 226 行与 `kiro/SteeringEditor.tsx` 149 行 |
| KProxy | `src/renderer/src/components/pages/KProxyPage.tsx`，32 行 | 实际业务在 `src/renderer/src/components/kproxy/KProxyPanel.tsx`，587 行；不能只迁移页面包装 |

## 视觉与组件约定

继续采用已发布并验收的 `@lingyzh/ui@0.2.2`，主代理负责模板结构和最终截图验收。页面只使用 UI 库 tokens/utilities、lucide-vue-next 和业务布局，不恢复 React glass、彩色 hero 或旧主题色板。应用 Logo 使用共享 `assets/kam-logo.png`，浅深模式均不反色。

- 页面结构：标题与说明、业务操作区、UiCard 内容区；列表/表单按实际信息分组。浅深模式使用现有 tokens。
- 基础控件：UiButton、UiInput、UiTextarea、UiSelect、UiSwitch、UiCheckbox、UiRadio、UiField、UiBadge、UiAlert、UiSpinner、UiProgress、UiCollapse、UiDialog、UiCopyButton。
- 表格/详情：按当前业务选用 UiTable、UiScrollArea、UiCodeBlock；Logs 使用已安装的 `@tanstack/vue-virtual` 保留虚拟化。业务编辑器可以留在 KAM，不在 KAM 创建通用控件。
- 删除、覆盖与退出确认复用 UI confirm/dialog；保留原来需要确认的操作，不增加系统写入或网络动作。
- 开工前核对实际组件 props、slot、事件及 demo；若发现通用能力缺口，先回到 UI 库完成 demo/验收/发布，再升级 KAM。不能通过页面私有通用组件绕过这一步。

## 实施顺序

1. About、Webhooks、Logs：覆盖信息页、编辑弹窗与持续拉取页面三种真实使用方式；完成后验收这三页再继续。
2. Diagnose、ConfigSync、MachineId：处理停止信号、导入导出与持久化/系统边界。
3. KiroSettings 及其两种编辑器、KProxy 及完整面板：单独核对设置文件/证书/服务控制和事件生命周期。

每个页面放入 `src/renderer-vue/src/components/pages/`，业务 `<script setup>` 使用 JS，稳定的现有 store/lib/composable 保持 TS。在 App 中逐项替换 PagePending，维持首次访问才创建、之后 `v-show` 保留的行为。页面间公共风格与交互变更先在 UI 库及 demo 验收。

## 必须保持的行为

- 页面使用当前 Pinia 实例，跨 IPC 的响应式参数先 `toIpcData()`；不向 preload 发送 Proxy，不静默改 IPC 参数或返回格式。
- 切换页面保留表单、筛选和结果；应用释放时清理订阅和定时器。晚返回不得恢复已释放任务。
- Logs 保留 `systemLogs_displayLimit` 和原导出格式；轮询/自动滚动/新增条数按用户滚动位置工作。
- Diagnose 保留 `kiro-liveness-model`、`kiro-liveness-models-cache`、`kiro-diagnose-probe-url` 与旧 MoEmail 键的既有迁移；停止后不再从待测队列取新账号。已发出的 IPC 取消能力以现有契约为准，不声称能中断它。
- ConfigSync 保留 PortableConfig v1、注册 localStorage 键和加密文件格式。旧 `theme` 原样保留；Vue 主题仍统一由 app/useTheme 管理，不建立第二份主题状态。
- MachineId 保留纯内存的三项当前/原始机器码状态，不因迁移增加持久化。管理员重启、修改机器码与文件恢复在 mock 中验证，不在开发验收时操作用户系统。
- KiroSettings 保存保持未知设置字段、MCP 原名称/类型与 Steering 原文；删除仍有确认，取消编辑不写文件。
- KProxy 保留请求日志最多 50 条、跨页面访问不丢记录，以及状态/错误订阅。代理启动/停止、证书安装/卸载与设备码设置按原 IPC 契约执行，不用 PID 或进程名代替服务状态。
- webhook 发送次数/重试、本地存储与 URL/模板构造继续使用现有 store，不发送真实通知做验证。

## 每个子批次验收

1. Vue 类型检查、修改范围的 ESLint 与现有离线兼容测试；需要新验证时覆盖实际业务行为，避免只检查模板字符串。
2. 真实 App 的 dev 冷启动与 build/file 入口可挂载，无渲染异常、失败资源或未解析导出。
3. 合成数据验证空态、加载、失败、取消、重复点击锁、正确 IPC 参数、首次访问及再次切换、释放后的晚返回。
4. 主代理检查浅色中文、深色英文截图，以及实际编辑/确认弹窗；记录 UI 库组件使用和结果。
5. 涉及真实账号、网络、系统权限、文件和证书的运行效果由用户验收；不运行消费额度的 test:e2e。

## 本次调度

用户选择均衡模式，以 `gpt-6-sol` 替代 Terra。root 负责决策、视觉规格、共享契约与最终验收；明确规格的关键执行任务使用 6sol。Luna 只承担非关键路径的机械检索/盘点，不承担决策或美学样式任务，不递归创建子代理。
