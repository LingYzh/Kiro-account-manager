# Vue 迁移 Phase 3 验收

日期：2026-10-01。默认开发、构建和发布渠道仍为 React，版本仍为 1.7.9。

以上为 Phase 3 当时状态。用户随后授权 Phase 4，当前默认入口已切换 Vue；最新清理、默认入口和安装包验证见 [Phase 4 验收](vue-phase4-validation.md)。下文保留原阶段证据。

## 第一子批次：About、Webhooks、Logs

三页已接入 App 的页面映射，首次访问创建，后续页签隐藏保留实例。使用正式 `@lingyzh/ui@0.2.2` 的 tokens、已验收控件与文档契约；应用只补充业务布局。未添加通用控件或依赖。

- About：版本读取、手动检查更新、最新/可用/失败与重试、发布信息及前六项下载资产、作者外链。用户随后要求移除加入群聊入口，React/Vue 均移除按钮与二维码弹窗；原 React 图片保留为历史资产，Vue 不复制或引用。
- Webhooks：按真实源码保留六种渠道、七种事件、默认事件、Telegram/custom 字段、增改删/取消删除、启停、测试锁和结果时效，继续使用原 Pinia store。
- Logs：保留 1500ms 拉取、原显示条数键与选项、各类筛选、虚拟列表、键盘展开、自动跟随、新日志计数与原导出格式；在途请求与清空/卸载隔离，隐藏后重新显示会更新虚拟滚动尺寸。

主代理已复核真实 Electron 的浅色中文和深色英文、更新与编辑弹窗截图。编辑器使用全宽 UiField 行，避免两列水平字段拥挤；日志浮动按钮由业务布局容器定位，避免 headless 按钮的 scoped 属性边界。新增 Vue 编译配置将 `selectedcontent` 识别为原生元素，消除 UiSelect 的未解析组件警告。

`test:vue-shell` 使用真实 App、离线 preload、合成日志和通知发送替身，禁止外部请求，生产主进程与真实账号不加载。移除群聊及浮动按钮修正后的三页复验 dev 129 项、build/file 128 项通过，证据位于 `C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-uD0VhJ/`。

现有完整 `test:compat` 通过，包含 43 项模拟 HTTP、共享函数、React/Vue 共用账号特征场景和八组 Vue runtime 场景。三页与接入文件的 Vue 类型检查、定向 ESLint 通过。

原 webhook store 会吞掉 HTTP 发送失败，测试可能仍报告成功。这是既有行为，迁移未改；页面正确展示 store 返回值或 Promise 异常，不将该结果表述为真实通知送达保证。

## 第二子批次：Diagnose、ConfigSync、MachineId

三页已接入。Diagnose 保留八个默认目标、可选自定义目标、四项并发网络批次、模型缓存与未知模型输入；账号测活并发三项，停止后旧任务不会继续领取账号或污染新任务结果。ConfigSync 保留 PortableConfig v1、注册键白名单、代理脱敏、原主题透传和 KCFG1 加密格式。MachineId 保留权限/OS、修改、原始备份、文件备份/恢复、三项自动化开关、账号绑定及历史；当前和原始机器码继续只保存在内存。

六页合并回归 dev 271 项、build/file 270 项通过，证据为 `C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-aPdbd4/`。所有数据为合成账号、日志和 IPC 替身；模拟失败的唯一预期 MachineId 日志单独记录并断言，其他 Renderer、资源或外部请求错误为零。独立 Node crypto 检查确认旧 KCFG1 可被 Vue 解密，Vue 输出可按旧 PBKDF2/AES-GCM 格式解密，错误密码会失败。

主代理复核浅色中文、深色英文和解密弹窗。隐藏测试窗口必须先唤醒 compositor 再保留最终截图，避免旧帧造成选中项/复选框的像素误判；这是测试截屏流程修正。随后按视觉检查收紧诊断字段布局、机器码卡片标题，并改用 UI 库按钮触发原生文件选择；这些微调的复验随下一子批次记录。

## 系统运行验收边界

离线检查不证明真实网络更新、通知送达、机器码/管理员权限、文件往返、证书安装、真实代理服务或账号测活成功。涉及实际账号与系统状态的路径按用户运行验收记录；开发验证不运行消费额度的 `test:e2e`。

## 第三子批次：KiroSettings、KProxy

八页合并回归 dev 414 项、build/file 413 项通过，证据为 `C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-PeT7So/`。除合成机器码失败的一条预期日志之外没有渲染或资源错误。最后卸载实际 App 并确认各 IPC 订阅计数归零。

KiroSettings 保留所有选项、MCP 增改删与未知文档字段、Steering 原 Markdown 和未保存退出确认，以及命令、工具权限的默认拒绝行为；加载失败可重试，保存 false 和 Promise 失败可见。KProxy 保留状态/配置/证书/机器码/三类事件/流量统计与指南；初始化失败可重试，配置串行写入且启动等待已排队配置，最近 50 条请求只展示 10 条。主代理检查八页浅色中文、深色英文、MCP/Steering 编辑器和合成诊断结果截图；MCP 字段及编辑器 footer 的间距后续复验。

现有 React 默认构建和 `test:compat` 均通过；没有修改默认发布入口。

## 首页、设置、导出和更新

首页保留额度/订阅/到期统计、当前账号、风险提示与跳转筛选；点击风险提示替换原筛选。设置保留原持久化白名单和两套配置同步格式，旧主题字段透传，Vue 主题使用专属键。导出保留六种格式、脱敏、BOM/引号/凭证边界；更新弹窗保留六类全局事件、下载进度、安装和失败解锁，外链使用原 IPC。

