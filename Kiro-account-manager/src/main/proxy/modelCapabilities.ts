type JsonSchema = Record<string, unknown>
type ThinkingFieldType = 'enabled' | 'adaptive'
type ThinkingSchemaPath = 'output_config' | 'reasoning'

export interface ThinkingConfig {
    state: 'supported' | 'unsupported' | 'unknown'
    schema?: Record<string, unknown>
}

export interface ThinkingSchemaInfo {
    efforts?: string[]
    schemaPath?: ThinkingSchemaPath
    supportsThinking?: boolean
    supportsOutputConfig?: boolean
    supportsReasoning?: boolean
    supportsBudgetTokens?: boolean
    supportsDisplay?: boolean
}

const EFFORT_PATHS: ThinkingSchemaPath[] = ['output_config', 'reasoning']
const EFFORT_FALLBACKS = ['high', 'medium', 'low', 'xhigh', 'max', 'minimal']

function isRecord(value: unknown): value is JsonSchema {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveLocalRef(root: JsonSchema, ref: string): unknown {
    if (!ref.startsWith('#/')) return undefined

    let value: unknown = root
    for (const part of ref.slice(2).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
        if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, key)) return undefined
        value = value[key]
    }
    return value
}

// 只解析直接 schema 和独立的本地引用；组合 schema 无法可靠选择分支时安全省略。
function resolveSchema(value: unknown, root: JsonSchema, refs = new Set<string>()): JsonSchema | undefined {
    if (!isRecord(value) || 'allOf' in value || 'anyOf' in value || 'oneOf' in value || 'not' in value) return undefined

    if (typeof value.$ref !== 'string') return value
    const siblings = Object.keys(value).filter(key => !['$ref', 'title', 'description', '$comment'].includes(key))
    if (siblings.length > 0 || refs.has(value.$ref)) return undefined

    const target = resolveLocalRef(root, value.$ref)
    if (!isRecord(target)) return undefined
    const nextRefs = new Set(refs)
    nextRefs.add(value.$ref)
    return resolveSchema(target, root, nextRefs)
}

function getProperties(schema: JsonSchema | undefined): JsonSchema | undefined {
    return schema && isRecord(schema.properties) ? schema.properties : undefined
}

function getChildSchema(parent: JsonSchema | undefined, key: string, root: JsonSchema): JsonSchema | undefined {
    const properties = getProperties(resolveSchema(parent, root))
    if (!properties || !Object.prototype.hasOwnProperty.call(properties, key)) return undefined
    return resolveSchema(properties[key], root)
}

function getStringChoices(schema: JsonSchema): string[] | undefined {
    let choices: string[] | undefined
    if (Array.isArray(schema.enum)) choices = schema.enum.filter((value): value is string => typeof value === 'string')
    if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
        if (typeof schema.const !== 'string') return []
        choices = choices ? choices.filter(value => value === schema.const) : [schema.const]
    }
    return choices
}

function supportsType(schema: JsonSchema, expected: string): boolean {
    if (schema.type === undefined) return true
    if (typeof schema.type === 'string') return schema.type === expected
    return Array.isArray(schema.type) && schema.type.includes(expected)
}

function chooseEffort(schema: JsonSchema, requested?: string): string | undefined {
    if (!supportsType(schema, 'string')) return undefined
    const choices = getStringChoices(schema)
    const defaultEffort = typeof schema.default === 'string' ? schema.default.trim().toLowerCase() : undefined
    const candidates = [requested, defaultEffort, ...EFFORT_FALLBACKS].filter((value): value is string => !!value)

    if (choices) {
        for (const candidate of candidates) {
            const match = choices.find(value => value.toLowerCase() === candidate)
            if (match !== undefined) return match
        }
        return choices[0]
    }
    return candidates[0]
}

function chooseThinkingType(schema: JsonSchema, preferred?: ThinkingFieldType): string | undefined {
    if (!supportsType(schema, 'string')) return undefined
    const choices = getStringChoices(schema)
    const defaultValue = typeof schema.default === 'string' ? schema.default : undefined
    const candidates = [preferred, defaultValue, 'adaptive', 'enabled'].filter((value): value is string => !!value)

    if (choices) return candidates.find(candidate => choices.includes(candidate))
    return candidates[0]
}

function chooseDisplay(schema: JsonSchema, requested?: string): string | undefined {
    if (!supportsType(schema, 'string')) return undefined
    const choices = getStringChoices(schema)
    const defaultValue = typeof schema.default === 'string' ? schema.default : undefined
    const candidates = [requested, defaultValue, 'summarized', ...(choices ?? [])].filter((value): value is string => !!value)

    if (choices) return candidates.find(candidate => choices.includes(candidate))
    return requested ?? defaultValue
}

