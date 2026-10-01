# Phase 3 API 反代与代理池实施契约

默认 React 入口保持；使用当前 Vue stores、已发布 UI 0.2.2 与既有 preload，不更改 main 的协议、安全或缓存行为。

- ProxyPage/ProxyPanel 通过业务 composable 管理状态、模型、账号同步、配置写入、请求日志、监听和定时器；访问后 v-show 保持，所以只需一个响应订阅记录最近 100 条日志，卸载须释放所有监听。历史日志加载不能覆盖加载期间刚到的请求。日志按原两秒防抖保存，显式清空持久化空数组。不记录凭证或原始请求正文。
- 状态查询合并在途调用，旧响应不能覆盖新配置；配置串行 IPC，启动等待已排队修改。配置采用完整未知字段透传，所有原选项、数值解析/default 和单账号 selectedAccountIds 转换保持。失败和初始化重试可见；重复 start/stop/sync/restart 不重叠。
- 账号同步保持 active+accessToken 筛选、group/未分组范围、完整 credentials context/profileArn fallback、固定字段 payload。签名只由原 eligible id+group 组成，600ms 防抖且跳过首次运行同步；token/usage 更新不触发无关重同步。start 先 sync，再带原七项启动参数。
- 公网开关运行时先保存 host、stop、200ms 后 start；直接 host/port 编辑在 running 时禁用。默认端口 5580、host loopback；API key 原三种格式、遮罩/显示/复制和计时反馈保留。
- 全部配置页包括轮询策略/分组、自动切换、日志、endpoint、retry、payload、工具禁用/客户端驱动、token reserve、vibe/spec/workspace、安全/IP/TLS/限流/会话/指标/审计/超时/fallback。设置反馈使用原生库，通用控件不在 KAM 新建。
- 子 dialog 保留简要日志 TXT、详细日志 .log 导出、模型上下游 ID及映射开关、映射 CRUD/顺序/权重/key scope/default effort、单账号选择、API key CRUD/额度/用量每日/模型/历史及重置、一键客户端配置。所有闭合/换上下文/卸载隔离在途操作，定时器只在各原需要的开放/运行状态工作。
- Claude Desktop 继续复用 src/shared/desktopConfig.ts 的身份、默认路由和类型；state/preview token/apply/restore 和恢复记录保留，模型刷新不重置手选目标，失效 preview 不得应用。仅模拟实际文件写入，真实用户文件必须留运行验收。
- ProxyPool 保留五类状态、四策略、健康聚合/Top5、所有原配置和 IP endpoints、单条新增与批量文本导入、全文及 status/protocol/enabled/latency/time 筛选、虚拟行、增改删与单/批次验活、账号绑定/只补未绑定/清绑定、原 enabled && status != dead 的分布统计边界以及 store 真实分布动作；不得强行统一与 account picker 的 alive 边界。定时验活每60秒检查，间隔与并发来自原配置，卸载清理且不重叠。

root 负责接口和视觉验收，workers 分区实现业务组件。验证使用合成 IPC/临时 userData/模拟代理条目；网络、监听端口、证书、客户端配置文件与真实额度均不操作。
