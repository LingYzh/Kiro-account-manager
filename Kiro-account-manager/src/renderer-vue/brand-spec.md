# Vue 外壳视觉来源

本阶段沿用已确认的 `@lingyzh/ui@0.2.2` 外观和导航契约。面向桌面账号管理操作，采用 UI 库暖色中性表面、清晰文字层级和紧凑控件，不保留 React 版的 glass/渐变配色。

- 标识：`src/renderer-shared/assets/kam-logo.png`，原样使用用户于 2026-10-01 提供的透明 PNG（1254×1254，奶白圆角底与陶土橙 K），未重绘；浅深主题均保留原色，不使用 filter。Vue 从共享目录加载，桌面/托盘/安装器图标仅转换格式；Phase 4 已归档旧 React 源码。
- 色彩、字体、边框与动效：来自 `node_modules/@lingyzh/ui/src/ui/tokens.css` 和 `styles.css`；应用布局只引用已有 tokens。
- 控件与布局：现有 UiButton/Tabs/TabPanel/Menu/Dialog/Badge/Checkbox/Progress/Card/Host 和 utilities；业务 CSS 只负责窗口、侧栏、内容区域和拖拽。2026-10-01 用户选择纵向 Tabs，保留折叠/展开；导航移除 UiTooltip，折叠图标通过悬停 title 与无障碍名称识别，展开只显示文字。
- 主题：浅色/深色/跟随系统，系统偏好解析为生效 light/dark；遵守 prefers-reduced-motion。
- 深色同样直接复用 UI 库 `:root[data-theme="dark"]`，不维护应用专属色板。2026-10-01 核对正式安装的 0.2.2 与 `D:/UI` 上游 tokens 内容一致：背景 `#262624`、侧栏 `#20201e`、内容表面 `#30302d`、文字 `#f1f0e9`、边框 `#48473f`、强调文字 `#e6a086`。
- 设计取向：导航和操作密度保持，外观改用 UI 库；变体 2/10、动效 2/10、信息密度 7/10、素材依赖 3/10、品牌一致性 8/10。
- 范围：15 个业务页及业务弹窗已完成 Phase 3 迁移，Phase 4 默认使用 Vue。真实 Electron 截图与主代理视觉检查见 `docs/vue-phase2-validation.md`、`docs/vue-phase3-validation.md`；默认入口与安装包检查见 `docs/vue-phase4-validation.md`，实际账号、托盘与系统集成仍需运行验收。
