# Phase 3 账号模块实施契约

日期：2026-10-01。默认渠道仍为 React；已发布 UI 0.2.2 的组件/token 和原业务数据层为迁移基础，不增建 KAM 通用控件。

- AccountManager 拥有持久化的 grid/list、五个 dialog 的显示状态和文件导入。JSON 使用完整 export/import 协议；CSV 处理引号转义；TXT 保留逗号/竖线和卡密三类分隔符、第六字段 provider 推断、当前实际分组与未分组行为。文件取消不改变数据。
- Toolbar 保留搜索、统计、全选/取消、分组切换/批量移动/管理、标签混合状态批量增删、代理绑定/解绑、筛选折叠、隐私、刷新 Token/检查信息/测活/确认批量删除。过滤操作合并当前 filter；首页告警跳转依原逻辑替换 filter。域名按数量及字典排序、默认前 16 项且已选超出项可见。原状态和范围不扩宽。
- 集合继续使用现有 @tanstack/vue-virtual，卡片与列表共享业务展示组件及动作 composable。Grid 按实际宽度调整列，隐藏后重新显示复核尺寸；虚拟化不能裁掉长奖励/错误或隐藏焦点控件。List 的信息刷新先 Token 后状态；Grid 的信息与 Token 各有独立动作。视图切换销毁原视图的局部状态，与原行为一致。
- 账号动作保留 IDE/CLI/both 凭证 payload 和 both 的旧成功边界：IDE 失败为失败，CLI 单目标失败为失败，both 时 CLI 失败不撤销 IDE 成功；IDE 返回 refreshedCredentials 先同步到账号及持久化，CLI 使用原先捕获 payload。社交只需 refreshToken，IdC 还需 clientId/clientSecret。
- 卡片显示封禁详情和重置、订阅计划/付费链接/管理、复制邮箱/凭证、切换/退出、刷新、详情、编辑及确认删除；列表保留原动作集合。成功链接先复制、800ms 后打开订阅窗口；销毁后取消 UI 定时器。原订阅/额度/Token 日期、精度、负剩余与超额文本保留，用 UI 库 Progress/Badge/Alert 表达，数据标签 ARGB 颜色保留。
- Group/Tag dialog 用同一 Pinia 的原 CRUD/批量分配动作，关闭不提交。颜色和 Alpha 是账号数据；组删除将账号变为未分组，标签删除移除关联，连续分配保持当前模式。颜色编辑允许原生业务 color/range 输入；通用交互使用已发布库。
- EditAccountDialog 保留加载本地凭证、验证/刷新后写回原 credentials/subscription/usage 字段及一小时 expiry 边界；切换账号/关闭使旧结果失效。DetailDialog 显示脱敏账号、所有额度/订阅/模型能力、绑定存活代理；模型按完整账号上下文查询，关闭或换账号隔离晚返回。
- AddAccountDialog 通过业务 composable 拆出登录、轮询与单/批次导入；保留三种模式、四种登录来源、并发批次、重复判定、失败输入和各来源写入字段差异。关闭/取消/卸载释放轮询、Social 回调及复制定时器，晚返回不得添加账号或启动新操作；取消按实际会话来源调用。凭证不得写日志。

所有 IPC 对象先 toIpcData；异步动作防重复、明确 loading/error、卸载隔离。验证采用合成凭证、离线 IPC 和临时 userData，覆盖实际 DOM、原 payload、格式互操作及订阅释放；真实 IDE/CLI/认证/上游模型与系统文件操作留用户运行验收。
