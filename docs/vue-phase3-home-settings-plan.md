# Vue Phase 3 第二批：Home、Settings、ExportDialog、UpdateDialog

2026-10-01。第一批八页完成离线与视觉验收后实施；默认 React 入口、版本及发布渠道保持。

## 已核对的行为与迁移规格

- Home：复用 accounts.getStats()；封禁账号不重复计入到期/额度告警；到期阈值七天，额度阈值 0.9。告警先把分组设为 all、以告警筛选替换原筛选，再跳转 accounts。额度只累计 active 且 limit>0 的账号，保留负剩余额度、超过100%的文本与 precision。使用 UiProgress/UiAlert 表达进度和超额，不复制旧渐变/条纹。当前账号保留订阅、Token 时效、登录来源、基础/试用/奖励额度及原日期处理；不增加网络或定时器。
- Settings：对应现有 settings/autoSwitch/accounts/app stores。语言和三态主题统一现有 composable/app；旧 AccountData.theme 原样透传，不恢复旧调色板。隐私、用量精度、切号目标、私密登录、自动刷新/同步信息、主动续期、API类型、K-Proxy转发、代理、自动换号、批量并发、托盘和快捷键均保留。不得借页面迁移改变 store 的写盘白名单或定时策略。
- Tray/快捷键/API 设置：复用原 preload，托盘只发改动字段；录制按 Ctrl/Command/Alt/Shift 顺序，忽略单独修饰键。加载/失败可见，重复异步提交锁定，释放后不继续后续调用。手动刷新只在显式点击时调用既有动作。
- Settings 的旧 ConfigSyncCard 是另一种独立格式，必须保留：type=kiro-account-manager-config、代理 Map 的原 ID、原 localStorage 白名单及原覆盖确认。导入先 clearProxyPool，再直接重建 Map；保留清除代理绑定的既有行为。它不等于 ConfigSyncPage 的 PortableConfig v1，不混用文件格式。
- 清空账号保留两次确认，随后按原流程逐项 removeAccount。原实现未清除 groups/tags，即使文案提到它们，也不在迁移中扩写删除范围。
- ExportDialog：六种原格式、原字段和命名。JSON 使用 accounts.exportAccounts(ids)，取消包含凭据时只清空 access/refresh/csrf；OIDC 与卡密保留原始独立格式和凭据规则。CSV 保留 BOM 与双引号转义。剪贴板完成后延迟1.5秒关闭，释放清理定时器；文件取消不关闭。纯格式化可放 Vue lib，业务对话框供 Settings/Accounts 共用。
- UpdateDialog：全局一次订阅六种更新事件，释放时全部解绑。available 自动打开；downloading 禁止 Escape、遮罩或按钮关闭；downloaded 按原安装动作；不增加自动检查。下载异常可见且重复点击锁定。HTML/Markdown 更新说明使用已验收 UiMarkdown 的现有安全渲染，链接经 openExternal；不新增通用控件或依赖。

## 验证

合成账号验证 Home 统计、重叠告警、筛选跳转及超额；Settings IPC 替身验证参数、保存失败、取消和原数据边界；六种导出格式验证完整合成文件正文，禁止实际账号凭据；更新事件替身验证下载/进度/完成/异常及释放。运行 Vue 类型检查、定向 ESLint、离线兼容与真实 Electron dev/build入口；主代理检查浅色中文、深色英文及实际弹窗。

继承已验收 UI 库/tokens 和业务布局；复用 UiCard、UiField、UiSelect、UiSwitch、UiButton、UiDialog、UiAlert、UiProgress、UiMarkdown。JS 页面 `<script setup>`，稳定辅助模块 TS，四空格；所有跨 IPC 的 Vue 数据先 toIpcData。子代理仍按本会话均衡模式使用 GPT-6 Sol medium，root 负责规格、决策和最终验收。

