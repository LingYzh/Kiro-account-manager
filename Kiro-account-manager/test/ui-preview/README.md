# Model identity components

Run from the app directory:

```powershell
node node_modules/vite/bin/vite.js --config test/ui-preview/vite.config.ts
```

Open http://127.0.0.1:5175/. This preview uses synthetic data and the real shared components, without Electron or account access.

Use **Open full dialog / 打开完整弹窗** to inspect the integrated models window. Its model-list and save calls use a local `window.api` mock. Toggle the setting to update the displayed client IDs, or choose **Fail next save / 下次保存失败** before opening the dialog to check the error state.

## Design and visual acceptance (2026-09-29)

- Reuse the existing Card, Switch, Label, Badge and Button components; use background/foreground, muted, border, primary and destructive tokens from globals.css. No new color or font system.
- ID pairs stay fully selectable/copyable and wrap inside the card. The effective client ID follows the switch. Identical IDs show Unchanged.
- Root inspected the rendered light/Chinese and dark/English components before business integration. Long IDs and narrow layout have no horizontal overflow. Async failure leaves the checked state unchanged and shows an error; retry successfully updates the state and effective IDs.
- Preview-only Tailwind sources explicitly include the production renderer components. The initial preview omitted their utilities; this was fixed before acceptance.
- Browser mouse automation did not trigger the preview controls in this session; keyboard activation successfully exercised the actual button/switch handlers. No actual client configuration or proxy state changed during this visual check.
- After acceptance, the components were integrated into ModelsDialog. Root checked the real dialog with mock IPC: toggle changes both effective model IDs and the parent switch state, preserves the source ID, and supports narrow single-column plus 1280px desktop two-column layout with a scrollable body. Full-dialog screenshot: `.Codex/visual-review/model-identity.png` at repository root.
