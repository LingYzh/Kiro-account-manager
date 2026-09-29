# Claude Desktop 一键配置与模型映射

## 目标与范围（2026-09-29）

用户将本轮重点明确为：全新 Claude Desktop 在第一次启动前即可配置为 3P Gateway；默认 Opus、Sonnet、Haiku 三档，自动从当前目录选各档最新 Claude，允许下拉改选其他模型及添加更多条目。

- 当前基线为 `b09ed41`，内层 package 版本 1.7.7；引用会话使用的 1.7.8 及已有 client-config 测试不适用于这个本地基线。
- 原有模型选择器写入六种客户端的默认模型，Claude Code 的 Sonnet 映射也使用该值，并不控制反代模型目录。界面已改名为“客户端默认模型”并补充说明。
- 新增独立 Desktop 页签作为默认入口；“其他客户端”保留原来的六种接入，默认不勾选，避免误改全部客户端。
- 本轮没有将旧六个适配器全面迁移。Hermes 正则重复键、OpenClaw 字段及清空 fallbacks 问题仍在旧实现中，不能描述为已修复。

## 实现

- `src/shared/desktopConfig.ts`：共享 IPC 类型、默认模型选择及 Desktop 模型路由校验。最新按实际目录中的 Claude 版本数字排序，缺档留空；不编造不存在的目标，不自动替换用户已选模型。
- `src/main/clientConfig/claudeDesktop.ts`：Desktop 专用适配器。Windows 使用 LOCALAPPDATA，macOS 使用 Library/Application Support，Linux 使用绝对 XDG_CONFIG_HOME 或 ~/.config。未支持自定义 CLAUDE_USER_DATA_DIR，预览中明确说明。
- Desktop 的四份文件：`Claude/claude_desktop_config.json`、`Claude-3p/claude_desktop_config.json`、`Claude-3p/configLibrary/_meta.json`、KAM 专用 UUID profile。普通/3P 两份配置写 `deploymentMode: "3p"`，profile 配置 gateway/bearer/URL/key/models，meta 登记并选中该 profile。
- KAM profile ID 与 CC Switch 不同；不覆盖其他 profile、MCP、权限或网络限制。不照搬 CC Switch 的 `coworkEgressAllowedHosts: ["*"]`。
- KAM userData/client-config/claude-desktop/routes.json 保存真实模型映射，与四份 Desktop 文件一起进入写入操作。应用前要求 Desktop 完全退出，不代用户终止进程。
- `/claude-desktop/v1/models`、`/claude-desktop/v1/messages`、`/claude-desktop/v1/messages/count_tokens` 复用代理鉴权、IP 规则、限流、账号白名单及原有 Anthropic 处理链。仅专用入口解析 Desktop 路由；不再叠加全局模型映射，避免选中的目标被二次改写。
- Claude 目标的菜单 ID、预览和请求路由统一复用 `src/shared/modelIdentity.ts` 的 `toClaudeClientModelId`（由 v1.7.8 的主进程模块迁入并保留 re-export）；例如 claude-opus-4.8 → claude-opus-4-8，不固定伪装成旧版本。非 Claude 目标仍使用档位路由别名。内部 route.id 保持稳定；客户端 ID 重复时拒绝配置。消息/流响应保留客户端请求 ID，计费日志记录实际目标。
- 未识别的 Desktop 路由返回 400；不默认回退。裸 opus/sonnet/haiku 使用该档第一条映射。真实目标仍通过现有上游模型目录解析与 thinking schema 校验。

## 写入与恢复边界

