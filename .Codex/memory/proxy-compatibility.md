# GPT 与旧 Claude 协议兼容性

## 本次范围

2026-09-15：修复 GPT-5.6 Sol/Terra/Luna 和 Claude 4.0/4.5 的请求兼容性，以及相关 Responses 工具和流式输出。附件中的企业账号路由、全局 SSE 重构和 UI 重构不属于本轮实现。

## 问题与修复

- 旧 `buildThinkingFields` 将“无元数据”和“已列出但无支持字段”混为一谈；显式 thinking 会回退注入 adaptive，触发上游 `REQUEST_BODY_INVALID`。
- `modelCapabilities.ts` 区分 supported/unsupported/unknown。仅按 schema 声明构造 thinking、output_config、reasoning；后两种状态省略整个 `additionalModelRequestFields`。复杂组合 schema 暂安全省略。
- 模型目录缓存在 `kiroApi.ts`，按账号、区域和 profile 隔离，冷请求按需加载，与模型列表共用。正常目录缓存五分钟，空目录短缓存十五秒。目录获取有独立超时，单个客户端取消不取消共用获取。
- 既有 `tokenCounter.ts` 的上下文窗口缓存仍按 modelId 保存；本轮隔离的是目录和请求能力。如果将来同一模型在不同账号返回不同上下文限制，需进一步隔离裁剪/用量估算缓存。
- 模型 ID 优先精确匹配，再按标点归一化匹配名称。保留既有显式兼容别名；未知 ID 不再默默改成 Sonnet 4/4.5。日期与 Claude 版本短横线别名统一处理。
- Responses function tools 单独规范化，支持扁平和既有嵌套格式，非法工具明确报错。支持 developer、函数调用/结果、多工具同轮历史和数组内容。混合文本与工具输出保留两者。
- `previous_response_id` 非空和 encrypted reasoning input 不支持，明确返回错误；客户端需发送完整历史。
- `ResponsesStream` 接收真正的上游文本增量，维护稳定 item/call ID、递增事件序号和 completed/failed 快照。Kiro 解析器目前在工具参数聚合完成后交付工具，因此参数以完整 JSON delta 输出。
- Responses 首段正文前可走既有重试流程；输出正文后失败只终止，不换号重放。Chat Completions/Anthropic 的整体 failover 流程维持既有实现，仅修正流式空白片段丢失。
- 400/422 模型或请求错误不重复尝试相同负载。

## 验证入口

在 `Kiro-account-manager/` 执行：

- `npm run test:compat`：能力单测、Responses 单测、离线 HTTP 集成。后者使用真实代理与 AWS Event Stream 解析器，合成模型目录和上游流，隔离 Electron/系统代理/日志持久化。
- `npm run build`：主进程、渲染进程类型检查与 Electron Vite 构建。
- `npm run test:e2e`：既有在线全套，需要代理服务及可用账号。CASE-20 现要求未知模型失败；CASE-24 不再把 400/404 当通过。

离线测试不证明真实账号的模型授权或上游最新行为；线上全套需要另行运行。未修改用户原有 package-lock.json 和 .idea 内容。

本次验证结果：两组能力/Responses 单测及十五组 HTTP 集成检查通过（包含二十模型解析矩阵）；`npm run build` 通过主进程、渲染进程类型检查和构建。未执行需要真实账号的在线全套。

## Claude 客户端收尾与映射默认等级（后续优化）

- 模型映射支持 `defaultReasoningEffort`；缺省沿用上游。Chat、Responses、Claude 三条入口均在同一次规则匹配中应用默认值，客户端显式 effort 或 thinking（包括 disabled）优先。目标模型 schema 仍决定最终字段，不支持或未知时不强行发送。
- 仅签名的 reasoning 事件不能凭空创建 Anthropic thinking 块；否则可能与仍打开的 text 块共用索引，产生空思考显示及错配的关闭事件。签名只附在已打开的真实 thinking 块；redacted thinking 正常保留。
- 请求日志分开显示 thinking、reasoning.effort 和 output_config.effort；Claude 完成日志包含结束原因、正文长度及块类型或数量，不记录正文。
- 用户实测确认 Claude Haiku 4.5 和 GPT-5.6 Luna 可用。截图末尾省略号的确切原因尚未确认：提供的请求日志 `stream: undefined` 走非流式，不能归因为已修复的流式空块问题。
- [Kiro reasoning effort](https://kiro.dev/docs/models/effort/) 明确 GPT-5.6 使用 `reasoning.effort`，默认 high；`hasThinking: false` 不能证明没有推理。
- 后续优化验证：两组单测及十八组 HTTP 集成检查全部通过，覆盖仅签名事件、正常 thinking 签名、redacted 内容、非流式结束和三协议的映射默认值优先级；完整构建与类型检查通过。本轮未进行 Claude Desktop 的真实请求复测。

## Added task 后等待的排查

- 用户再次实测确认最末尾省略号消失；首次 Added task 后等待，由用户手动停止/发送继续，并非已证实的客户端自动错误。
- 本轮附件日志中首次主流返回 `tool_use`、3 个块、49 字符正文，未出现错误；后续主请求转换后的上游历史没有工具调用/结果，不能据此断言客户端原始请求未携带结果。后续多轮工具调用正常。现有并发日志没有请求关联与耗时，不能据此确定客户端等待或代理传输故障，更不能认定重试能修复。
- 增加每请求随机 requestId、时间戳与耗时；记录 Claude 入站末条消息块/工具结果 ID、出站工具 ID/名称、块顺序、适配器完成、HTTP finish 与未 finish 的关闭。新增诊断不记录正文、参数和工具结果内容，也不改变重试或工具执行行为。
- HTTP finish 表示 Node 已将响应交给底层传输，不等于客户端已消费或执行工具；后续需结合相同工具 ID 的 tool_result 入站记录与客户端日志确认。
- 验证：完整构建通过；能力/Responses 单测与二十组 HTTP 集成通过，新增并发诊断 ID 隔离、工具结果摘要不泄露正文、正常 finish 与客户端主动取消的区别。卡住根因仍待真实客户端复现日志。

## 协议参考

后续源码审计与本轮修复详见 [Kiro 协议审计](kiro-protocol-audit.md)：CRC/截断帧/流错误处理、坏工具参数拒绝、工具失败状态与顺序，以及 Runtime/Responses/ACP 的能力边界。用户随后确认 Added task 等待未再复现，不能把这些修复追认为先前故障根因。

- [kiro2cc-proxy 的附加字段构造](https://github.com/TsinHzl/kiro2cc-proxy/blob/master/src/anthropic/converter.rs)：其 GPT/Claude 4.5 省略字段的行为用于交叉核对；本项目采用动态 schema，未照搬按家族判断。
- [kiro-gateway 的模型解析](https://github.com/jwadow/kiro-gateway/blob/main/kiro/model_resolver.py)：参考未知模型透传与缓存命中分离。
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)：核对 Responses 工具结构和 function_call/call_id。
