import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// 将纯 TypeScript 模块临时打包后直接用 Node 断言，避免为测试增加运行时依赖。
const tempDir = await mkdtemp(join(tmpdir(), 'kiro-capabilities-'))

try {
    const bundlePath = join(tempDir, 'modelCapabilities.mjs')
    await build({
        entryPoints: [resolve('src/main/proxy/modelCapabilities.ts')],
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node22',
        outfile: bundlePath
    })

    const { buildThinkingFields, extractThinkingSchema, getThinkingConfig } = await import(pathToFileURL(bundlePath).href)

    assert.deepEqual(getThinkingConfig(), { state: 'unknown' })
    assert.equal(buildThinkingFields(undefined, { type: 'adaptive' }), undefined)
    assert.equal(buildThinkingFields({ state: 'unknown' }, { type: 'enabled', budget_tokens: 9000 }, 'high'), undefined)

    // 不按模型名称猜测能力：GPT 4/4.1/5 与 Claude 4/4.5/Haiku 无 schema 时都不发送字段。
    const modelsWithoutSchema = [
        'gpt-4o',
        'gpt-4.1',
        'gpt-5',
        'claude-sonnet-4',
        'claude-sonnet-4-5',
        'claude-haiku-4-5'
    ]
    for (const id of modelsWithoutSchema) {
        const config = getThinkingConfig({ id, additionalModelRequestFieldsSchema: null })
        assert.equal(config.state, 'unsupported', id)
        for (const budget_tokens of [1024, 8000, 32000, 100000]) {
            assert.equal(buildThinkingFields(config, { type: 'enabled', budget_tokens }, 'high'), undefined, id)
        }
    }
    assert.equal(getThinkingConfig({}).state, 'unsupported')

    const thinkingOnlySchema = {
        type: 'object',
        properties: {
            thinking: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['adaptive', 'disabled'] },
                    display: { type: 'string', enum: ['summarized', 'concise'], default: 'summarized' }
                }
            }
        }
    }
    const thinkingOnly = getThinkingConfig({ additionalModelRequestFieldsSchema: thinkingOnlySchema })
    assert.equal(thinkingOnly.state, 'supported')
    assert.deepEqual(buildThinkingFields(thinkingOnly, { type: 'adaptive', display: 'concise' }), {
        thinking: { type: 'adaptive', display: 'concise' }
    })
    assert.deepEqual(extractThinkingSchema(thinkingOnlySchema), {
        supportsThinking: true,
        supportsOutputConfig: false,
        supportsReasoning: false,
        supportsBudgetTokens: false,
        supportsDisplay: true
    })

    const outputConfigOnlySchema = {
        $defs: {
            effort: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' }
        },
        type: 'object',
        properties: {
            output_config: {
                type: 'object',
                properties: { effort: { $ref: '#/$defs/effort' } }
            }
        }
    }
    const outputConfigOnly = getThinkingConfig({ additionalModelRequestFieldsSchema: outputConfigOnlySchema })
    assert.deepEqual(buildThinkingFields(outputConfigOnly, { type: 'adaptive', display: 'summarized' }, 'LOW'), {
        output_config: { effort: 'low' }
    })
    assert.deepEqual(buildThinkingFields(outputConfigOnly, undefined, 'unsupported'), {
        output_config: { effort: 'medium' }
    })
    assert.deepEqual(extractThinkingSchema(outputConfigOnlySchema), {
        efforts: ['low', 'medium', 'high'],
        schemaPath: 'output_config',
        supportsThinking: false,
        supportsOutputConfig: true,
        supportsReasoning: false,
        supportsBudgetTokens: false,
        supportsDisplay: false
    })

    const reasoningOnlySchema = {
        type: 'object',
        properties: {
            reasoning: {
                type: 'object',
                properties: { effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'] } }
            }
        }
    }
    const reasoningOnly = getThinkingConfig({ additionalModelRequestFieldsSchema: reasoningOnlySchema })
    assert.deepEqual(buildThinkingFields(reasoningOnly, undefined, 'HIGH'), { reasoning: { effort: 'high' } })
    assert.equal(extractThinkingSchema(reasoningOnlySchema).schemaPath, 'reasoning')

    const thinkingWithoutOptionalFieldsSchema = {
        type: 'object',
        properties: {
            thinking: {
                type: 'object',
                properties: { type: { type: 'string', enum: ['enabled', 'disabled'] } }
            }
        }
    }
    const thinkingWithoutOptionalFields = getThinkingConfig({ additionalModelRequestFieldsSchema: thinkingWithoutOptionalFieldsSchema })
    assert.deepEqual(buildThinkingFields(thinkingWithoutOptionalFields, {
        type: 'enabled',
        budget_tokens: 9000,
        display: 'summarized'
    }), { thinking: { type: 'enabled' } })
    assert.equal(buildThinkingFields(thinkingWithoutOptionalFields, { type: 'disabled' }, 'high'), undefined)

    const budgetSchema = {
        type: 'object',
        properties: {
            thinking: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['enabled', 'adaptive'] },
                    budget_tokens: { type: 'integer', minimum: 1024, maximum: 8192 }
                }
            }
        }
    }
    const budgetConfig = getThinkingConfig({ additionalModelRequestFieldsSchema: budgetSchema })
    assert.deepEqual(buildThinkingFields(budgetConfig, { type: 'enabled', budget_tokens: 20000 }), {
        thinking: { type: 'enabled', budget_tokens: 8192 }
    })
    assert.deepEqual(buildThinkingFields(budgetConfig, { type: 'enabled', budget_tokens: 64 }), {
        thinking: { type: 'enabled', budget_tokens: 1024 }
    })
    assert.deepEqual(buildThinkingFields(budgetConfig, { type: 'adaptive', budget_tokens: 4096 }), {
        thinking: { type: 'adaptive' }
    })

    const effortSchema = {
        type: 'object',
        properties: {
            thinking: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['enabled', 'adaptive'] },
                    budget_tokens: { type: 'integer', minimum: 512, maximum: 150000 }
                }
            },
            output_config: {
                type: 'object',
                properties: {
                    effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'], default: 'medium' }
                }
            }
        }
    }
    const effortConfig = getThinkingConfig({ additionalModelRequestFieldsSchema: effortSchema })
    const tiers = [[1024, 'low'], [8000, 'medium'], [32000, 'high'], [100000, 'xhigh']]
    for (const [budget_tokens, effort] of tiers) {
        assert.deepEqual(buildThinkingFields(effortConfig, { type: 'enabled', budget_tokens }), {
            thinking: { type: 'enabled', budget_tokens },
            output_config: { effort }
        })
    }
    assert.deepEqual(buildThinkingFields(effortConfig, { type: 'adaptive' }, 'HIGH'), {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' }
    })
    assert.deepEqual(buildThinkingFields(effortConfig, { type: 'adaptive' }, 'ultra'), {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' }
    })
    assert.equal(buildThinkingFields(effortConfig, { type: 'disabled' }, 'high'), undefined)

    const requiredBudgetSchema = {
        type: 'object',
        properties: {
            thinking: {
                type: 'object',
                required: ['type', 'budget_tokens'],
                properties: {
                    type: { type: 'string', enum: ['enabled', 'adaptive'] },
                    budget_tokens: { type: 'integer', minimum: 1024, maximum: 4096 }
                }
            }
        }
    }
    const requiredBudgetConfig = getThinkingConfig({ additionalModelRequestFieldsSchema: requiredBudgetSchema })
    assert.equal(buildThinkingFields(requiredBudgetConfig, { type: 'enabled' }), undefined)
    assert.deepEqual(buildThinkingFields(requiredBudgetConfig, { type: 'enabled', budget_tokens: 2048 }), {
        thinking: { type: 'enabled', budget_tokens: 2048 }
    })

    const requiredBudgetDefaultSchema = structuredClone(requiredBudgetSchema)
    requiredBudgetDefaultSchema.properties.thinking.properties.budget_tokens.default = 3072
    const requiredBudgetDefaultConfig = getThinkingConfig({ additionalModelRequestFieldsSchema: requiredBudgetDefaultSchema })
    assert.deepEqual(buildThinkingFields(requiredBudgetDefaultConfig, { type: 'enabled' }), {
        thinking: { type: 'enabled', budget_tokens: 3072 }
    })

    const uppercaseEffortSchema = {
        type: 'object',
        properties: {
            reasoning: {
                type: 'object',
                properties: { effort: { type: 'string', enum: ['LOW', 'HIGH'], default: 'LOW' } }
            }
        }
    }
    const uppercaseEffortConfig = getThinkingConfig({ additionalModelRequestFieldsSchema: uppercaseEffortSchema })
    assert.deepEqual(buildThinkingFields(uppercaseEffortConfig, undefined, 'high'), {
        reasoning: { effort: 'HIGH' }
    })

    // 组合 schema 分支无法可靠判断时，不猜测其中的字段。
    assert.equal(getThinkingConfig({
        additionalModelRequestFieldsSchema: { anyOf: [thinkingOnlySchema, outputConfigOnlySchema] }
    }).state, 'unsupported')

    console.log('compat-capabilities: passed')
} finally {
    await rm(tempDir, { recursive: true, force: true })
}