function chooseBudget(schema: JsonSchema, requested?: number): number | undefined {
    if (schema.type !== undefined && !supportsType(schema, 'integer') && !supportsType(schema, 'number')) return undefined

    const defaultValue = typeof schema.default === 'number' && Number.isFinite(schema.default) ? schema.default : undefined
    if (requested === undefined && defaultValue === undefined) return undefined
    let value = Number.isFinite(requested) ? Math.trunc(requested as number) : defaultValue
    if (value === undefined) return undefined

    const minimum = typeof schema.minimum === 'number' ? Math.ceil(schema.minimum) : undefined
    const maximum = typeof schema.maximum === 'number' ? Math.floor(schema.maximum) : undefined
    if (minimum !== undefined) value = Math.max(value, minimum)
    if (maximum !== undefined) value = Math.min(value, maximum)
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) return undefined

    let choices: number[] | undefined
    if (Array.isArray(schema.enum)) choices = schema.enum.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry) && Number.isInteger(entry))
    if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
        if (typeof schema.const !== 'number' || !Number.isFinite(schema.const) || !Number.isInteger(schema.const)) return undefined
        choices = choices ? choices.filter(entry => entry === schema.const) : [schema.const]
    }
    if (choices) {
        choices = choices.filter(entry => (minimum === undefined || entry >= minimum) && (maximum === undefined || entry <= maximum))
        if (choices.length === 0) return undefined
        if (choices.includes(value)) return value
        if (defaultValue !== undefined && choices.includes(defaultValue)) return defaultValue
        return choices.reduce((closest, entry) => Math.abs(entry - value) < Math.abs(closest - value) ? entry : closest)
    }
    return Number.isInteger(value) ? value : undefined
}

function normalizeEffort(value?: string): string | undefined {
    const normalized = value?.trim().toLowerCase()
    return normalized || undefined
}

function hasRequiredFields(schema: JsonSchema, value: JsonSchema): boolean {
    if (!Array.isArray(schema.required)) return true
    return schema.required.every(field => typeof field === 'string' && Object.prototype.hasOwnProperty.call(value, field))
}

function effortFromBudget(budget?: number): string | undefined {
    if (budget === undefined || !Number.isFinite(budget)) return undefined
    if (budget <= 4000) return 'low'
    if (budget <= 16000) return 'medium'
    if (budget <= 64000) return 'high'
    return 'xhigh'
}

function effortSchema(parent: JsonSchema | undefined, root: JsonSchema): JsonSchema | undefined {
    return getChildSchema(parent, 'effort', root)
}

function readEfforts(schema?: JsonSchema): string[] | undefined {
    if (!schema || !supportsType(schema, 'string')) return undefined
    const choices = getStringChoices(schema)?.map(value => value.toLowerCase())
    return choices && choices.length > 0 ? Array.from(new Set(choices)) : undefined
}

function getThinkingSchemaInfo(schema?: Record<string, unknown> | null): {
    root: JsonSchema
    thinking?: JsonSchema
    outputConfig?: JsonSchema
    reasoning?: JsonSchema
    effortSchemas: Partial<Record<ThinkingSchemaPath, JsonSchema>>
} | undefined {
    if (!isRecord(schema)) return undefined
    const root = resolveSchema(schema, schema)
    const properties = getProperties(root)
    if (!root || !properties) return undefined

    const thinking = getChildSchema(root, 'thinking', schema)
    const outputConfig = getChildSchema(root, 'output_config', schema)
    const reasoning = getChildSchema(root, 'reasoning', schema)
    const thinkingProperties = getProperties(thinking)
    const hasThinkingLeaf = !!thinkingProperties && ['type', 'budget_tokens', 'display'].some(key => {
        return !!getChildSchema(thinking, key, schema)
    })
    const outputEffort = effortSchema(outputConfig, schema)
    const reasoningEffort = effortSchema(reasoning, schema)
    if (!hasThinkingLeaf && !outputEffort && !reasoningEffort) return undefined

    return {
        root,
        ...(hasThinkingLeaf ? { thinking } : {}),
        ...(outputConfig ? { outputConfig } : {}),
        ...(reasoning ? { reasoning } : {}),
        effortSchemas: {
            ...(outputEffort ? { output_config: outputEffort } : {}),
            ...(reasoningEffort ? { reasoning: reasoningEffort } : {})
        }
    }
}

export function getThinkingConfig(model?: {
    additionalModelRequestFieldsSchema?: Record<string, unknown> | null
}): ThinkingConfig {
    if (model === undefined) return { state: 'unknown' }
    const schema = model.additionalModelRequestFieldsSchema
    if (!isRecord(schema) || !getThinkingSchemaInfo(schema)) return { state: 'unsupported' }
    return { state: 'supported', schema }
}

