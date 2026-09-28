# 上下文保留与超限错误第一版（2026-09-28）

## 背景与证据边界

用户反馈 Claude Code 在首轮请求也可能丢失 permission/plan mode；当时 token 裁剪开关关闭。源码确认 Claude 转换器原先忽略 `messages[].role = system`，两个入口还会注入固定的 `execution_discipline`，且 byte 工具结果截断独立于 token 开关。这些是独立可修复缺陷；现有证据不足以确认哪一项就是用户原始故障的实际触发点。

本轮采用协议层的保留与错误反馈，不识别客户端身份、不依靠提示词关键词猜测模式、不引入代理摘要。Kiro 的 user/assistant 历史表示不能提供与 Anthropic 原生 system 完全相同的优先级保证。

## 当前行为

- Claude `messages` 接受 user、assistant、system；其它 role 返回请求错误。system 仅接受字符串或 text blocks，保留顺序和 cache 标记，按原位置合并到相邻 user 回合，不能提升至顶层而让后来指令作用于更早消息。
- 顶层 system 使用独立的 `systemMessages` 通道，普通历史规范化后再加入 Human/AI pair。模型时间信息与用户配置的 steering 保持原有行为。两个转换器均移除硬编码的 `execution_discipline`。
- `enableTokenBufferReserve` 默认 false，同时禁用 token 历史删除和 byte 工具结果截断；已保存为 true 的配置仍表示用户显式启用裁剪，不自动修改配置。
- 显式启用时只删除合法的旧历史前缀，保护顶层 system 和 current tool_result 所依赖的 assistant/tool_use，不能以孤立 tool_result 开始。删除后加入一次明确提示并重新估算、校验。无安全切点时交由上游检查真实上下文限制，不凭本地估算伪造超限错误。
- 任意 `messages[].role = system` 会按请求强制保留整段历史，避免删除模式切换之前的作用域；不临时翻转全局开关。过大时返回错误。
- 字节限制使用实际序列化 JSON 的 UTF-8 字节数，默认 153600 KB（150 MB）；构造时及追加 profile/model/origin 后、实际发送前均检查。无法安全缩小时返回 413，当前工具结果不截断。HTTP 入站 body 限制仍是另外一项配置。
- HTTP 400 的结构化 reason/code 精确等于 `CONTENT_LENGTH_EXCEEDS_THRESHOLD`，或 invalidStateEvent 明确给出同一 reason 时，映射为 `ContextLimitError`；Anthropic 返回 400、`invalid_request_error` 和 `capability_rejected: prompt_too_long`。不编造 token 数或上下文窗口。
- 普通 400、413 不伪装成上下文超限；字符串正文仅全文精确等于上述 reason 才识别。请求/容量错误不换账号或端点重试；签名剥离重试后遇到上下文错误或 413 也终止。
- Claude SSE 在首个内容块（或有效空完成）才发送 200/message_start。之前失败返回真实 HTTP JSON 错误；已经输出内容则只发送一次 SSE error，不再发送成功 message_delta/message_stop，也不重放已交付内容。
- 请求里程碑新增 role 序列，便于区分原始入站与转换后的历史；不新增正文、工具参数或结果内容日志。

## 验证与试用

- `npm run test:compat` 新增 context 与 request-errors 两组离线测试，并扩展真实 HTTP 代理 + 模拟 Kiro 的集成回归。覆盖 system 首中尾/连续/工具间顺序、cache、默认保留、显式裁剪保护、UTF-8 字节、精确超限分类和流式失败终态。
- `npm run build` 检查主进程/渲染进程 TypeScript 并构建 Electron。
- 本轮最终结果：五组离线单测与 30 组 HTTP 检查全部通过；完整 build 和 `git diff --check` 通过。Windows unpacked 打包成功，已从 app.asar 核对上下文错误标记、system 验证和 preserveHistory 实现，且不存在旧 execution_discipline 注入。
- Windows 试用输出目录：`Kiro-account-manager/dist/context-preservation-v1/win-unpacked/`；运行其中 `kiro-account-manager.exe`。整个目录需一起保留，不是单文件便携版。
- 用户实测：退出原 KAM 后启动试用版；确认“代理裁剪 / 预留 token”关闭；Claude Code 新建会话，分别检查进入计划模式、退出计划模式、工具调用后的续轮。用原先容易出现问题的相同模型与场景复测。
- 离线成功不证明 Claude Code 自动压缩一定触发，也不证明真实 Kiro 的 system 优先级完全等价；本轮没有用真实账号消费额度或替换已安装应用。
- 大工具输出回归使用分行文本。额外观察到几十万连续相同 ASCII 字符会使既有同步 `js-tiktoken.encode` 长时间占用事件循环；这属于独立的分词性能问题，本轮未修改分词器，也不能将它认定为旧 Codex 会话加载卡顿的根因。

## v1.7.7 发布

- 用户已实测确认 Agent 能正常明确自己的 permission mode，并授权发布 Release。
- 同步版本为 1.7.7，README.md/README_CN.md 提供对应更新说明；缓存统计与时间戳优化未包含在本版。
- 沿用现有跨平台 Build & Release，新增版本标签触发与标签/包版本一致性检查，保留远端已有 windows-2022 runner 修复。
