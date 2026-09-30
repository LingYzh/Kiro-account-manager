# Phase 1：@lingyzh/ui 补齐 KAM 所需组件（细化方案）

总计划：`C:\Users\ALing\.claude\plans\eager-baking-music.md` 的 Phase 1。UI 仓库 `E:\WebstormProjects\UI`，直接在 `main` 上提交。分两批发布：A 批发布 0.2.0，B 批发布 0.2.1。

## 约束

- 遵守 UI 仓库 `AGENTS.md`。每项改动都要包含：组件、`index.ts` 导出、真实 demo、文档页（`src/ui/docs/content.js`）、`tests/desktop` 回归，以及浅深两套主题的截图验收记录（`VALIDATION.md`）。
- 视觉样式、demo 和视觉验收由主代理（Opus 5.5）亲自完成，子代理不写视觉样式。
- 默认值必须保持 UAH 现有行为不变：新属性都是可选的；locale 默认 `zh`，文案逐字不变。
- 目标运行环境最低为 Chromium 140（KAM 使用 Electron 38.7.2）。UI 仓库的测试跑在 Electron 44 / Chromium 152 上，所以不能用 140 之后才出现的特性。允许使用：Popover API、CSS anchor positioning（`position-anchor` / `position-area` / `position-try-fallbacks`）、`@starting-style`、`color-mix()`、原生 `<dialog>`。
- 样式只引用现有 tokens，不新增色相 token。四空格缩进。依赖精确版本，不新增运行时依赖。
- 提交格式：标题、空行、`- 文件: 改动` 要点、空行、`Co-Authored-By: cc`。push 与 npm publish 前需要单独向用户确认。

## 分工

- 主代理：组件 SFC 与 CSS、demo 与文档内容、视觉验收，以及逐项评审。
- `kam-logic`（xhigh）：把 locale 接入现有组件（非视觉改动，涉及多个文件），编写单元测试和各组件的 Playwright 桌面测试脚本。
- `kam-explore`（medium）：每一批的 diff 评审。
- 子代理提示继续遵守“超过 800 行只 Grep/分段 Read、单一主题、限定输出”的规定。

## A 批：0.2.0（P0）

### A1 组件盘点记录
在 `VALIDATION.md` 新增“2026-09-30 KAM 组件盘点”一节，写入本方案的复用项与缺口，然后再开始实现（按 UI 仓库流程）。

### A2 locale 机制
- 新增 `src/ui/locale.ts`：`setLocale(locale: 'zh' | 'en')`，以及组件内部使用的 `useUiText()`，返回 `t(key, params?)`，响应式。`zh`、`en` 两张表的键类型保持一致。`index.ts` 导出 `setLocale`、`getLocale`、`UiLocale`。
- 接入范围包括所有写死的中文：
    - UiDialog 的 contentLabel
    - UiTable（暂无数据、正在加载、排序、滚动区域）
    - UiPagination
    - UiDataTableServer
    - UiCodeBlock 复制与换行相关的全部文案
    - UiSelect 的“可选项”
    - UiSnackbarHost 的“关闭通知”
    - UiUsageMeter、UiDiff、UiFileChanges、UiMarkdown、UiMarkdownDiagram
    - line-diff
    - 本批新增组件的文案

    其中有中文默认值的 prop 要改成 `undefined`，由 `t()` 回退。
- 验收：
    - 单元测试 `tests/locale.test.ts` 覆盖键完整性（en 与 zh 的键集合相同）和切换。
    - 文档新增“国际化”指南页，页内 demo 可以切换中英，同时展示 Pagination、Table、Dialog 的文案变化。
    - 文档站本身仍为中文。

### A3 utilities.css 扩展
命名沿用现有的 Vuetify 风格：

- 字号：`text-caption`（11px）、`text-body-2`（12px）、`text-body-1`（13px）、`text-subtitle`（14px/500）、`text-title`（16px/600）
- 字重：`font-weight-regular`、`font-weight-medium`、`font-weight-semibold`
- 字体：`font-mono`
- 文本处理：`text-truncate`、`text-no-wrap`、`text-break`
- 语义色：`text-faint`、`text-accent`、`text-success`、`text-warning`、`text-error`
- 定位：`position-relative`、`position-absolute`、`position-sticky`、`inset-0`
- 网格：`grid-cols-1` … `grid-cols-4`、`col-span-2`
- 滚动：`overflow-x-auto`、`overflow-y-auto`
- 其他：`cursor-pointer`、`w-auto`、`flex-1-1`（`flex: 1 1 0`，`min-width: 0`）

不引入小数间距、颜色背景类，也不引入 hover 状态类，这些由组件 variant 负责。文档 utilities 页同步更新。

