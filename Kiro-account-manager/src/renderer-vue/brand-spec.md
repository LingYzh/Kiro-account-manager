# Vue 外壳视觉来源

本阶段沿用已确认的 `@lingyzh/ui@0.2.1` 外观，保留 Kiro 标识和导航契约。面向桌面账号管理操作，采用 UI 库暖色中性表面、清晰文字层级和紧凑控件，不保留 React 版的 glass/渐变配色。

- 标识：`src/renderer-shared/assets/Kiro Logo.svg`，直接复制现有 Kiro SVG，未重绘；侧栏通过 `<img>` 引用，深色时沿用反色显示。
- 色彩、字体、边框与动效：来自 `node_modules/@lingyzh/ui/src/ui/tokens.css` 和 `styles.css`；应用布局只引用已有 tokens。
- 控件与布局：现有 UiButton/Tooltip/Menu/Dialog/Badge/Checkbox/Progress/Card/Host 和 utilities；业务 CSS 只负责窗口、侧栏、内容区域和拖拽。
- 主题：浅色/深色/跟随系统，系统偏好解析为生效 light/dark；遵守 prefers-reduced-motion。
- 设计取向：导航和操作密度保持，外观改用 UI 库；变体 2/10、动效 2/10、信息密度 7/10、素材依赖 3/10、品牌一致性 8/10。
- 范围：15 个业务页仍是 Phase 3 占位。未产生产品截图或真实 Electron 视觉验收记录，运行验收由用户执行。
