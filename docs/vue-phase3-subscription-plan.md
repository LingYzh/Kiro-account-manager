# Phase 3 订阅业务契约

先将 React SubscriptionPage.tsx 中纯解析、资格判断及队列动作抽到 Vue 业务 composable/纯函数，再接三个 tab 的 UI。使用当前 Pinia 账号 store，同一实例的订阅状态必须能由注册后处理写入。状态只保留本会话，不新增账号持久化字段。

- 原始默认 tab 为 overage，另有 links/manage；concurrency 默认5，quick pick 默认10。账号源以账号页 selectedIds 非空为优先，否则全部；订阅管理自己的选择集独立。保留所有实际渲染操作，不迁移原 false/dead code。
- FREE 取 type/title 含 FREE 或两者均空且有 token；预检另外依次判断无 token、paid(PRO/ENTERPRISE/TEAMS)、未知类型、error 且 suspended/封禁/temporarily、upgradeCapability 含 NOT。预检展示和批量 FREE 取数原本不完全相同，不能擅自改为用预检替代。
- 计划由第一 FREE 账号查询，完整7参上下文；默认选择 qSubscriptionType 含 PRO 且不含 PLUS，否则第一项。批量链接重置结果/选择集，固定并发池，保留逐行 pending/loading/success/error/url/time/validated。单项 regenerate 使用所选计划。
- 链接导入按原 URL/邮箱正则去尾标点，URL 去重，未知邮箱生成展示文字，import-UUID ID。多选支持所有状态、全选/反选/清空/状态追加、top N/next N 末尾循环。删除选中仅移除链接；删除失败/过期可另勾选连带删除账号，均先确认。导出选中/全部有效 URL 为换行文本复制，原按钮不下载文件。
- 链接验证只针对 success+url；生成超过15分钟（时间缺省无限旧）直接 expired，否则 HEAD timeout6000，并发来自配置，success 或 status<400 视为成功。晚响应只能更新本批次仍存在的目标；删除/换代不能复活链接。打开全部成功链接保持原并行接口；copy/单开/失败反馈与重复锁完整。
- subscribed=有token且 type/title 含 PRO/ENTERPRISE/TEAMS；可开 overage 必须 OVERAGE_CAPABLE 且当前非 true。ENABLE/DISABLE 调用完整8参，成功仅更新现有 usage.resourceDetail.overageEnabled，保留其余字段。重试失败项和自定义全部目标保留。manage批量门户先确认，限并发每worker成功开窗后500ms；关超额只针对true并先确认。
- manage列表>=50行用 vue virtual，原44px/overscan10可随真实内容高度适配，不丢日数/套餐/超额状态/选择/单行门户功能。列表和统计/进度/说明、预检阻止原因、无账号/无计划/失败状态皆完整。Ui库tokens/components，不新增通用UI件或依赖。
- 队列/composable必须捕获Pinia实例、互斥/世代/unmount守卫，IPC toIpcData；卸载停止发新任务，不能依赖组件渲染跨页面通知。注册使用公开 append/update 方法写入同一订阅状态。默认React不改。

离线验收使用合成账号/链接/IPC，验证两类资格边界、完整参数、并发上限、失败/重试、删除不复活、状态选择、导入去重、HEAD/时效、门户/超额/关闭清理；禁止真实支付、额度和网络。
