# Phase 3 注册模块执行契约

从 React RegisterPage.tsx 的纯函数与队列状态机先抽 Vue business composable，再实现界面；不改 main/registration、真实网络或当前 React 渠道。root 已直接审查原件核心流程以及 main IPC 完成事件边界。

- 六模式 manual/outlook/tempmail/proton/gptmail/mixed，完整原配置及 LS key兼容。模板 old moemail→outlook、mixed源/权重独立键、原batch defaults1/5s/autoImporttrue/retries1/concurrency1/proLinkfalse。手动parent+dotvariant、Proton母号+session分配集、已用邮箱(accounts/history/blacklist)去重；TempMail/GPTmail域名池配置原样交给主进程。
- 将状态/监听/队列统一放生命周期内（Vue页面访问后v-show保留），不复制原React永不释放的module级IPC监听。Pinia捕获当前实例，注册页面onMounted一次建立log/step/complete，实际unmount释放/取消在途/停止启动新任务/清所有timers。log最近500、taskId→batch行step/IP/elapsed原行为；不得将真实凭据写入新诊断或项目记录。
- 初始化registrationStatus检测inProgress且本地idle按原取消残留；手动manualPhase1全配置→email；预填邮箱自动phase2→otp；phase3只从invoke结果处理，不等complete事件。manual phase steps动态将Import/ProLink放Done之前，后处理期间锁新注册/reset。
- 单次自动startAuto没有taskId，main发registration-complete且invoke也返回result；结果处理只执行一次，不能二次导入历史。批次有taskId，main不发complete，只处理invoke，step事件通过map更新行。取消后晚complete/phase结果不可再导入账号/发链接/更新新任务；重复start和manual等待期不可另开流程。
- 批次每task/每retry重新build source，mixed保留原SmoothWeightedRR（含0weight fallback）；Outlook行池Fisher-Yates一次，各worker独占shift行，耗尽按原回退全列表；Proton点号sessionallocated集合去重复。
- 批次代理池enabled必须strictProxy，池空或没有可用代理拒绝启动该task，绝不回退直连。每次retry重新pickNextProxy/injectProxySession({session}或parameterUsername)，upstream trim；reportProxyResult exact原结果/邮箱/error。手动/单次proxy注入仍保留源边界，无新增主进程规则。
- 共享createRateLimiter原实现；默认10/min burst3 backoff8..120s autoBackofftrue threshold5/disabled999999；waitForSlot abortsignal，1Hzsnapshot riskWarning上升沿webhook/可autoPause，恢复清edge。pause阻止新任务及retry，已有task继续；retry等待3s每100ms可abort；pause等待300/500ms、启动间隔也必须可取消。concurrency至少1且不超配置。
- TaskCenter kind register-batch完整pause/resume/cancel/progress/done/success/fail callbacks，同一Pinia；停止不得被final complete覆盖cancelled。取消全后端仅对应实际注册生命周期，禁止PID/进程终止。每天成功配额原LS日期key/limit/schedule weekdaymask127/time03:00，每分钟tick；跨午夜正确换日，配额缩减必须作用到实际新建及重试队列长度。schedule只本日一次/非manual/未有任何注册流程，unmount释放。
- autoImport快路径verify.alive metadata直接导入含password，subscription原PRO_PLUS→Pro_Plus/PRO→Pro/POWER→Pro_Plus，usagepercent原Math.round*100保留（旧业务本身语义）；fallbackverify失败仍直接导入原可用credential，catchfalse。手动import/historyimport保留原不含password边界、region等字段，csrf空/expiry1h/sourceflags准确，无擅自覆盖新订阅字段。
- 注册历史原LS最近100（UI也限100避免旧内存无限增），记录result/password/imported、单item import/deleteall确认；email_used追加黑名单最多5000、filter/remove/clear/refresh；diagnose错误优先级按原保留，分类兼容retry network/otp/rate/all。success/fail/batch/risk四类webhook原字段（用户已授权该现有业务行为，测试必须mock，不真实发送）。
- fetchProLink在订阅state未初始化页面时也调用 useSubscriptionState(pinia).appendLink/updateLink，随机linkId，与原完整8参一致；不新增 accountId，也不能丢链接生成时间，后续validate需有generatedAt以表示新链接。原result页面成功/失败/密码/region/token复制/导入按钮完整。
- UI保持全配置/源说明/字段与边界、Proton login/status async、模板命名CRUD/importJSON按ID新优先/exportJSON、daily/schedule/rate/风险、manualsteps、批次行/诊断/failedretry、日志clear/autoFollow、历史、>=5analytics含小时/近7日/provider/errors/CSV导出。数据图可用本业务CSS/SVG bars而无需新通用UI依赖。库UiCard density、UiSelect items、UiButton secondary/primary/ghost/danger，UiDialog scrollable named slots。原文案及i18n可复用共享register keys。

离线验收：合成所有六source，manual各阶段/fail/cancellate，singleevent/invoke去重，batch concurrency/pause/retry/strictproxy/ratequota/taskcenter/steps/临时LS/订阅跨页，不真实注册、邮箱、支付、额度、网络或凭据。静态测试验证purehelpers及队列边界，Electron两入口验证UI，root审实际diff与截图。