- `fileTransaction.ts` 负责字节备份、同目录临时文件发布、前后哈希与操作日志。新建私密文件/备份使用 0600；普通已有文件保留权限。
- 先解析并规划全部文件，预览不写盘；IPC 只返回字段列表/路径/模型映射，不返回完整原文件或密钥。解析错误也不回显原内容。
- 预览令牌十分钟有效，连接/密钥变化或磁盘文件变化必须重新预览；重复应用没有变化时不生成新备份。
- 多文件不宣称整体原子。失败时尝试恢复，外部修改冲突则保留 pending 操作，界面支持重启后恢复。存在 pending 时不接受新应用。
- 恢复先校验全部目标及备份哈希，再倒序恢复；新建文件仅在内容仍等于 KAM 输出时删除。目标被用户/其他工具修改时拒绝覆盖。
- 外部程序不参与进程内锁，最终检查与 rename 间仍存在竞争窗口；不能宣称绝对无竞争或断电级事务。

## 验证

- `npm run test:compat` 纳入新 `test/compat-desktop-config.mjs`，覆盖空目录首次配置、默认版本选择、额外/非 Claude 映射、脱敏预览、原配置保留、幂等、旧字节恢复、陈旧预览、失败中途恢复及重启恢复。
- 离线 HTTP 套件加入 Desktop 专用入口测试：鉴权、模型列表、流/非流响应别名、真实目标、未知模型拒绝、token 计数、与普通入口隔离；合并 v1.7.8 后共 43 组检查。
- `npm run build` 通过类型检查和 Electron 主进程/preload/renderer 构建。保留已有 logger/tlsClientPool 混合导入提示。
- `node test/client-config-preview.mjs` 启动可复现 UI fixture（127.0.0.1:5199），使用真实配置服务及临时根目录/合成模型，禁止访问真实客户端配置。浏览器验证默认值、GPT 映射、Qwen 加项、预览、应用、幂等。
- 已只读核对本机 Claude 2.9939.2.0 的配置读取路径、deploymentMode、configLibrary/appliedId 逻辑；没有启动全新原生 Desktop 做端到端验证，也未调用真实账号推理。

## 原生验收步骤

1. 完全退出 Claude Desktop（新安装时先不要启动），启动本轮构建的 KAM。
2. 反代设置 → 一键配置 → Claude Desktop，检查三档预填模型；可将一个目标改为非 Claude 模型并添加额外条目。
3. 预览确认路径、网关与映射，再应用；先启动 KAM 反代，再启动 Claude Desktop。
4. 检查进入 3P Gateway、模型菜单名称及默认项；分别验证普通回复/流式/工具回传。运行中切换模型的缓存偏好受 Desktop 自身行为影响。
5. 恢复测试前退出 Desktop，在 KAM 的“备份与恢复”选择本次操作；外部修改冲突应拒绝覆盖。

## 参考

- [Anthropic Desktop configuration reference](https://claude.com/docs/third-party/claude-desktop/configuration)：官方本地配置位置、gateway、认证、模型列表及首项默认语义。
- [CC Switch Desktop adapter](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/claude_desktop_config.rs)：参考双 deploymentMode、configLibrary 元数据、独立 profile 与路由角色模式；未整体迁入其应用或写入引擎。
- [CC Switch Desktop guide](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.6-claude-desktop.md)：核对 Desktop 与 Claude Code 独立配置及非 Claude 模型映射边界。

## 2026-09-29 同步远端

- master 从 b09ed41 快进到 origin/master 1f774e6（v1.7.8）。同名未跟踪 Desktop 测试改名为 compat-desktop-config.mjs，保留远端旧客户端测试。
- 合并前主程序集成改动已不在工作区，只剩未跟踪 Desktop 模块；本轮补齐 IPC、preload、界面与专用网关。
- 配置过旧测试版的用户需重新预览并应用，让 Desktop 文件采用新客户端 ID；不会自动改写真实配置。

## v1.7.9 菜单与发布

- 用户已实测确认 3P 配置可用。菜单名称改为由真实 modelId 生成（如 Claude Opus 5），表单只读展示；profile labelOverride 与模型列表不再拼接 ID。旧表单标签在预览时归一化，不改变真实目标及客户端请求 ID。
- 发布版本 1.7.9；已有 Desktop 配置需要重新应用才能更新菜单。
