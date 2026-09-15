# Kiro 反代协议审计（2026-09-15）

## 范围与证据

用户要求参照附件列出的项目查漏补缺。附件是研究线索，其中的推荐、版本号与协议结论需要对照源码，不作为改造指令直接执行。本轮阅读社区源码和规范、进行离线故障注入；没有使用真实账号发起推理请求。

用户已反馈 Added task 后卡住未再次复现，同类工具能完成整轮；不将本轮协议修复解释为那次等待的确定根因。

参考快照：

- [kiro-provider 协议兼容性](https://github.com/sunerpy/kiro-provider/blob/952ed8a4d89f750469585a75da216e506c2e33ee/docs/PROTOCOL_COMPATIBILITY.md)，提交 `952ed8a4d89f750469585a75da216e506c2e33ee`。
- [kiro-provider 流错误契约](https://github.com/sunerpy/kiro-provider/blob/952ed8a4d89f750469585a75da216e506c2e33ee/docs/STREAM_ERROR_CONTRACT.md)。该契约涵盖它自己的 Runtime/SDK 传输，不自动等同于所有 GenerateAssistantResponse 端点。
- [kirocc 工具结果处理](https://github.com/d-kuro/kirocc/blob/e0850b11e1a61cbb84aa55739a41b21d4a5c5fcf/internal/reqconv/tool_results.go)，提交 `e0850b11e1a61cbb84aa55739a41b21d4a5c5fcf`；同时检查 `internal/kiroproto` 和 `internal/reqconv`。
- [kiro2cc-proxy 帧解析](https://github.com/TsinHzl/kiro2cc-proxy/blob/57f63be2735657d1abb5cd11c763985e2c79eb7e/src/kiro/parser/frame.rs)，提交 `57f63be2735657d1abb5cd11c763985e2c79eb7e`，使用此前检出的快照。
- [Cyril ACP 参考](https://github.com/dwalleck/cyril/blob/main/docs/kiro-acp-protocol.md)：核对其 JSON-RPC、session/update 与 CLI 2.0.1/2.4.1 版本边界。ACP 属于 CLI 与客户端之间的一层，不能直接映射成 KAM 的推理 HTTP 接口。
- [Smithy Amazon EventStream 规范](https://smithy.io/2.0/aws/amazon-eventstream.html)：两级 CRC、header 编码和 exception/error 的权威依据。参考代码仅用于理解行为，本轮新增解码器独立实现。

## 本轮已修复

| 项目 | 之前的风险 | 当前行为 |
| --- | --- | --- |
| EventStream 完整性 | 未验证 CRC；非法长度可能不推进解析；尾部半帧被丢弃 | 校验 prelude/message CRC、长度和 header；截断帧、空流、非法 UTF-8/JSON 失败 |
| 流内错误 | 只读 event-type，遗漏 header 内 exception/error；invalidState 被输出为警告正文 | 识别 AWS 错误头及 invalidState，走错误回调，不再发送成功结束事件 |
| 工具参数损坏 | stop、新工具切换、EOF 三个分支可能构造空对象或带 `_error` 的可执行调用 | JSON 必须完整且为对象；错误时不发出损坏工具，不伪造参数 |
| 工具失败状态 | Claude is_error 被标为 success | 映射为 Kiro error，保留工具结果文本 |
| 多工具结果顺序 | 按客户端完成顺序直接发送 | 在公共 payload 构造阶段按前一个 assistant 的 toolUse ID 顺序排列，保留 ID、正文与状态 |
| 解析失败后的流释放 | 可能只释放 reader 锁，未取消剩余数据 | 在清理阶段取消 reader 后释放锁 |

## 保留的兼容行为

- 不要求所有 Generate 流必须出现 Runtime 的特定 completion witness。本轮仅拒绝确定损坏的流；完整帧后干净 EOF 仍按原行为处理。无 terminal 但干净 EOF 的语义需要逐端点验证，不能把“TCP 结束”概括成完整协议保真。
- 无工具 stop 时仍允许完整对象 JSON 在 EOF/下一工具到达时完成，与 kirocc 的 `eventstream_test.go` 中对应场景一致。不完整 JSON 不再被补成 `{}`。这是兼容性取舍，不声称具备 Runtime 严格契约。
- 不按服务端 24 MB payload/128 KB header 限制拒绝帧：Smithy 明确区分服务端限制与客户端校验责任。
- 保持当前账号认证、profileArn 获取、区域选择及模型 schema 驱动字段生成；附件对 Enterprise 端点的概括不能覆盖当前源码与已通过的实测。
- 不照搬复杂 schema 的有损 flatten，不恢复此前已导致 400 的 reasoning history，不因参考项目拒绝某字段就立即让正在工作的 Claude 客户端失败。

## 兼容性矩阵与后续优先级

| 领域 | KAM 当前状态 | 后续工作边界 |
| --- | --- | --- |
| 模型目录/effort | 按账号、区域、profile 缓存；支持 schema 的 thinking、output_config、reasoning；映射缺省等级 | 组合 schema 等未覆盖形态需要真实目录样本；不能凭模型名强行注入字段 |
| Anthropic 文本/工具 | 支持请求转换、工具结果和 SSE；本轮补失败状态、结果顺序与坏流处理 | 强制 tool_choice / disable_parallel_tool_use 未保真实现；需要可验证的执行或显式兼容模式 |
| 工具 schema | 大体透传，不承诺 Kiro 接受任意 JSON Schema | 根类型包装必须连同返回参数反向还原；不能只删 `$ref`、组合分支后声称兼容 |
| Thinking history | 当前 Generate 请求丢弃 reasoningContent，响应可输出 thinking/redacted | kirocc 的受限尾部 redacted replay 需本账号/端点复测；不可直接复制 |
| Context management | 未实现完整压缩/清理编辑语义 | 需定义哪些为空操作、哪些拒绝、哪些执行；默认严格拒绝可能破坏现有客户端 |
| 缓存和用量 | 有 cachePoint 及本地缓存用量估算，部分用量依靠上下文比例或 token 估算 | 区分上游真实数据与模拟值，不能等同 Anthropic 计费缓存命中 |
| Responses | 通过内部 Chat 转 Generate；增量事件、call_id、失败结束可用；拒绝 previous_response_id/加密 reasoning 回放 | 未实现原生 CreateResponse、存储/检索/删除、tenant 隔离 replay，不能宣称完整资源协议兼容 |
| Responses 高级字段 | 只覆盖现有转换器列出的字段；store:true 未实现持久化但仍被接受，required/命名工具选择未强制执行 | store/background、结构化输出、strict、自定义工具等需要明确支持或错误，不应默默当成有效语义 |
| System/developer 优先级 | 转换为 Kiro 历史中的系统提示表示 | 不等于 Runtime 原生 instructions 的优先级保证；需做冲突提示/续轮验证 |
| Stream 完整结束 | 拒绝损坏数据；Responses 已输出后不重复生成 | 干净 EOF 的 witness、首包/空闲超时、严格错误分类需逐端点做抓包验证 |
| 认证/区域 | 现有 KAM 账号和多端点链路，用户已验证 Luna/Haiku 可用 | Runtime 迁移需单独验证各认证类型、区域和 profile，不能只替换 URL |
| ACP / harness | 不属于当前 KAM HTTP 反代能力 | Cyril 可作为未来 CLI 集成资料；不在本轮引入子任务、MCP 或 JSON-RPC 管理层 |

推荐顺序：先明确现有接口对不支持字段的可见反馈，再做按端点的结束/超时测试，最后单独设计 Runtime/原生 Responses 与持久化 replay。迁移涉及请求语义、存储隔离和凭据绑定，需要独立设计与真实上游验收。

Responses 当前终态虽为 `response.failed`，错误码仍统一为 `server_error`；后续应把传输错误、协议损坏、工具参数错误分别编码。该分类是对现有失败语义的完善，不代表允许自动重试已经交付工具的请求。

## 验证

- `npm run test:compat`：能力、Responses、EventStream 三组单测及 23 组 HTTP 检查；故障组包含多种坏帧/坏工具参数场景。
- 新增独立固定帧与 CRC 向量，HTTP fixture 使用独立 checksum 实现，避免生产解码器与 fixture 共用错误算法。
- 覆盖分片、多帧、两种 CRC、错误头、非法 JSON/UTF-8、空/截断流、三接口异常结束、非流式错误、坏工具参数不执行、工具结果状态和顺序。
- 完整构建、主进程/渲染进程类型检查及 diff 检查通过。离线检查不等于真实 Kiro 端点行为全部验证。
