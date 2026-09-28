import type { ClaudeRequest } from './types'

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined
}

function unsupported(field: string): never {
    throw new Error(`Kiro does not support ${field}; this constraint cannot be applied by this gateway.`)
}

/** Validate known semantic requirements, without closing the ingress schema to extensions. */
export function inspectClaudeCapabilities(request: ClaudeRequest): string[] {
    const body = request as unknown as Record<string, unknown>
    const diagnostics = new Set<string>()
    const management = record(request.context_management)
    if (request.context_management != null && !management) unsupported('context_management')
    if (management && Object.entries(management).some(([key, value]) =>
        key !== 'edits' || !Array.isArray(value) || value.length > 0)) {
        unsupported('context_management edits')
    }
    if (request.output_config?.format != null) unsupported('output_config.format')
    if (request.output_config?.task_budget != null) unsupported('output_config.task_budget')
    if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) unsupported('stop_sequences')
    if (body.safeguards != null) unsupported('safeguards')
    if (Array.isArray(body.mcp_servers) && body.mcp_servers.length > 0) unsupported('mcp_servers')
    if (request.tool_choice?.type === 'any' || request.tool_choice?.type === 'tool') unsupported('tool_choice forced tool execution')
    if (request.tool_choice?.disable_parallel_tool_use === true) unsupported('tool_choice.disable_parallel_tool_use')

    const cache = (value: unknown): void => {
        const control = record(value)
        if (control?.ttl !== undefined) diagnostics.add('cache_ttl_not_supported')
    }
    cache(body.cache_control)
    if (body.cache_control != null) diagnostics.add('automatic_cache_control_not_supported')
    if (Array.isArray(request.system)) {
        for (const block of request.system) cache(block?.cache_control)
    }
    const inspectBlocks = (blocks: unknown[], role: string, nested = false): void => {
        for (let index = 0; index < blocks.length; index++) {
            const block = record(blocks[index])
            if (!block || typeof block.type !== 'string') throw new Error('Claude content blocks require a type')
            const supported = nested ? ['text', 'image'] : role === 'system' ? ['text']
                : role === 'assistant' ? ['text', 'tool_use', 'thinking', 'redacted_thinking']
                    : ['text', 'image', 'document', 'tool_result']
            if (!supported.includes(block.type)) unsupported(`messages content block type '${block.type}'`)
            cache(block.cache_control)
            if (block.cache_control != null && (nested || index !== blocks.length - 1)) {
                diagnostics.add('internal_cache_boundary_not_supported')
            }
            if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                diagnostics.add('thinking_history_not_supported')
            }
            if (block.type === 'tool_result' && Array.isArray(block.content)) inspectBlocks(block.content, role, true)
        }
    }
    for (let index = 0; index < request.messages.length; index++) {
        const message = request.messages[index]
        cache(message.cache_control)
        if (Array.isArray(message.content)) inspectBlocks(message.content, message.role)
        const nextRole = request.messages[index + 1]?.role
        if (message.role !== 'assistant' && nextRole && nextRole !== 'assistant'
            && (message.cache_control || (Array.isArray(message.content)
                && message.content.some(block => block.cache_control)))) {
            diagnostics.add('merged_cache_boundary_not_supported')
        }
    }
    for (const tool of request.tools ?? []) {
        if (tool.type && tool.type !== 'custom') {
            // Claude Code recognizes this shape for advisor capability recovery.
            throw new Error(`Input tag '${tool.type}' in tools is not supported by the Kiro gateway.`)
        }
        if (tool.strict === true) unsupported('tools.strict')
        if (tool.defer_loading === true) unsupported('tools.defer_loading')
        cache(tool.cache_control)
    }
    return [...diagnostics]
}
