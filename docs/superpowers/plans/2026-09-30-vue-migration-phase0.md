# Phase 0：Vue 迁移脚手架（任务计划）

来源：会话总计划 `C:\Users\ALing\.claude\plans\eager-baking-music.md` 的 Phase 0。分支 `feat/vue-migration`，基线提交 `3d3af9b`。

## Global Constraints

- 应用目录 `Kiro-account-manager/`（仓库根的子目录）；所有 npm 命令在该目录执行。
- 不改变 React 版任何运行行为；`npm run typecheck`、`npm run build`、`npm run test:compat` 必须保持通过。
- 新增与修改代码使用四空格缩进；不对未改动代码批量格式化。被移动的文件只改 import 路径、不改缩进与内容（保持 `git mv` 可追踪）。
- 依赖一律精确版本（package.json 不带 `^`/`~`），写入 package-lock.json；不得出现 `file:` 依赖。
- 不运行 `test:e2e`（消耗额度）；不启动 dev server、不做浏览器验证。
- 提交格式：标题行 → 空行 → `- 文件: 改动` 要点列表 → 空行 → `Co-Authored-By: cc`。只 `git add` 本任务相关文件，不提交 `.idea/`。不 push。
- 超过 800 行的文件只能 Grep 定位或分段 Read（offset/limit），禁止整读。
- 代码需添加必要注释；不做过度抽象；只处理真实场景。

## Task 1: 安装 Vue 工具链依赖

在 `Kiro-account-manager/` 执行，全部精确版本：

- dependencies：`pinia@4.0.3`、`lucide-vue-next@0.555.0`、`@tanstack/vue-virtual@3.13.12`
- devDependencies：`@vitejs/plugin-vue@6.0.9`、`vue-tsc@3.3.11`、`eslint-plugin-vue@10.11.1`、`vue-eslint-parser`（用 `npm view vue-eslint-parser version` 取满足 eslint-plugin-vue 10.11.1 peer `^10.3.0` 的最新版本并精确锁定）

要求：

- 使用 `npm install --save-exact`；安装会触发 `postinstall`（electron-builder install-app-deps），属正常。
- 安装后 `npm ls pinia vue @vitejs/plugin-vue vue-tsc eslint-plugin-vue vue-eslint-parser lucide-vue-next @tanstack/vue-virtual` 无 `invalid`/`UNMET PEER` 报错；vue 只存在 3.5.43 一份。
- `npm run typecheck` 通过。
- 提交：package.json、package-lock.json。

## Task 2: electron-vite 双渲染入口与 Vue 最小壳

目标：`--mode vue` 时 renderer 使用新目录 `src/renderer-vue/`，默认模式与现状完全一致；两种模式产物都在 `out/renderer/index.html`（`src/main/index.ts:2379-2382` 不改）。

已核实的 electron-vite 4.0.1 行为（`node_modules/electron-vite/dist/chunks/lib-ClgyQuZx.js`）：

- 默认 `config.root = './src/renderer'`；`build.outDir` 默认 `path.resolve(项目根, 'out', 'renderer')`，与 root 无关。
- 默认 `rollupOptions.input = findInput(项目根)`，固定查找 `<项目根>/src/renderer/index.html`。**因此 vue 模式必须显式设置 `build.rollupOptions.input` 为 `src/renderer-vue/index.html`**，否则会打包 React 入口。
- `defineConfig` 支持函数形式 `(env: ConfigEnv) => config`，`env.mode` 取自 `--mode`。

改动：

1. `electron.vite.config.ts` 改为 `defineConfig(({ mode }) => ({...}))`。main、preload 保持原样；renderer 按 `mode === 'vue'` 分支：
   - vue：`root: resolve('src/renderer-vue')`；`build.rollupOptions.input: resolve('src/renderer-vue/index.html')`；`resolve.alias` 的 `@renderer` 与 `@` 均指向 `resolve('src/renderer-vue/src')`，另加 `@shared` 指向 `resolve('src/renderer-shared')`；`resolve.dedupe: ['vue']`；`plugins: [vue()]`（`import vue from '@vitejs/plugin-vue'`）。
   - 默认：与现有 renderer 配置逐字一致（alias `@renderer`/`@` → `src/renderer/src`，plugins `[react(), tailwindcss()]`），另加同样的 `@shared` alias。
   - 该文件是修改的已有文件，按全局约束统一为四空格缩进。
