// Claude Code detects model capabilities from Anthropic IDs, whose version
// components use hyphens. Keep Kiro's IDs at the upstream boundary; this helper
// only changes client-facing spelling, never the model version or capabilities.
export function toClaudeClientModelId(modelId: string): string {
    const modern = /^(claude-(?:opus|sonnet|haiku)-\d+)\.(\d{1,2})((?:-\d{8})?(?:\[1m\])?)$/i
    const legacy = /^(claude-\d+)\.(\d{1,2})-((?:opus|sonnet|haiku)(?:-\d{8})?(?:\[1m\])?)$/i
    if (modern.test(modelId)) return modelId.replace(modern, '$1-$2$3').toLowerCase()
    if (legacy.test(modelId)) return modelId.replace(legacy, '$1-$2-$3').toLowerCase()
    return modelId
}

export function matchesClientModelPattern(modelId: string, pattern: string): boolean {
    // Only '*' is a wildcard. Dots, brackets and other regex metacharacters in
    // saved model IDs must remain literal (including the client '[1m]' suffix).
    const escaped = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    const regex = new RegExp(`^${escaped}$`, 'i')
    const clientId = toClaudeClientModelId(modelId)
    const kiroId = clientId
        .replace(/^(claude-(?:opus|sonnet|haiku)-\d+)-(\d{1,2})((?:-\d{8})?(?:\[1m\])?)$/i, '$1.$2$3')
        .replace(/^(claude-\d+)-(\d{1,2})-((?:opus|sonnet|haiku)(?:-\d{8})?(?:\[1m\])?)$/i, '$1.$2-$3')
    return [modelId, clientId, kiroId].some(id => regex.test(id))
}