export function extractThinkingSchema(schema?: Record<string, unknown> | null): ThinkingSchemaInfo | undefined {
    const info = getThinkingSchemaInfo(schema)
    if (!info) return undefined

    const thinkingProperties = getProperties(info.thinking)
    const outputEffort = info.effortSchemas.output_config
    const reasoningEffort = info.effortSchemas.reasoning
    const schemaPath: ThinkingSchemaPath | undefined = outputEffort ? 'output_config' : reasoningEffort ? 'reasoning' : undefined
    const efforts = readEfforts(schemaPath === 'output_config' ? outputEffort : schemaPath === 'reasoning' ? reasoningEffort : undefined)

    return {
        ...(efforts ? { efforts } : {}),
        ...(schemaPath ? { schemaPath } : {}),
        supportsThinking: !!info.thinking,
        supportsOutputConfig: !!info.outputConfig,
        supportsReasoning: !!info.reasoning,
        supportsBudgetTokens: !!thinkingProperties && !!getChildSchema(info.thinking, 'budget_tokens', info.root),
        supportsDisplay: !!thinkingProperties && !!getChildSchema(info.thinking, 'display', info.root)
    }
}

function buildThinkingValue(
    schema: JsonSchema,
    root: JsonSchema,
    clientThinking: { type: string; budget_tokens?: number; display?: string } | undefined,
    hasExplicitEffort: boolean
): { fields?: JsonSchema; effectiveType?: ThinkingFieldType; budget?: number } {
    const preferredType = clientThinking?.type === 'enabled' || clientThinking?.type === 'adaptive'
        ? clientThinking.type
        : hasExplicitEffort ? 'adaptive' : undefined
    const typeSchema = getChildSchema(schema, 'type', root)
    const selectedType = typeSchema ? chooseThinkingType(typeSchema, preferredType) : preferredType
    if (selectedType !== 'enabled' && selectedType !== 'adaptive') return {}

    const fields: JsonSchema = {}
    if (typeSchema) fields.type = selectedType

    let budget: number | undefined
    const budgetSchema = getChildSchema(schema, 'budget_tokens', root)
    if (selectedType === 'enabled' && clientThinking?.type === 'enabled' && budgetSchema) {
        budget = chooseBudget(budgetSchema, clientThinking.budget_tokens)
        if (budget !== undefined) fields.budget_tokens = budget
    }

    const displaySchema = getChildSchema(schema, 'display', root)
    if (selectedType === 'adaptive' && displaySchema) {
        const display = chooseDisplay(displaySchema, clientThinking?.display)
        if (display !== undefined) fields.display = display
    }

    if (!hasRequiredFields(schema, fields)) return {}

    return {
        ...(Object.keys(fields).length > 0 ? { fields } : {}),
        effectiveType: selectedType,
        ...(budget !== undefined ? { budget } : {})
    }
}

export function buildThinkingFields(
    config: ThinkingConfig | undefined,
    clientThinking?: { type: string; budget_tokens?: number; display?: string },
    clientReasoningEffort?: string
): Record<string, unknown> | undefined {
    if (!config || config.state !== 'supported' || !config.schema || clientThinking?.type === 'disabled') return undefined

    const explicitEffort = normalizeEffort(clientReasoningEffort)
    const wantsThinking = clientThinking?.type === 'enabled' || clientThinking?.type === 'adaptive' || !!explicitEffort
    if (!wantsThinking) return undefined

    const info = getThinkingSchemaInfo(config.schema)
    if (!info) return undefined
    const fields: JsonSchema = {}
    const thinkingResult = info.thinking
        ? buildThinkingValue(info.thinking, info.root, clientThinking, !!explicitEffort)
        : {}
    if (thinkingResult.fields) fields.thinking = thinkingResult.fields

    const budgetForEffort = thinkingResult.budget ?? (
        clientThinking?.type === 'enabled' && typeof clientThinking.budget_tokens === 'number'
            ? clientThinking.budget_tokens
            : undefined
    )
    const requestedEffort = explicitEffort ?? effortFromBudget(budgetForEffort)

    for (const path of EFFORT_PATHS) {
        const schema = info.effortSchemas[path]
        if (!schema) continue
        const effort = chooseEffort(schema, requestedEffort)
        if (effort === undefined) continue
        const value = { effort }
        const parent = path === 'output_config' ? info.outputConfig : info.reasoning
        if (parent && hasRequiredFields(parent, value)) fields[path] = value
    }

    return Object.keys(fields).length > 0 && hasRequiredFields(info.root, fields) ? fields : undefined
}
