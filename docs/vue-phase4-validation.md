# Vue 迁移 Phase 4 验收

日期：2026-10-01。用户明确授权开始 Phase 4，默认入口切换和旧渲染层清理已完成；版本保持 1.7.9，未提交、推送或发布。真实账号与系统业务验收仍待执行。

以上为切换完成时的检查点。用户随后授权合并 master 并发布，package/lock 与日志同步至 1.8.0，`v1.8.0` 标签使用现有三平台 Build & Release 流程；CI/Release 状态以 GitHub 运行结果为准，下面保留本机验证证据与实机业务边界。

## 默认入口与清理

- 默认 `npm run dev`、`npm run build`、`typecheck:web` 统一使用 Vue；`dev:vue/build:vue/typecheck:vue` 保留兼容别名。electron-vite 任意 mode 均使用 Vue 插件、`src/renderer-vue/index.html` 和原有别名/预构建修复。产物路径仍为 `out/renderer/`，生产主进程/preload 加载契约不变。
- 新 Node 开发启动器在 Windows 交互控制台用绝对系统路径运行 chcp，electron-vite 继承实际控制台；其他平台直接启动 CLI。`npm run dev -- --help` 在 Windows TTY 中返回 0，输出 Active code page: 65001 与 CLI 帮助，不启动生产应用。
- TS、ESLint、编辑器缩进、调试路径与三平台发行脚本同步调整。稳定 TS 基础继续检查，易变 Vue JS 业务保持既定方式。UI 继续使用正式 `@lingyzh/ui@0.2.2`，没有新增产品依赖或通用控件。
- 旧 `src/renderer/`、React accounts wrapper、`test/ui-preview/` 与 client-config React 预览归档移出工作区。原五组账号特征断言保留，由实际 Pinia store 执行；共享/runtime/HTTP/合同测试保留。
- 移除 17 项直接 React 相关依赖，npm 共移除 131 个包：React/React DOM、Zustand、Tailwind/plugin、framer-motion、React 虚拟列表/图标、cva/clsx/tailwind-merge、React 类型、构建/lint 插件。实际代码/脚本/调试配置无旧源码引用；历史日志保留。package 与 lock 的依赖/开发依赖、版本、UI 精确版本一致。
- 关于页群聊入口仍已移除，README 联络 QR 保存于 `resources/community-qr.png`。四份中英文 README、AGENTS、HANDOFF、品牌说明和迁移记忆已更新，历史发布日志没有改写。

## 类型、行为与默认入口

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 主进程和默认 Vue 类型检查通过 |
| 定向 ESLint / 新测试 `node --check` | 改动配置、Vue/shared/测试与启动器通过 |
| `npm run test:compat` | 43 项模拟 HTTP、共享模块、五组 Pinia golden 和八组 runtime 场景通过；独立协议/配置等兼容测试通过 |
| `npm run test:vue-contracts` | 六类账号导入/导出、配置加密、代理展示、订阅/注册合同通过 |
| `npm run test:vue-shell` | 默认开发冷启动 1204、默认 build/file 1203 项通过 |
| `npm run build` | 默认 Vue 全量构建通过；原 logger/tlsClientPool 混合导入提示保留 |
| `git diff --check` | 通过 |

完整 Electron 证据：`C:/Users/AnnaC/AppData/Local/Temp/kam-vue-shell-hFrReM/`。测试不再传 `mode: vue`，直接解析默认 serve/build 配置，并断言 Vue root/input/别名。覆盖全部 15 页、业务弹窗、导航、主题/语言、关闭确认和生命周期；两入口 Renderer、资源和外部请求错误为零，全部监听在卸载后归零。各入口仅保留一条已断言的合成机器码失败诊断。

主代理复核默认构建的深色展开首页与 ASAR 包内浅色折叠首页截图，Logo、暖色 tokens、纵向导航和卡片布局正常；本阶段不改变已经验收的 UI 组件/视觉规格。

## Windows 包与 ASAR 页面

默认构建后执行 `npx electron-builder --win --x64 --dir -p never --config.directories.output=<临时目录>`，Windows x64 unpacked 构建通过。Electron 38.7.2 / electron-builder 25.1.8，未发布，未启动生产可执行程序。