### A4 UiButton `variant="danger"`
- 视觉：危险色是 `--red`，与 `--accent` 很接近，填充态会和 primary 撞色，所以采用表面底色加红色文字，hover 时叠加红色弱底和红色边框，focus 轮廓用红色。
- 与 `ghost`、`dense`、`rounded`、`loading` 可组合。
- KAM 的 destructive（11 处）映射为 danger。

### A5 UiDialog 宽度与抽屉
- `size`：`'sm' | 'md' | 'lg' | 'xl' | 'full'`，对应 420、560、720、960px、`calc(100vw - 40px)`。
    - 未传时保持现状：非 scrollable 按内容宽度，scrollable 为 680px。
    - KAM 的 max-w-md/lg/2xl 以及 800–900px 的宽度映射到 sm/md/lg/xl，1200px 映射到 full。
- `placement`：`'center' | 'end'`，默认 `center`。
    - `end` 为右侧整高抽屉，圆角只保留内侧，进场为从右侧平移加淡入（180/140ms）。
    - 抽屉未传 size 时宽度为 sm，供 TaskCenter 使用。
- 焦点约束、Esc 关闭、遮罩关闭、closed/present-change 的生命周期与现有行为一致。在减少动效模式下关闭进退场动画。

### A6 UiInput 数字模式
- `type="number"` 时 v-model 输出 `number`；输入为空时输出 `null`。min、max、step 原样透传。
- 其他 type 的行为不变。KAM 共有 38 处数字输入。

### A7 UiBadge
- 属性：
    - `tone`：`neutral`、`accent`、`success`、`warning`、`error`，默认 neutral
    - `variant`：`soft`（默认）或 `outline`
    - `color`：任意 CSS 颜色，用于用户自定义标签。弱底、边框和文字都用 `color-mix` 按主题自适应。
    - `dense`
    - `closable` 与 `close` 事件；关闭按钮有可访问名称，文案来自 locale
- 视觉：高 20px（dense 为 18px），11px/500，圆角 6px，图标插槽间距 4px。
- KAM 用量：97 处。订阅类型和状态的配色在 Phase 3 映射到 tone。

### A8 UiAlert
- 属性：`tone` 为 `info`、`success`、`warning`、`error`；`title`；插槽有 default、`actions`、`icon`。
- 视觉：
    - 使用各 tone 的 `--*-background` 弱底，边框是 tone 与 border 的混色，圆角 10px。
    - 左侧状态标记与 snackbar 保持一致。
    - info 使用 soft 表面加 muted 标记。
- 语义：error 为 `role="alert"`，其余为 `role="status"`。
- KAM 用量：54 处彩色提示条。

### A9 UiSpinner
- `size`（px，默认 16）；使用 currentColor 的环形与弧线。
- 传 `label` 时为 `role="status"` 加名称，否则 `aria-hidden`。
- 减少动效时仍然旋转，但转速降为 1.6s 一圈；旋转属于必要的状态指示。
- 不自动插入 UiButton 的 loading 态，以保持 UAH 行为；业务在按钮插槽里自行放置。与总计划不同：总计划原写“复用同一视觉”，这里改为不自动接入。
- KAM 用量：Loader2 共 51 处。

### A10 UiMenu 与 UiMenuItem
- UiMenu：
    - `v-model:open`
    - `placement`：`bottom-start`、`bottom-end`、`top-start`、`top-end`
    - `panel`，布尔值
    - 插槽：`activator`（提供 `{ props }`，包含 aria-haspopup、aria-expanded、aria-controls 与 onClick）和 default
    - `ref` 暴露 `close()`
    - 实现：用 `popover="auto"`，由浏览器原生处理点击外部关闭、Esc 关闭和顶层渲染，因此不会被滚动容器或弹窗裁切；用 CSS anchor positioning 定位，并用 flip 回退处理贴边。
    - 焦点：打开后聚焦第一项；关闭后焦点回到触发器。
- 两种模式：
    - 菜单模式（默认）：`role="menu"`，↑↓ 在菜单项之间移动，Home/End 跳到首尾，选择后关闭。
    - `panel` 模式：`role="dialog"`，内容自由，例如筛选表单，按 Tab 自然切换，只在 Esc 或点外部时关闭。
- UiMenuItem：
    - `checked?: boolean`：传入时为 `menuitemcheckbox` 并显示勾选
    - `disabled`
    - `danger`
    - `keep-open`：多选标签时不关闭
    - `click` 事件
