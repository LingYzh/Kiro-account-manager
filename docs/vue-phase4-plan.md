# Vue Phase 4：默认入口与旧渲染层清理

日期：2026-10-01。用户在 Phase 3 离线验收后明确要求开始 Phase 4；据此执行切换与清理，真实账号和系统集成仍按运行清单单独验收，不记为已通过。

## 已定范围

- 保留 `src/renderer-vue/`、`src/renderer-shared/` 路径，electron-vite 所有模式默认使用 Vue；产物仍为 `out/renderer/`，主进程、preload 和协议行为不变。
- `dev/build/typecheck:web` 默认指向 Vue。`dev:vue/build:vue/typecheck:vue` 保留为兼容脚本；Node 启动器在 Windows 交互控制台保留 UTF-8，其他平台和管道使用原生 Node/Vite 调用。
- 将旧 `src/renderer/`、React store 测试 wrapper 和两套仅手动运行的 React 预览归档移出工作区。归档前保存源码快照并逐文件校验哈希。Vue Electron 回归替代模型身份和客户端 UI 预览，`compat-desktop-config` 继续验证真实服务的临时目录合同。
- 五组原账号特征断言保留，由真实 Pinia store 执行；shared、runtime、六类 Phase 3 合同和 HTTP 回归均保留。
- 按引用移除 React/Zustand/Tailwind/framer-motion、React 图标/虚拟列表、CVA/clsx/tailwind-merge 及对应类型、构建/lint 插件。保留 Vue、UI 库、主进程网络和原生模块。
- README 中的群聊联络图片移到 `resources/community-qr.png`，应用仍无群聊按钮。品牌、头像和产品图标保留。更新调试路径、类型/lint、打包源码排除、两份 README、AGENTS、HANDOFF 与项目记忆。

## 验收

- 类型检查、定向 lint、完整 compat、六类合同、默认入口 Electron 开发冷启动及 build/file 完整回归。
- 默认 `npm run build` 构建 Vue，并检查预加载、相对资源、所有发行脚本和 CI 的构建入口。
- 在本 Windows 设备生成不发布的 x64 unpacked 包，检查 ASAR 内容、资源和旧依赖排除；尽可能通过离线 preload 加载包内真实页面。不启动生产主进程或读取用户账号。
- macOS/Linux 原生包、NSIS 三架构安装器及自动更新实机行为留给对应平台 CI/系统验收；保持现有 Windows universal NSIS 和 latest.yml 契约。

版本保持 1.7.9，不提交/推送或发布；保留原有 IDE 工作区和图标改动。本会话继续均衡编排，用 GPT-6 Sol medium 替代 Terra，root 负责决策和验收。

后续授权：用户要求合并 master 并发布新版本，发布版本定为 1.8.0，按现有标签与多平台 CI 流程执行；以上保留 Phase 4 实施时的范围，实机业务验收边界继续有效。