首页与编辑器布局回归 dev 183 / build 182，导出与更新回归 dev 141 / build 140。设置定向回归 dev 151 / build 150，证据 `C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-E1BnCu/`；最终两入口合并结果见下方整体验收。主代理复核首页、更新与导出真实截图。

## 账号、代理与代理池

账号列表使用 Vue 虚拟化，保留卡片/行、搜索/筛选/分组/标签、批量动作、导入导出与全部业务弹窗。保留 IDE/CLI 双切换先后与失败边界、列表/卡片刷新差异、封禁恢复、账号级代理仅可选择 alive 的规则。详情与编辑保持完整 7 参数模型上下文、原凭证更新边界、额度与奖励、取消后晚结果隔离；添加账号保留四条登录和批量导入路径。

账号添加定向回归 dev 136 / build 135；详情与编辑 dev 140 / build 139，证据 `C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-FagPx7/`。最终合并验收还覆盖两种列表视图与分组/标签 CRUD。主代理检查账号卡片、详情、编辑和深色英文截图。账号虚拟列表使用 ResizeObserver 动画帧测量，宽度改变或数据/视图更新才重测，避免布局观察回路。

API 反代保持配置串行写入、启动等待、账号组重同步、状态订阅与日志上限；模型/映射、身份、客户端配置、Claude Desktop 预览 token/应用/恢复、API Key 与 usage、安全/IP/TLS/审计/重启均复用原主进程 API。代理池保留四种策略、五种状态、过滤/健康统计、文本批量导入、链路诊断与分桶规则；分桶可用候选和详情代理选择的 alive 条件保持不同的原语义。所有 IPC 发送前移除 Vue Proxy。

代理与代理池合并回归 dev 204 / build 203，证据 `C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-G0DLLk/`；代理扩展定向回归 dev 159 / build 158（`kam-vue-shell-Lo26gh`），覆盖模型映射 CRUD、单账号/组选择、Key 作用域及错误/状态事件。主代理检查浅色代理池、深色反代、客户端/API Key 与安全区域截图。

## 订阅与注册

订阅使用当前 Pinia 的业务状态，注册页面在订阅页首次创建前也能写入共享链接。保留三个 tab、资格预检、计划选择、链接生成/导入/校验/选择/删除、15 分钟时效、超额开启与关闭、订阅门户和大列表虚拟化。清空/卸载不让晚请求复活旧链接，超额开关跨 tab 互斥，完整账号上下文原样传入。

订阅定向真实 Electron dev 128 / build 127，证据 `C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-3N8lNv/`。主代理检查浅色链接页和深色管理页。

注册先拆业务 composable，再迁移模板；保留六种源、手动三阶段、单次完成事件/返回值去重、批量并发/重试/暂停/取消、共享限流、严格代理、日配额/定时、模板/历史/黑名单/分析及通知。自动导入包含密码和 verify.alive 快路径，手动点击/历史导入保持重验且不写密码。页面隐藏保留任务；实际卸载停止新派发、取消后端注册并释放三个 IPC 监听和定时器。日配额缩减作用到实际队列，跨日重读计数，新增注册链接保留 generatedAt。

原代码的诊断类别、字段默认值、usage 百分比单位及成功/失败处理边界经主代理和独立只读代理对照复核。手动 OTP 后失败回到 idle，取消等待期间不接受完成事件，后处理和历史导入锁重启。运行中锁住来源与后处理配置，邮箱/OTP 和批量暂停、恢复、停止可操作；混合源 SWRR 保持旧零权重回退行为并有 golden 检查。初轮注册定向 dev 132 / build 131（`kam-vue-shell-5DUR7f`）；最终合并回归另覆盖手动流程自动导入与配置锁。

## 全部页面最终合并验收

正式 `@lingyzh/ui@0.2.2`、无候选 UI 来源且无页面过滤的 `npm run test:vue-shell` 已通过：开发冷启动 **1204 项检查**，构建 file 入口 **1203 项检查**。报告和截图位于 `C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-47KwFs/`，分别为 `dev-report.json` 和 `prod-report.json`。

两入口均覆盖全部 15 页、业务弹窗、外壳导航/主题/语言/关闭及跨页面集成。Renderer、资源加载和外部请求错误为零；各自只有一条已断言的模拟机器码失败日志。最后卸载真实 App，页面与应用所有 IPC 监听计数归零。主代理复核最终注册、设置、账号、代理及其他各批浅深色、中文/英文和弹窗截图。

`typecheck:vue`、主进程/React `typecheck`、完整 `test:compat`、六类 `test:vue-contracts`、React/Vue 完整构建、改动范围定向 ESLint 与 `git diff --check` 均通过。主进程原有 logger/tlsClientPool 混合动态/静态导入构建提示仍存在。最新本机应用 `out/renderer` 为 Vue；默认构建和发布渠道仍为 React，KAM 版本仍 1.7.9。代码及离线验收完成，真实系统验收边界保持如下。

## 运行命令与边界

在应用目录执行 `npm run typecheck:vue`、`npm run typecheck`、`npm run test:compat`、`npm run test:vue-contracts`、`npm run test:vue-shell`、`npm run build:vue` 和 `npm run build`。`test:vue-contracts` 覆盖六类独立格式/加密/纯函数兼容合同；`test:vue-shell` 无环境过滤时覆盖全部 15 页、业务弹窗和外壳两入口。

所有验证继续使用离线 preload、合成账号及临时 userData。真实注册、收费订阅、网络通知、代理监听、客户端配置写盘、证书、机器码、托盘与文件对话框仍需用户系统验收。Phase 4 尚未启动；默认 React 入口和发布版本保持原样。