- 视觉：
    - 面板：surface 底、border、圆角 10px、`--shadow`、内边距 5px，最小宽 180px，最大高 `min(420px, 70vh)`，内部滚动。
    - 进场与 select picker 一致：透明度加 -3px 位移，140ms。
    - 菜单项：高 32px，12px 字号，圆角 6px，hover 为 `--hover`，勾选标记用 accent-text。
- KAM 用量：AccountToolbar 的 4 个浮层、注册模板菜单、日志筛选。

### A11 confirmDialog 与 UiConfirmHost
- `confirmDialog({ title, message, confirmText?, cancelText?, tone?: 'default' | 'danger' }) => Promise<boolean>`。
- 根组件挂载一次 `UiConfirmHost`，与 snackbar 相同的服务模式；多次调用时排队依次显示。
- 在 UiDialog 的 `closed` 之后才 resolve，此时焦点已经恢复，调用方可以接着显示 snackbar，符合现有生命周期约定。
- Host 卸载时，待处理的调用 resolve 为 false。
- 用 UiDialog size=sm；danger 时确认按钮用 danger variant；打开时默认焦点在取消按钮上。
- 单元测试覆盖排队、resolve 与卸载。
- KAM 用量：`window.confirm` 共 36 处。

### A12 批次验收与发布
1. 在 UI 仓库执行 `npm run typecheck`、`npm test`、`npm run build`、`npm run test:ui`（需覆盖所有文档路由），以及各组件的专项桌面测试。
2. 专项测试要截浅色和深色图，窗口为 900×800、缩放 125%；主代理直接查看截图，把验收结果写入 VALIDATION.md。
3. TS 5.9 兼容检查：用 KAM 的 TypeScript 5.9.3 和 vue-tsc 3.3.11，建一个临时 tsconfig 指向 `UI/src/ui/index.ts` 做类型检查。临时文件放在系统临时目录，不改 UI 的配置。
4. 更新 README 组件契约表、HANDOFF.md 和 `.Codex/memory`；执行 `npm pack --dry-run --json` 核对文件清单；把版本号改为 0.2.0 并提交。
5. 用户确认后，执行 `npm publish`、打 tag `v0.2.0`，并 push main 与 tag。
6. KAM 侧升级 `@lingyzh/ui@0.2.0`，lockfile 必须来自 registry，然后执行 `typecheck:vue`。

## B 批：0.2.1（P1/P2）

- **UiCheckbox**：
    - boolean v-model；支持 `indeterminate`、`disabled`；default 插槽作为标签。
    - 使用原生 checkbox：16px 方框，圆角 4px；选中时 accent 填充加白色勾（mask SVG）；半选状态显示为横条。
    - KAM 用于全选和批量勾选。
- **UiRadio**：
    - 单个原生 radio：`v-model` 加 `value`，`name` 透传，default 插槽作为标签；16px 圆形，选中为 accent 圆点。
    - 与总计划不同：原计划写的是 UiRadioGroup。KAM 唯一的用法是每张路由卡片里各放一个 radio，分组列表放不进这个布局，所以只提供单个 radio。
- **UiProgress**：
    - `value`、`max=100`；`tone` 为 `accent`、`success`、`warning`、`error`；支持 `dense`（4px，默认 6px）；`label` 作为可访问名称。
    - 带 `role="progressbar"` 与 valuenow/min/max；宽度过渡 240ms。
    - 阈值配色由调用方计算。
- **UiCopyButton**：
    - 属性：`text`，以及 `label` / `copied-label`（默认值来自 locale）。
    - 基于 UiButton（ghost、icon、sm）和 UiTooltip；复制通过 `writeClipboard`，成功后 1.6 秒内显示为勾选（success 色），并用 aria-live 播报。
    - 失败时发出 `error` 事件。
    - KAM 中复制反馈共 107 处，分布在 12 个文件。
- **UiColorSwatches**：
    - 属性：`colors: { value: string; label: string }[]`，默认使用库内与 tokens 协调的 10 色色板（颜色名来自 locale）；`v-model` 为 CSS 颜色字符串。
    - 使用原生 radio 组：方向键切换，`aria-label` 为颜色名。
    - 当前值不在色板里时，额外显示一个“当前颜色”色块，用于兼容旧的自定义颜色。
    - 色块 22px 圆形；选中时显示 2px surface 间隔加 2px text 描边。
    - KAM 负责 ARGB 与 CSS 颜色之间的转换。
- 验收与发布流程同 A12，版本 0.2.1。

## 待确认

- 以上两处偏离总计划（Spinner 不自动接入 UiButton、UiRadioGroup 改为 UiRadio）。
- 视觉取舍（danger 不填充、不新增蓝/紫色相、工具类命名）由主代理决定，这里只作说明。
