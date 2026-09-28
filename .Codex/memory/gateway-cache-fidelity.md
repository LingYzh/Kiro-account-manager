# Gateway 缓存与 harness 保留（2026-09-28）

## 范围与决定

接续 v1.7.7 的上下文修复，参照用户引用对话末两轮，并直接核对 [Claude Code gateway compatibility guide](https://code.claude.com/docs/en/llm-gateway-protocol)。引用对话的旧代码判断不能替代本地现状：inline system、execution_discipline、超限错误已在 v1.7.7 修复。

用户选定：不能等价执行的语义字段明确报错。未知字段保留在入口深拷贝，不使用固定字段白名单；不把 Anthropic schema 盲发到 Kiro。均衡子代理配置，Terra 档由 GPT-6 Sol 替代。

## 实现约束

- 删除两个转换器及遗留 injectSystemPrompts 的动态时间戳；不改变显式 steering。
- Claude system 数组每个非空文本 block 各自使用已有 Human/AI pair，checkpoint 不并入后续动态 system。普通 content 内部 checkpoint 无等价表示时不后移；合并连续 user/system 同理，仅最终段末尾有效。assistant 末尾/消息级 cache 标记也映射。
- 本轮仍非原生 system 优先级；Kiro content:string 不能实现完整 Anthropic block 拓扑/TTL/thinking replay。通过 x-kiro-compatibility 与无正文里程碑诊断声明降级。
- 捕获开放的 anthropic-*、x-claude-code-* headers，原请求深拷贝后再做模型映射、图片转换和 steering。识别 Claude Code 后按请求 preserveHistory，不切换全局开关。
- 会话键使用完整 tenant/session/agent/lane 的结构化 hash，正文 conversation_id 也参与隔离。prompt-id 不轮换主会话；compaction/auxiliary 与 main 分离；context-compacted 不强行清空账号 affinity。移除 Claude 模拟缓存后无需维护虚假 cache epoch。
- 未保存配置时 affinity 默认启用，显式 false 保持关闭。affinity 检查 TTL、账号可用性和配额/冷却；非流式成功后记住实际使用账号。Claude failover 保持 API key 与账号分组边界。
- Claude usage/stats 不再读本地 promptCacheTracker；JSON 与 SSE 同一换算函数，input_tokens 从含缓存总量扣真实缓存计数。缺失 cache 不等于零，真实零不能被估计回填。
- tokenUsage、metadata、usageEvent 按字段合并真实非负有限数字；total-output 可以替换初始估计；真实零覆盖估计。meteringEvent.usage 仅数字 credits，不推断它是 token usage 对象。
- 能力错误在选账号/上游前返回 HTTP 400；已有上下文超限 400、字节超限 413、首内容前真实HTTP错误及已输出后不重放约束继续有效。

## 验证与限制

离线回归覆盖稳定前缀、cache checkpoint、会话/子代理/租户隔离、CC 裁剪保护、用量及能力错误。`npm run test:compat` 七组单测和 41 组 HTTP 回归通过，`npm run build`（含两端 TypeScript）与 `git diff --check` 通过。构建仅保留既有动态/静态 import 混用提示。未使用真实凭据或在线推理，不声称已测得缓存命中提升百分比。没有发布新版本或替换用户已安装应用。

本机 node_modules 为 pnpm 布局，既有测试依赖直接 import esbuild，但未建立顶层入口；仅在本机补充到已安装 esbuild@0.25.12 的 junction（与 package-lock.json 相符），没有改动依赖或用户 pnpm-lock.yaml。新增 usage 测试隔离日志/桌面依赖，避免日志保存定时器拖延退出；不使用 process.exit 掩盖资源泄漏。

使用说明见 [Claude Code gateway](../../docs/claude-code-gateway.md)（相对仓库根的文档位于 docs/claude-code-gateway.md）。

## 本地试用构建

- 用户要求确认严格拒绝的可用性代价并构建试用客户端；保留严格策略。若客户端始终携带被拒绝字段且无法关闭或自动降级，相关请求会持续 HTTP 400；未知扩展和仅性能方面的缓存降级不等于全部拒绝。
- Windows x64 目录版：`Kiro-account-manager/dist/gateway-cache-trial/win-unpacked/kiro-account-manager.exe`。先完全退出旧 KAM，再由用户启动试用版；保留完整目录。
- `npm run build` 和 `electron-builder --win --x64 --dir --publish never` 成功。核对 app.asar 内主入口与本次 out/main/index.js 字节一致，缓存/能力检查标记存在、旧时间戳标记不存在；前端/preload/主要运行依赖存在，EXE PE 架构为 x64。
- 版本仍为 1.7.7 工作区试用构建，没有发布、覆盖已安装应用或自动启动推理。EXE SHA-256：`337ee6a3a85f55b6d8c54f5803ecb6912701873cfc70900c3eb96fa29d3826e6`。

## 试用包启动排查

- 22:17:39 的 `app-update.yml` ENOENT 来自目录构建没有自动更新配置，但主进程仍在运行。日志随后记录反代监听 5579，而非默认 5580；本机 socket 与运行的试用 EXE 对应，`http://127.0.0.1:5579/health` 实测 HTTP 200。该检查没有发起模型推理。
- 端口使用已保存配置，不应为了匹配默认值强行覆盖用户设置；调用端使用实际服务地址，或停止服务后修改端口再启动。
- 更新器改为仅生产环境且存在 `resources/app-update.yml` 时启用；缺配置的检查/下载 IPC 返回明确错误，安装 IPC 使用已有 update-error 事件并保持 void 返回。关于页独立 GitHub 版本查询仍可用。
- 修正版目录为 `Kiro-account-manager/dist/gateway-cache-trial-v2/win-unpacked/`。完整构建（含两端 TypeScript）、目录打包和更新器 dev/缺配置/有配置分支验证通过；包内 main 与构建输出逐字节一致。未覆盖正在运行的旧目录包；新版完整 GUI 启动需切换客户端后确认。
