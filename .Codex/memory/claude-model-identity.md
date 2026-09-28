# Claude Code model identity compatibility — 2026-09-29

## Problem and evidence

Kiro publishes dot version IDs such as `claude-opus-5.5`. Claude Code recognizes Anthropic-style IDs such as `claude-opus-5-5` for model-dependent features. Request conversion already handled modern hyphen versions, but gateway discovery and the client configuration writer still exposed dot IDs.

Official sources: [gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol) and [model configuration](https://code.claude.com/docs/en/model-config). Discovery reads ID/display name/description, not arbitrary capability flags. `_SUPPORTED_CAPABILITIES` does not apply to ANTHROPIC_BASE_URL. Unknown-ID behavior varies by connection method, so claims that all unknown models disable all features are too broad.

## Implemented

- Shared `modelIdentity.ts` translates only known Claude ID syntax to client spellings; keeps dates and existing [1m] markers, without introducing markers, inferring windows, or changing versions. Custom deployment names and non-Claude models remain untouched.
- Public `/v1/models` uses canonical IDs and `display_name`, retains raw `root` and existing schema metadata, deduplicates aliases, and prefers the dot-form catalog entry to match existing inbound resolution. Internal KAM model UI still receives raw IDs.
- Claude Code configuration writer uses canonical selected/default IDs and enables gateway discovery. It preserves existing config/backup behavior and other clients' raw IDs. No real local client settings were edited during verification.
- Saved model rules compare known dot/hyphen spellings interchangeably. Only `*` is wildcard; all regex punctuation is escaped. Existing rule priority/key scope/default effort handling remains unchanged.
- No changes to model reasoning schema policy, strict unsupported semantics, security reviews, or unknown-model routing. [1m] upstream variant resolution remains separate pending work.
- Follow-up user request: View Models now shows upstreamId/clientId pairs using reusable previewed components. A persisted default-on `claudeModelIdMappingEnabled` switch governs discovery and one-click configuration; false restores raw output names, with both inbound spellings still accepted. No proxy restart required. UI waits for save success, displays failures and suppresses stale model-list reads.

## Verification

Offline client configuration checks use a temporary homedir; cover canonical IDs, untouched unknown models/other clients, literal glob syntax, unrelated config and exact backup content. HTTP fixture checks exercise cold and warm Opus 5.5 alias requests, catalog discovery, unchanged upstream model, explicit xhigh, dated IDs, JSON/SSE identity, absent-schema omission, and existing raw-ID mapping rules with canonical requests. Full compatibility suite: 8 unit scripts plus 42 HTTP check groups passed. No real inference or account quota used. Actual Claude Code picker UI still requires testing with the new local app and selected canonical ID.

Additional coverage: switch off/on changes public/internal model names without breaking existing canonical requests; client writer respects false. A review found hidden dot-form fallbacks could overwrite dynamic hyphen-form catalog metadata; fixed with dynamic-source precedence and covered by a collision fixture. Full typecheck/build passed. Component-first visual acceptance and mock IPC dialog checks are recorded in `Kiro-account-manager/test/ui-preview/README.md`; screenshot at `.Codex/visual-review/model-identity.png`.

Trial package: `Kiro-account-manager/dist/gateway-cache-trial-v3/win-unpacked/kiro-account-manager.exe`. Electron Builder completed; main/preload/renderer extracted from app.asar byte-match the current build and contain the mapping switch. Earlier trial directories and running application instances were not replaced or stopped.

User follow-up after trying it: effort selection is visible in their newer Claude Code, while Ultracode is still absent and the auto-mode classifier still stalls. Release notes must keep these open issues explicit. The observed UI outcome supersedes the earlier statement that effort-picker behavior had not yet been tested, but no controlled classifier or Ultracode root-cause trace has been captured.
