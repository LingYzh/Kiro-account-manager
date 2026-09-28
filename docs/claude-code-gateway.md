# Claude Code through KAM

KAM accepts Anthropic Messages requests and converts them to Kiro GenerateAssistantResponse. It is an adapter between different protocols; it does not implement every Anthropic capability.

## Client configuration

Use KAM's client configuration action to write the gateway URL, key, and Claude Code model settings. It now writes Anthropic-style model IDs, for example `claude-opus-5-5`, and enables gateway model discovery. Existing settings are backed up before writing; other clients keep their existing model ID convention. For Claude Code, these additional environment settings are recommended:

```powershell
$env:CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
$env:CLAUDE_CODE_GATEWAY_HINT_HEADERS = '1'
```

The first setting omits attribution at the client because KAM must reshape system blocks into Kiro history. The second supplies routing and compaction hints on a custom base URL. See the [official gateway compatibility guide](https://code.claude.com/docs/en/llm-gateway-protocol).

**Session affinity** defaults to enabled when no setting has been saved, so a healthy account can be reused across turns. An explicitly saved `false` is respected; enable it in KAM's proxy security settings to opt in. A failover changes the account and may lose that account's warm cache. Keep the same model, system instructions, tool definitions, and account when comparing cache behavior.

## Model identity and effort

With **Claude Code model name compatibility** enabled (the default), `GET /v1/models` publishes recognized Claude version spellings with hyphens (`claude-opus-5-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`) and a `display_name`. The original Kiro ID remains in `root`; incoming canonical and original dot IDs both resolve through the existing account-scoped catalog. KAM's own model selection UI continues using Kiro IDs. Non-Claude IDs and custom deployment names are unchanged. Saved model mapping rules match either spelling; only `*` is a wildcard, so dots and `[1m]` are literal.

In **View Models**, every card shows the upstream source ID and effective client ID with copy buttons. The compatibility switch is saved as `claudeModelIdMappingEnabled` and applies immediately to new model-list requests and subsequent one-click Claude Code configuration. Turning it off restores original IDs on those outputs. Both request spellings remain accepted, and custom routing rules remain independent. A disabled value stays disabled when saved configuration is reloaded.

For an existing manual setup, enable `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`, restart Claude Code to refresh its discovered list, and select `/model claude-opus-5-5` (when that model is available). Update any host-managed model selection too: an already selected dot ID is not changed remotely by the gateway. On desktop hosts, that host's model configuration may take precedence over local Claude Code settings.

Claude Code's capability detection depends on the selected ID and client version. Its discovery reader uses `id`, `display_name`, and `description`, not KAM's extra capability metadata. The `_SUPPORTED_CAPABILITIES` variables do not affect an `ANTHROPIC_BASE_URL` gateway; KAM does not write them. See the official [gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol#model-discovery) and [model configuration](https://code.claude.com/docs/en/model-config#override-model-ids-per-version).

The naming change does not create upstream capabilities. Explicit effort such as `xhigh` is retained when the account's model schema supports it; optional reasoning remains omitted for unsupported or unknown schemas under the existing policy. This change does not claim to implement server-side review, or resolve `[1m]` to a distinct Kiro context variant. Client workflow modes remain governed by Claude Code's own availability rules.

## Known client limitations (v1.7.8)

The user confirmed that Claude Code now offers effort levels for the mapped model ID. Ultracode is still absent, and automatic-mode safety classification still stalls. Their causes have not been established by a correlated request trace. These are open issues, not release fixes. KAM continues to return explicit errors for safety-review fields it cannot honor; a successful inference response must not be interpreted as a safety verdict.

## Context and routing

- Neither the Claude nor OpenAI adapter adds a current-time prompt. User-configured steering still applies.
- Top-level Claude system text blocks retain their order and individual cache checkpoints. Each nonempty block uses a Kiro user/assistant pair. This representation cannot guarantee native Anthropic system priority.
- Mid-conversation system instructions remain at their original point in the conversation. Tool IDs, results, and error status retain the existing pairing behavior.
- Requests identified by Claude Code headers or its user agent preserve history even when proxy trimming is enabled. Claude Code owns compaction. Other clients still follow the explicit trimming setting; inline system messages always protect history.
- The gateway captures `anthropic-*` and `x-claude-code-*` headers without a beta allowlist. Kiro receives its own supported wire schema, not arbitrary Anthropic headers or fields.
- Conversation identity includes the full API-key ID, session, agent, and request class. Main turns stay stable across prompt IDs. Compaction and auxiliary calls use separate identities; a completed compaction does not randomly rotate the main identity. Parent-agent and prompt IDs do not overwrite a child's identity.

## Capability boundaries

Unsupported execution constraints return HTTP 400 with the affected field before any inference request: nonempty server-side context-management edits, structured-output format, task budget, forced tool choice, disabled parallel tools, strict/deferred tool definitions, server-side tool types, unsupported content-block types, stop sequences, safeguards, and server-side MCP connections. Empty context-management configuration and supported reasoning effort remain accepted. An advisor rejection preserves the `Input tag 'advisor_...'` form needed by clients that support recovery.

Unknown request extensions survive the ingress copy. Acceptance does not mean an unknown field is implemented by Kiro. Model reasoning fields still follow the account's advertised model schema, including the existing unsupported/unknown behavior.

Cache TTL, top-level automatic caching, and internal block checkpoints have no proven equivalent in this Kiro schema. They produce `x-kiro-compatibility` diagnostics instead of a false promise. A checkpoint inside a flattened message, or before another merged user/system message, is omitted rather than moved after a changing suffix. Final message checkpoints and separate system-block checkpoints can be represented. Thinking history remains unsupported by this Generate endpoint and is reported as a degradation; returned thinking still works.

## Measuring cache behavior

Claude JSON and SSE responses use upstream cache telemetry only. Missing cache counters remain absent; a reported zero stays zero. Local prompt similarity no longer creates a reported hit. Anthropic `input_tokens` excludes the reported cache-read and cache-write portions of Kiro's total input, so clients do not count them twice.

`tokenUsage` supplies token and cache counters. Numeric `meteringEvent.usage` supplies credits, not cache tokens. Without upstream cache counters, absence of a reported hit is not proof of a miss. Credits and latency can help compare equivalent cold/warm requests, but do not establish an exact cache-hit rate on their own.

For a real comparison, keep account/profile/region/model/tools/system stable, repeat a long prefix, and vary only the final user turn. Record only counters, timings, and opaque correlation IDs. Offline tests use synthetic requests and verify conversion and accounting; they do not measure live Kiro cache savings.