2. 新建 `src/renderer-vue/index.html`：沿用 `src/renderer/index.html` 的 CSP meta 与 `<title>Kiro</title>`，挂载点 `<div id="app"></div>`，入口 `<script type="module" src="/src/main.js"></script>`。
3. 新建 `src/renderer-vue/src/main.js`：`createApp(App).use(createPinia()).mount('#app')`，并 `import '@lingyzh/ui/styles.css'`。
4. 新建 `src/renderer-vue/src/App.vue`（`<script setup>` JS）：只渲染一个 `UiCard`（从 `@lingyzh/ui` 导入），标题为 "Kiro Account Manager"，正文一句说明这是 Vue 迁移中的渲染层；不接任何业务。用于验证 UI 库源码可被编译。
5. 新建 `src/renderer-vue/src/env.d.ts`：`/// <reference types="vite/client" />` 与 `declare module '*.vue'` 的标准 shim。
6. `package.json` scripts 增加：
   - `"dev:vue": "chcp 65001 >nul && electron-vite dev --mode vue"`（与现有 dev 相同的代码页前缀）
   - `"build:vue": "electron-vite build --mode vue"`

验收：

- `npm run build:vue` 成功，`out/renderer/index.html` 存在且其引用的 JS 来自 Vue 入口（grep 产物含 `createApp` 或 `ui-card` 类名，而不含 React 的 `createRoot`）。
- 随后 `npm run build` 成功，`out/renderer/index.html` 回到 React 入口（产物含 `createRoot`）。
- `npm run typecheck` 通过。
- 报告中写明两次构建的产物检查命令与结果。

## Task 3: Vue 类型检查、Prettier 与 ESLint 接入

1. 新建 `tsconfig.vue.json`：
   - `extends: "@electron-toolkit/tsconfig/tsconfig.web.json"`
   - `compilerOptions`：`allowJs: true`、`checkJs: false`、`jsx: "preserve"`、`types: ["vite/client"]`、`baseUrl: "."`、`paths`：`@/*` 与 `@renderer/*` → `src/renderer-vue/src/*`，`@shared/*` → `src/renderer-shared/*`
   - `include`：`src/renderer-vue/src/**/*.ts`、`src/renderer-vue/src/**/*.vue`、`src/renderer-vue/src/**/*.js`、`src/renderer-shared/**/*.ts`、`src/preload/*.d.ts`
2. `package.json` scripts 增加 `"typecheck:vue": "vue-tsc --noEmit -p tsconfig.vue.json"`；不改现有 `typecheck`/`build` 脚本。
3. 运行 `npm run typecheck:vue`。**若报错全部来自 `node_modules/@lingyzh/ui/**`（库源码在 TS 5.9.3 下的问题）**：不得在 KAM 侧用 `skipLibCheck` 以外的手段屏蔽，也不得修改 node_modules；把完整错误清单写入报告，状态报 DONE_WITH_CONCERNS，由主代理在 Phase 1 让 UI 库发布类型声明。若报错来自 KAM 自身文件，修复之。
4. `.prettierrc.yaml` 增加 `overrides`：`files: 'src/renderer-vue/**'` 与 `files: 'src/renderer-shared/**'` 的 `tabWidth: 4`；其余配置不变。
5. `eslint.config.mjs` 增加一个仅作用于 `src/renderer-vue/**/*.{js,vue}` 的配置块：`eslint-plugin-vue` 的 flat `recommended` 规则，`.vue` 文件 parser 用 `vue-eslint-parser`（`parserOptions.parser` 用现有 typescript-eslint parser，`sourceType: 'module'`）。React 相关配置块不得作用于 renderer-vue；`vue/html-indent` 设为 4。
6. 运行 `npx eslint src/renderer-vue` 无错误；`npm run typecheck` 通过。

