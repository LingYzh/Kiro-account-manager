# Claude Code Auto Mode 兼容性独立核查（2026-09-28）

## 范围

用户要求独立判断引用会话 `6aba8456-0220-83e9-be13-5067f64d1842` 的信息。本轮为调查与离线复现，没有改安全判定策略、模型路由或客户端设置，没有在线推理，也没有重新打包。

## 外部证据

- [官方错误参考](https://code.claude.com/docs/en/errors#auto-mode-cannot-determine-the-safety-of-an-action)：`temporarily unavailable` 表示分类器请求未能产出判定；不能据此判定为工具危险，也不能单凭措辞判定 HTTP 400 或模型名错误。
- [官方权限模式](https://code.claude.com/docs/en/permission-modes#server-side-classifier-review)：服务端审查与客户端独立分类器是不同路径。完整响应无 review 时可回退客户端分类器；对单个动作缺 verdict 时可能拒绝。`CLAUDE_CODE_AUTO_MODE_SERVER=0` 选择客户端分类器，不是禁用分类器。
- [官方网关协议](https://code.claude.com/docs/en/llm-gateway-protocol)：`[1m]` 参与客户端上下文窗口假定，不能据此宣称 Kiro 支持 1M；`auxiliary` 包括分类器、标题、摘要，并非分类器唯一标识。
- 引用中的 [#81142](https://github.com/anthropics/claude-code/issues/81142)、[#79750](https://github.com/anthropics/claude-code/issues/79750)、[#85411](https://github.com/anthropics/claude-code/issues/85411) 都存在，但属于用户问题报告，不能代替当前机器的请求证据或官方根因认定。

## 本地确定事实

- 当前 `mapModelId` 不拆分 `[1m]`；日期归一化要求日期位于末尾，带标记时也失效。
- 使用真实解析代码及合成模型目录离线复现：目录含 `claude-sonnet-5` 时，基础名命中；`claude-sonnet-5[1m]` 未命中并保留原名；`claude-opus-4-8-20260901[1m]` 只归一化 minor，日期和 `[1m]` 保留。没有发真实上游请求。
- `applyModelMapping` 只将 `*` 改为 `.*`，未转义正则特殊字符。离线验证精确规则 `claude-sonnet-5[1m]` 无法匹配同名字面量；若修复应按现有“仅 * 通配符”契约转义其余字符。
- 当前能力检查对非 null `safeguards` 返回 400；空对象同样拒绝。故“当前 KAM 必然通过主响应缺少 review 自动回退”的推断不成立。保留此前用户的严格能力边界，不能靠静默删除字段来宣称实现服务端审查。
- request-class 捕获、日志及 auxiliary 会话隔离已在当前工作树实现，引用会话将它列为待新增项属于基于旧版本的判断。
- PATH 的 npm CLI 为 2.1.246，但本机实际运行的 Claude 桌面内置 CLI 路径指向 2.1.281。不能用 PATH 版本代替实际运行客户端版本。
- 近期 KAM 最终模型日志为不带标记的 `claude-sonnet-5` / `claude-sonnet-4.6`。当前证据未建立“分类器入站带 `[1m]` → Kiro 同名 → HTTP 400”的请求级因果链；不能把可复现的代码缺口直接当作此次现场根因。

## 建议实施边界

先兼容独立的客户端分类器请求，服务端 review 仍按未知/未实现能力处理。分类器的 prompt、输出和安全决定来自真实模型；KAM 不合成 allow/verdict，也不把 HTTP 200 当作已通过审查的证明。

模型解析应分离客户端标记与候选上游 ID，保留请求来源和能力意图。优先保留目录中的精确 ID，再考虑有依据的同模型基础 ID；不能默默换成另一版本，也不能仅凭后缀把上下文上限设成 1M。真实上限仍以目标账号/区域/profile 的目录及上游为准。

回归需要覆盖带后缀/日期/精确映射、未知模型、主请求与 auxiliary 隔离，以及拒绝/无效分类结果不会被伪造为允许。分类器是否真经过 KAM，仍需入口模型、请求类别、最终模型和错误阶段的同请求关联；只记录结构元数据，不保存真实提示词、工具参数或凭据。

## 补充调查：其他 Kiro 代理实现

用户提供了新的项目对比材料；本次直接读取固定提交的源码与测试，未运行这些项目，也未据其单测宣称真实分类器端到端通过。

- `d-kuro/kirocc`：`91693e94904731651fc7324acbfe5f17411c825f`。
- `sgeraldes/claude2kiro`：`774b34bfefcb0a40fe4c9625b19996bb8f10fcaf`。
- `itututu/claudecode-kiro`：`796075c09d992ac9c2d71c7f10f703c7de5bb6e4`。
- `TsinHzl/kiro2cc-proxy`：`acfbed811843369a3cb87449eb9cf685948a7fd3`。
- `Colin3191/kiro-proxy`：`b00c4d8b15454f2394e16f8adf33b4b87d3a8602`。

### 可以采纳的证据

kirocc 的 [models.go](https://github.com/d-kuro/kirocc/blob/91693e94904731651fc7324acbfe5f17411c825f/internal/models/models.go) 确实区分基础 Kiro ID、独立 1M ID、窗口大小与客户端显示名：Sonnet 5 带/不带标记均映射基础 ID；Sonnet 4.6 的 1M 标记映射到 `claude-sonnet-4.6-1m`。大小写 `[1M]`、精确匹配和独立 1M 变体都有单测。fork 的对应映射也存在。这证明命名层的设计有参考实现，但不能证明该硬编码表对所有 KAM 账号和端点都有效。

Kiro 的 [Sonnet 5 发布说明](https://kiro.dev/changelog/models/sonnet-5/) 本身声明 1M 窗口，因此该能力也有官方产品证据。实际请求仍要遵循所用账号、区域、profile、端点的目录与上游结果。

### 需要纠正的评价

- kirocc 仍把某些未精确匹配的 `[1m]` 路径解释成 thinking opt-in，且对未知非 Claude ID 有默认模型回退；不能把整个 resolver 直接移入 KAM。
- [v0.10.0 发布说明](https://github.com/d-kuro/kirocc/blob/91693e94904731651fc7324acbfe5f17411c825f/docs/release-notes/v0.10.0.md) 修正了旧的 response-model 假设：客户端会话选择的 ID 决定窗口，响应加后缀不足以改变它。需要同时考虑 `/v1/models` 发现与客户端选中名称，不能只修响应字段。
- claude2kiro 的 [NormalizeAnthropicID](https://github.com/sgeraldes/claude2kiro/blob/774b34bfefcb0a40fe4c9625b19996bb8f10fcaf/internal/models/models.go#L348-L375) 从首个 `[` 起截断，不验证是否是已知标记。其 [isThinkingEnabled](https://github.com/sgeraldes/claude2kiro/blob/774b34bfefcb0a40fe4c9625b19996bb8f10fcaf/main.go#L1333-L1362) 检测的是模型字符串中的 `[1m]` 或 `context-1m`，用于默认 reasoning effort，并非完整的独立 1M 能力解析。普通归一化路径不会因此选 `-1m` SKU。
- kiro2cc-proxy 的 [calib.rs](https://github.com/TsinHzl/kiro2cc-proxy/blob/acfbed811843369a3cb87449eb9cf685948a7fd3/src/anthropic/stream/calib.rs) 对模型统一假定 1M，还按 0.6657 缩放客户端 usage/input/cache；这些策略与 KAM 保留真实计量、避免操纵 compaction 的目标冲突。
- Colin3191 项目所查 Messages 链路仍把 `model` 交给 `modelId`，`validModelId = modelId || undefined`；这条路径未提供 `[1m]` 支持证据。不能由局部检索反向证明全仓绝不存在其他处理。
- 不宜把静态模型表整体置于实时能力之上：kirocc 固定 GPT-5.6 为 272K，而 [Kiro 2026-09-14 发布说明](https://kiro.dev/changelog/models/gpt-5-6-1m-context-window/) 已公布渐进升级 1M。别名规则和真实能力应分层，不能让旧静态上限覆盖新目录。

### 更新后的建议

将下一步收敛为通用模型身份解析与模型发现的一致性改造：识别已知 `[1m]` / `[1M]` 与 context beta；保留原始 ID、标记来源和规范化候选；按当前账号目录选择同模型基础/独立 1M 变体；返回实际窗口和能力依据。后缀不隐式开启 thinking，未知标记不盲删，未知模型不换成默认模型，用量不缩放。无法确认的窗口不宣传为已支持。

该解析层会覆盖普通 Messages 和客户端分类器请求，但不会自动实现服务端 safeguards/review。新材料加强了修复方案的证据，仍未补足此次本机分类器失败的请求级因果链。

上一轮日志调查的补充：unavailable 字样确实出现在 Claude 的 user/tool_result 错误内容，之后被 assistant 复述；不能只归为模型生成文本。但这仍不等于拿到了分类器原始 API 请求或上游 HTTP 错误证据。

## v1.7.8 发布时仍未解决（2026-09-29 用户实测）

- Claude Code 的 effort 档位已可选择，证明模型名称兼容对该客户端入口有效；Ultracode（用户称 Ultra Code）仍未显示。暂未确认是否由模型 xhigh 支持、Claude Code Dynamic Workflows 状态、effort cap、客户端版本/配置或网关能力边界造成，不能把 effort 菜单恢复当作 Ultracode 恢复。
- 自动模式的安全分类器仍卡住。当前缺少关联到同一次失败的入站请求类别、真实模型 ID、上游状态以及客户端 verdict；此前的 `unavailable` tool_result 不是充分根因证据。`safeguards` 等尚无等价语义的字段继续明确返回 400，不能假造安全许可、review 或 classifier 结果。
- 后续只做一次受控复现，用请求级里程碑关联主请求、auxiliary 分类请求、工具结束和客户端 tool_result 回传；记录结构化状态与匿名关联 ID，不保存提示词、工具内容或凭证。并单独检查 CC 的 Workflows、effort cap 和所选模型的 xhigh 可用性。

## 2026-09-29 实施状态更新

已实现 Claude 客户端名称兼容：`/v1/models` 和 Claude Code 一键配置使用 `claude-opus-5-5` 等短横版本名，上游继续解析为 Kiro 的点号 ID；新增 `display_name`，未知部署名不改写。已有模型映射同时匹配两种拼写，且已修复上述正则转义缺口，`[1m]` 精确映射规则现在按字面匹配。这不等于实现 `[1m]` 上游变体选择；那部分调查建议仍待实施。

官方网关文档确认 `_SUPPORTED_CAPABILITIES` 对 `ANTHROPIC_BASE_URL` 无效，本次没有写入这些变量，也没有伪造能力或分类 verdict。命名识别与上游 schema 能力分别处理。见 `claude-model-identity.md`。
