# 项目说明

## 构建与验证

应用位于 `Kiro-account-manager/`，以下命令在该目录执行：

- `npm run typecheck`：主进程与渲染进程 TypeScript 检查。
- `npm run build`：检查并构建 Electron 应用。
- `npm run test:compat`：离线兼容性单测与 HTTP 集成测试，使用合成元数据和模拟上游，不读取账号或消费额度。
- `npm run test:e2e`：现有在线测试，需要已启动代理与可用账号，可能消费额度。
- Release：同步 package.json/package-lock.json 版本及两份 README 顶部更新日志后，推送匹配的 `v<version>` 标签；`.github/workflows/build.yml` 构建多平台产物并发布，Windows runner 固定为 windows-2022。
- Windows 自动更新使用一次构建 x64/ia32/arm64 的通用 NSIS 包；禁止扁平化覆盖各架构的同名 latest.yml，否则客户端会收到错误架构安装包。

## 架构

- `src/main/proxy/`：HTTP 代理、协议转换、Kiro 请求与多账号池。
- `src/main/ipc/`：Electron 主进程 IPC。
- `src/renderer/`：React 界面；`src/preload/`：主进程与界面的桥接。
- `test/e2e-fullsuite/`：代理 HTTP 回归测试。
- 已预装 `@lingyzh/ui@0.1.0` 与 `vue@3.5.43`，渲染层正按计划从 React 迁到 Vue 3 + Pinia + `@lingyzh/ui`（并行目录 `src/renderer-vue/`，electron-vite `--mode vue` 切换）；当前代码未引用。该包以 `.ts/.vue` 源码发布，UI 库缺失的通用组件必须先在 UI 仓库补齐发布再引用。持久化兼容与子代理配置详见 `.Codex/memory/vue-migration.md`。

## 非常规约定

- 模型目录按账号、区域和 profile 隔离；请求能力不能依赖用户预先访问模型列表。
- 上游明确不支持或能力未知时省略可选 reasoning 字段，禁止凭模型家族注入 adaptive thinking。
- 未知模型保留候选 ID 交给上游校验，不能静默切换模型。
- 映射的默认推理等级只补客户端缺省值；客户端显式 thinking/effort 优先，最终仍以目标模型 schema 为准。仅签名事件不能创建空 thinking 块。
- 新增与修改代码使用四空格缩进，避免对未改动代码批量格式化。
- 项目记录位于 `.Codex/memory/`。不要把凭证、真实请求正文或抓包写入记录。
- 排查工具后中断时区分适配器完成、HTTP finish 和客户端 tool_result 回传；转换后历史不能代替原始入站证据。使用请求级里程碑日志关联，避免通过重复执行工具试探问题。
- EventStream 必须校验两级 CRC 与帧/header 边界；损坏流和工具参数不能伪装为成功。Runtime 与 Generate 的结束契约需分开验证，详见 `.Codex/memory/kiro-protocol-audit.md`。
- 默认不删除旧历史或截断工具结果；显式启用代理裁剪才允许有损处理，并保护顶层 system 与当前工具调用配对。Claude messages 内含 system 时整段历史禁止有损裁剪。
- Claude 流在首段内容或有效空完成前保留真实 HTTP 错误状态；明确的上游上下文超限与 UTF-8 字节超限分别返回 400/413，不能伪造 token 数值或继续重放。详见 `.Codex/memory/context-preservation.md`。
- Claude Code 请求按请求保留历史；会话身份隔离完整 API key、session、agent 与辅助请求类别。不能在模型上下文前注入每轮变化的时间戳，也不能把内部 cache checkpoint 后移到动态后缀。
- Claude 缓存 usage 仅来自上游遥测，不能用本地模拟命中回填；未知与真实零需区分，JSON/SSE 的 input_tokens 均扣除真实缓存部分。已知不可执行的语义字段在上游请求前明确报错，详见 `.Codex/memory/gateway-cache-fidelity.md`。

- Claude Desktop 一键配置位于 `src/main/clientConfig/`；Claude 客户端 ID 统一复用 `src/shared/modelIdentity.ts`，保留真实版本，非 Claude 目标使用显式档位别名。配置测试必须使用临时目录，详见 `.Codex/memory/claude-desktop-config.md`。