## Task 4: 抽取共享纯函数模块 src/renderer-shared/

目标：Vue 版与 React 版共用同一份框架无关代码。React 侧通过 `@shared/*` 引用，行为零变化。

1. `tsconfig.web.json` 的 `paths` 增加 `"@shared/*": ["src/renderer-shared/*"]`，`include` 增加 `"src/renderer-shared/**/*"`。
2. 用 `git mv` 移动（内容不改，只改其内部 import）：
   - `src/renderer/src/types/{account,proxy,machineId}.ts` → `src/renderer-shared/types/`
   - `src/renderer/src/i18n/locales/{en,zh}.ts` → `src/renderer-shared/i18n/locales/`
   - `src/renderer/src/lib/dotVariants.ts` → `src/renderer-shared/lib/dotVariants.ts`
   - `src/renderer/src/store/rateLimiter.ts` → `src/renderer-shared/lib/rateLimiter.ts`
3. `src/renderer/src/lib/utils.ts`：`cn()` 保留在原文件；其余纯函数（`formatBytes`、`formatDate`、`formatPercentage`、`generatePKCE`、`generateState`、`splitCredentialLine` 及其私有辅助函数）移到 `src/renderer-shared/lib/utils.ts`，原文件改为 `export { ... } from '@shared/lib/utils'` 重导出，保证现有 28+ 处 `@/lib/utils` 引用不变。
4. `src/renderer/src/components/accounts/_helpers.ts`：不依赖 React 的纯函数与常量（`toRgba`、`getSubscriptionColor`、`StatusLabelsZh`、`StatusLabelsEn`、`getStatusBadgeClass`、`getDisplayName`、`formatTokenExpiry`、`isBannedError`、`formatDateSafe`）移到 `src/renderer-shared/lib/accountHelpers.ts`；返回 `CSSProperties` 的函数与样式常量（`generateGlowStyle`、`generateRowGlowStyle`、`unauthorizedCardStyle`、`unauthorizedRowStyle`）留在原文件；原文件重导出移走的符号，现有引用不变。
5. `src/renderer/src/store/webhooks.ts`：把 `buildTelegramUrl`、`buildWebhookBody`、`escapeJsonString` 及其所需类型/常量移到 `src/renderer-shared/lib/webhookPayload.ts` 并导出；webhooks.ts 从该模块导入，`sendWebhook` 的 fetch 与限速逻辑不动。
6. 更新所有受影响的 import：原先 `@/types/*`、`../types/*`、`../../types/*`、`@/i18n/locales/*`、`@/lib/dotVariants`、`./rateLimiter` 等路径改为 `@shared/...`。用 Grep 全量核对无遗漏。
7. 共享目录内的文件只能 import 共享目录自身或第三方纯库，禁止 import `src/renderer/**`、react、zustand、tailwind 相关包；报告中用 Grep 结果证明。
8. 验收：`npm run typecheck` 通过；`npm run build` 通过；`npm run test:compat` 通过。

## Task 5: 特征测试——纯函数模块

新建 `test/renderer-shared.mjs`，写法沿用 `test/compat-capabilities.mjs`（esbuild 打包到临时目录后 import，`node:assert/strict`，结束清理临时目录）。目标是锁定**现有**行为（characterization），断言值以运行现有实现得到的真实结果为准，不改被测代码。

覆盖：

- `@shared/lib/dotVariants`：`splitEmail`（合法/非法）、`normalizeEmail`（点号与大小写）、`binomial` 边界、`totalVariantCount`（含 maxDot）、`countSameRootVariants`、`generateNextDotVariant`（本地部分 1 字符、已用尽、黑名单/已用过滤各至少一例）。
- `@shared/lib/rateLimiter`：`createRateLimiter` 的 `snapshot` 初值、`reportResult` 连续失败后的退避字段、`reset`、`updateConfig`；涉及时间的断言用可控的时间源或极短窗口，测试总时长 < 3 秒。
- `@shared/lib/webhookPayload`：每种 IM 类型（按源码中的类型枚举逐个）各一例消息体结构；`buildTelegramUrl`；`escapeJsonString` 对引号、换行、反斜杠。
- `@shared/lib/utils`：`splitCredentialLine` 三种分隔符与 JWT 尾部连续 `-` 的边界；`formatBytes`；`formatPercentage`。
- `@shared/lib/accountHelpers`：`getDisplayName`、`isBannedError`、`formatDateSafe`、`toRgba`。