包目录：`C:/Users/AnnaC/AppData/Local/Temp/kam-phase4-package-f1a4429d9d104bdba1143ed35b99637a/win-unpacked/`。

- ASAR 包内含 `out/main/index.js`、`out/preload/index.js` 与 Vue `out/renderer/index.html`；HTML 的两项 `./assets/` 入口资源存在。package main/version 正确。
- 包内排除源码、测试、开发启动器和旧 React/React DOM/Zustand/Tailwind/lucide-react 运行依赖。原生 Koffi 解包目录及额外 TLS DLL 存在。
- 新增 `npm run test:packaged-renderer -- <app.asar绝对路径>`。安装的 Electron 运行离线 main/preload fixture，加载 ASAR 内实际页面；首页、代理页和外壳共 195 项检查通过，Renderer/资源/外部请求错误为零，最终监听释放。代理状态故障由 fixture 合成并作为失败边界测试，不是真实代理故障。
- 证据：`C:/Users/AnnaC/AppData/Local/Temp/kam-vue-packaged-ygjXM1/`，含报告/截图。此路径验证实际打包资源与 file/ASAR 加载，未执行生产主进程、真实账号或网络业务。

## 可恢复归档

清理前将 100 个旧源码文件制成 ZIP，逐文件比对 SHA256，再归档移出工作区。备份：`C:/Users/AnnaC/AppData/Local/Temp/kam-phase4-backup-ed99690ec13a43e391ca397f3ccc0987/`，包含 `react-source.zip`、`inventory.json` 与 `retired/`。ZIP SHA256：`63DB50C12205F2BE7E067FB8FF418609E87F40D0D7402B8093276E95C830F4C5`。先前未提交的 React 品牌/群聊移除修改也在归档中；这是本机临时备份，未上传。

自动审批曾拒绝递归删除；之后采用校验绝对路径的可恢复归档移出方式完成。npm 卸载成功，但旧运行进程锁住的 ignored Tailwind 原生临时目录未被强制删除；manifest/lock 与产物已不引用它。没有终止用户进程。

## 系统和平台验收边界

Phase 4 本机验证限于 Windows x64 解包构建和离线 Electron。随后用户授权发布，三平台 CI 已执行并通过，见下一节；本机仍未执行各平台实际安装/自动更新或生产主进程业务运行。

实际托盘/窗口、账号持久化往返、注册/订阅支付、代理服务、通知送达、机器码/权限、文件写入与证书安装按 [系统清单](vue-phase2-validation.md) 在相应环境验收。测试使用合成数据、临时 userData 和离线 preload，不加载生产主进程/账号，不运行消费额度的 `test:e2e`。

## v1.8.0 合并与发布完成

- 用户授权后，迁移快进合并 master；发布提交 `a69a6a6f17c46ea1f846f742ec1d94223665bc9d`，master、迁移分支和 `v1.8.0` 标签已推送，IDE 文件没有提交。
- package/lock 两级版本和四份 README 首条日志同步 1.8.0，版本更新后的默认 `npm run build`（含主进程/Vue 类型检查）再次通过。
- [Build & Release 36839452848](https://github.com/LingYzh/Kiro-account-manager/actions/runs/36839452848) conclusion=success。Windows x64/ia32/arm64 通用 NSIS、macOS x64/arm64、Linux x64/arm64/armv7l 的依赖安装、构建、打包与产物上传均成功，Release job 成功。
- [v1.8.0 正式 Release](https://github.com/LingYzh/Kiro-account-manager/releases/tag/v1.8.0) 已发布，draft=false、prerelease=false，共 22 个产物，双语日志均为 v1.8.0。
- 发布后读取实际更新清单并核对：`latest.yml` 仅指向 `kiro-account-manager-1.8.0-setup.exe`，Release 只有一个 EXE；`latest-mac.yml` 同时包含 x64/arm64 ZIP 与 DMG；Linux x64/arm64/armv7l 各自清单引用 AppImage/DEB。所有清单 version=1.8.0，引用文件存在、大小与 Release metadata 一致、SHA512 是 64 字节格式；未下载全部安装包重新计算摘要。
- 发布完成不代表实际安装/更新或真实账号/系统业务已经验收，前述边界保持。发布后的文档检查点另行保存于 master，不移动已发布标签。