esbuild 需配置 alias `@shared` → `src/renderer-shared`。`package.json` 的 `test:compat` 末尾追加 `&& node test/renderer-shared.mjs`。验收：`node test/renderer-shared.mjs` 通过且输出干净；`npm run test:compat` 通过。

## Task 6: 特征测试——accounts store 行为

新建 `test/renderer-accounts-store.mjs`，esbuild 打包 `src/renderer/src/store/accounts.ts`（alias `@` → `src/renderer/src`、`@shared` → `src/renderer-shared`），锁定 React 版 store 行为，作为 Pinia 版的验收基线。不修改 store 源码。

运行环境 mock（在动态 import 打包产物之前挂到 `globalThis`）：

- `window`：`{ api: { ... } }`，其中 `loadAccounts` 返回测试构造的持久化文档，`saveAccounts` 记录每次调用的入参；其余 store 在被测路径上会调用的 api（如 `getAppVersion`、`setProxy`、`updateTrayLanguage`、`getProactiveRenewalEnabled` 等）返回合理的 resolved 值。
- `localStorage`：Map 实现的 getItem/setItem/removeItem。
- `document.documentElement.classList`：记录 add/remove 的最小桩。
- 用 fake timers 或将等待控制在防抖窗口内；测试结束前清理 store 内启动的定时器（调用 store 自身的 stop 类 action），保证进程正常退出。

覆盖：

1. 持久化往返：构造包含 `AccountData`（见 `src/preload/index.d.ts`）全部字段的文档，其中 `theme: 'purple'`、`darkMode: true`、proxyPool 两条；`loadFromStorage()` 后 `flushSaveImmediately()`，断言 `saveAccounts` 收到的文档与输入在这些字段上深度相等（含 `theme` 原样透传），并记录输出中存在、输入中没有的字段（如 loader 补默认值的字段）作为基线。
2. 保存时序：连续多次 `saveToStorage()` 在 500ms 防抖窗口内只触发一次 `saveAccounts`；持续调用时 5s 上限内至少落盘一次（可用 fake timers）。
3. 筛选、排序、统计：构造 5–8 个账号（不同分组、标签、订阅类型、状态、用量），覆盖 `setFilter`（分组、标签、搜索词、状态至少各一例）、`setSort`（两个字段 × 升降序）、`getFilteredAccounts` 结果顺序、`getStats` 各计数。
4. 导入导出：`exportAccounts()` 后 `importFromExportData()` 到一个清空后的 store，账号数与关键字段一致；`importAccounts` 对重复账号的跳过计数。
5. 代理池：`importProxies` 的 added/skipped/failed 计数；`setProxyPoolConfig` 切换源码中支持的每种轮换策略后连续调用 `pickNextProxy` 的选取序列；`reportProxyResult` 失败后对选取的影响。

`test:compat` 末尾追加 `&& node test/renderer-accounts-store.mjs`。若某项行为依赖难以隔离的副作用（例如必须真实网络），跳过该子项并在报告中说明，不修改源码。验收：新测试通过且输出干净（store 自身的 console 日志可在测试中静默）；`npm run test:compat` 通过。

## Task 7: 更新项目记录

- `AGENTS.md` 的“构建与验证”增加 `dev:vue`、`build:vue`、`typecheck:vue` 说明；“架构”增加 `src/renderer-shared/`（两版共享的框架无关模块，`@shared/*` 别名）与 `src/renderer-vue/`。
- `.Codex/memory/vue-migration.md` 增加 Phase 0 结果：electron-vite vue 模式必须显式 `rollupOptions.input`（默认入口固定为 `src/renderer/index.html`）、共享目录约束、特征测试文件与运行方式、Task 3 中 UI 库类型检查的结论。
- 验收：文档与实际配置一致；提交。
