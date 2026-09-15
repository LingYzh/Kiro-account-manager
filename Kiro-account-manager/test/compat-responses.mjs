import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'kiro-responses-'))

try {
    const translatorBundle = join(temporaryDirectory, 'translator.cjs')
    const streamBundle = join(temporaryDirectory, 'responsesStream.cjs')
    const stubKiroApiPlugin = {
        name: 'responses-adapter-test-stubs',
        setup(esbuild) {
            esbuild.onResolve({ filter: /^\.\/kiroApi$/ }, args => {
                if (args.importer.replaceAll('\\', '/').endsWith('/src/main/proxy/translator.ts')) {
                    return { path: 'kiroApi-test-stub', namespace: 'responses-test-stub' }
                }
            })
            esbuild.onLoad({ filter: /^kiroApi-test-stub$/, namespace: 'responses-test-stub' }, () => ({
                contents: `
                    export function buildKiroPayload() {
                        throw new Error('buildKiroPayload is outside this adapter test')
                    }
                    export function mapModelId(model) {
                        return model
                    }
                `,
                loader: 'ts'
            }))
        }
    }

    await build({
        entryPoints: [resolve(projectRoot, 'src/main/proxy/translator.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: translatorBundle,
        plugins: [stubKiroApiPlugin]
    })
    await build({
        entryPoints: [resolve(projectRoot, 'src/main/proxy/responsesStream.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: streamBundle
    })

    const require = createRequire(import.meta.url)
    const translator = require(translatorBundle)
    const { ResponsesStream } = require(streamBundle)

    const chatRequest = translator.responsesToOpenAIChat({
        model: 'gpt-4.1',
        instructions: 'Follow the system instruction.',
        input: [
            { type: 'message', role: 'developer', content: 'Use the developer message.' },
            {
                type: 'message',
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Inspect these inputs.' },
                    { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
                    { type: 'input_file', file_data: 'data:application/pdf;base64,cGRm', filename: 'brief.pdf' }
                ]
            },
            { type: 'function_call', call_id: 'call_previous', name: 'lookup', arguments: '{"query":"old"}' },
            { type: 'function_call', call_id: 'call_previous_2', name: 'lookup', arguments: '{"query":"second"}' },
            { type: 'function_call_output', call_id: 'call_previous', output: 'Previous result.' },
            {
                type: 'function_call_output',
                call_id: 'call_previous_2',
                output: [
                    { type: 'input_text', text: 'Image and file result.' },
                    { type: 'input_image', image_url: 'data:image/png;base64,b3V0cHV0' },
                    { type: 'input_file', file_data: 'data:application/pdf;base64,b3V0cHV0', filename: 'result.pdf' }
                ]
            }
        ],
        tools: [{
            type: 'function',
            name: 'lookup',
            description: 'Search a record.',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
            strict: true
        }],
        tool_choice: { type: 'function', name: 'lookup' },
        reasoning: { effort: 'high' },
        thinking: { type: 'adaptive', display: 'summarized' }
    })
    assert.deepEqual(chatRequest.tools, [{
        type: 'function',
        function: {
            name: 'lookup',
            description: 'Search a record.',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
        }
    }])
    assert.deepEqual(chatRequest.tool_choice, { type: 'function', function: { name: 'lookup' } })
    assert.equal(chatRequest.reasoning_effort, 'high')
    assert.deepEqual(chatRequest.thinking, { type: 'adaptive', display: 'summarized' })
    assert.equal(chatRequest.messages[0].role, 'system')
    assert.equal(chatRequest.messages[1].role, 'system')
    assert.equal(chatRequest.messages[2].content[0].text, 'Inspect these inputs.')
    assert.equal(chatRequest.messages[2].content[1].type, 'image_url')
    assert.equal(chatRequest.messages[2].content[1].image_url.url, 'data:image/png;base64,aW1hZ2U=')
    assert.equal(chatRequest.messages[2].content[2].type, 'file')
    assert.equal(chatRequest.messages[2].content[2].file.filename, 'brief.pdf')
    assert.equal(chatRequest.messages[3].tool_calls.length, 2)
    assert.equal(chatRequest.messages[3].tool_calls[0].id, 'call_previous')
    assert.equal(chatRequest.messages[3].tool_calls[1].id, 'call_previous_2')
    assert.equal(chatRequest.messages[4].tool_call_id, 'call_previous')
    assert.equal(chatRequest.messages[4].content, 'Previous result.')
    assert.equal(chatRequest.messages[5].tool_call_id, 'call_previous_2')
    assert.equal(chatRequest.messages[5].content[0].text, 'Image and file result.')
    assert.equal(chatRequest.messages[5].content[1].type, 'image_url')
    assert.equal(chatRequest.messages[5].content[2].type, 'file')

    const nullableExtensionRequest = translator.responsesToOpenAIChat({
        model: 'gpt-4.1',
        input: 'No previous state.',
        previous_response_id: null,
        reasoning: null
    })
    assert.equal(nullableExtensionRequest.conversation_id, undefined)
    assert.equal(nullableExtensionRequest.reasoning_effort, undefined)

    const assistantTextRequest = translator.responsesToOpenAIChat({
        model: 'gpt-4.1',
        input: [{ role: 'assistant', content: [{ type: 'output_text', text: 'Earlier answer.' }] }]
    })
    assert.deepEqual(assistantTextRequest.messages[0].content, [{ type: 'text', text: 'Earlier answer.' }])

    const nestedToolRequest = translator.responsesToOpenAIChat({
        model: 'gpt-4.1',
        input: 'Hello',
        tools: [{ type: 'function', function: { name: 'legacy', description: 'Legacy shape', parameters: { type: 'object' } } }]
    })
    assert.equal(nestedToolRequest.tools[0].function.name, 'legacy')
    assert.deepEqual(nestedToolRequest.tools[0].function.parameters, { type: 'object' })

    assert.throws(
        () => translator.responsesToOpenAIChat({ model: 'gpt-4.1', input: 'Hello', tools: [{ type: 'web_search' }] }),
        /Responses tool at index 0 has unsupported type: web_search/
    )
    assert.throws(
        () => translator.responsesToOpenAIChat({ model: 'gpt-4.1', input: 'Hello', tools: [{ type: 'function', name: '' }] }),
        /requires a non-empty function name/
    )
    assert.throws(
        () => translator.responsesToOpenAIChat({ model: 'gpt-4.1', input: 'Hello', tool_choice: 'sometimes' }),
        /Unsupported Responses tool_choice/
    )
    assert.throws(
        () => translator.responsesToOpenAIChat({ model: 'gpt-4.1', input: 'Hello', previous_response_id: 'resp_old' }),
        /previous_response_id is not supported/
    )
    assert.throws(
        () => translator.responsesToOpenAIChat({ model: 'gpt-4.1', input: [{ type: 'reasoning', encrypted_content: 'opaque' }] }),
        /Encrypted Responses reasoning input is not supported/
    )
    assert.throws(
        () => translator.responsesToOpenAIChat({ model: 'gpt-4.1', input: 'Hello', reasoning: { encrypted_content: 'opaque' } }),
        /Encrypted Responses reasoning input is not supported/
    )

    const kiroResponse = translator.kiroToOpenaiResponse(
        'I found a result.',
        [{ toolUseId: 'call_next', name: 'lookup', input: { query: 'new' } }],
        { inputTokens: 8, outputTokens: 4, credits: 0 },
        'gpt-4.1'
    )
    assert.equal(kiroResponse.choices[0].message.content, 'I found a result.')
    assert.equal(kiroResponse.choices[0].message.tool_calls[0].id, 'call_next')

    const responsesResult = translator.openAIChatToResponsesResponse(kiroResponse)
    assert.equal(responsesResult.status, 'completed')
    assert.equal(responsesResult.output.length, 2)
    assert.equal(responsesResult.output[0].type, 'message')
    assert.equal(responsesResult.output[0].content[0].text, 'I found a result.')
    assert.equal(responsesResult.output[1].type, 'function_call')
    assert.equal(responsesResult.output[1].call_id, 'call_next')
    assert.throws(
        () => translator.openAIChatToResponsesResponse(kiroResponse, 'resp_old'),
        /previous_response_id is not supported/
    )

    const events = []
    const responseStream = new ResponsesStream('gpt-4.1', event => events.push(event), 'resp_stream_test')
    responseStream.start()
    responseStream.text('Hello ')
    responseStream.text('world')
    responseStream.tool({ toolUseId: 'call_stream', name: 'lookup', input: { query: 'today' }, stop: true })
    responseStream.complete({ inputTokens: 10, outputTokens: 7, credits: 0, cacheReadTokens: 3, reasoningTokens: 2 })

    assert.deepEqual(events.map(event => event.sequence_number), events.map((_, index) => index))
    assert.deepEqual(events.slice(0, 2).map(event => event.type), ['response.created', 'response.in_progress'])
    assert.equal(events[0].response.id, responseStream.responseId)
    assert.equal(events[0].response.status, 'in_progress')

    const textAdded = events.find(event => event.type === 'response.output_item.added' && event.item.type === 'message')
    assert.deepEqual(textAdded.item.content, [])
    const textPartAdded = events.find(event => event.type === 'response.content_part.added')
    assert.equal(textPartAdded.part.text, '')
    const textDeltas = events.filter(event => event.type === 'response.output_text.delta')
    assert.deepEqual(textDeltas.map(event => event.delta), ['Hello ', 'world'])
    const textDone = events.find(event => event.type === 'response.output_text.done')
    assert.equal(textDone.text, 'Hello world')

    const toolAdded = events.find(event => event.type === 'response.output_item.added' && event.item.type === 'function_call')
    assert.equal(toolAdded.item.arguments, '')
    const toolDone = events.find(event => event.type === 'response.function_call_arguments.done')
    assert.equal(toolDone.arguments, '{"query":"today"}')
    const toolItemDone = events.find(event => event.type === 'response.output_item.done' && event.item.type === 'function_call')
    assert.equal(toolAdded.item.id, toolItemDone.item.id)
    assert.equal(toolAdded.item.call_id, toolItemDone.item.call_id)

    const completedEvent = events.at(-1)
    assert.equal(completedEvent.type, 'response.completed')
    assert.equal(completedEvent.response.id, responseStream.responseId)
    assert.equal(completedEvent.response.status, 'completed')
    assert.equal(completedEvent.response.output[0].content[0].text, 'Hello world')
    assert.equal(completedEvent.response.output[0].status, 'completed')
    assert.equal(completedEvent.response.output[1].arguments, '{"query":"today"}')
    assert.equal(completedEvent.response.output[1].status, 'completed')
    assert.deepEqual(completedEvent.response.usage, {
        input_tokens: 10,
        output_tokens: 7,
        total_tokens: 17,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 }
    })

    const failedEvents = []
    const failedStream = new ResponsesStream('gpt-4.1', event => failedEvents.push(event), 'resp_failed_test')
    failedStream.start()
    failedStream.text('partial text')
    failedStream.tool({ toolUseId: 'call_incomplete', name: 'lookup', stop: false })
    failedStream.fail('Upstream stopped unexpectedly')
    const failedEvent = failedEvents.at(-1)
    assert.equal(failedEvent.type, 'response.failed')
    assert.equal(failedEvent.response.status, 'failed')
    assert.equal(failedEvent.response.error.message, 'Upstream stopped unexpectedly')
    assert.equal(failedEvent.response.output[0].status, 'completed')
    assert.equal(failedEvent.response.output[1].status, 'incomplete')
    assert.equal(failedEvent.response.output[1].arguments, '')
    assert.equal(failedEvents.some(event => event.type === 'response.function_call_arguments.done'), false)

    const partialTextEvents = []
    const partialTextStream = new ResponsesStream('gpt-4.1', event => partialTextEvents.push(event), 'resp_partial_test')
    partialTextStream.start()
    partialTextStream.text('unfinished')
    partialTextStream.fail('Upstream failed')
    const partialTextFailure = partialTextEvents.at(-1)
    assert.equal(partialTextFailure.response.output[0].status, 'incomplete')
    assert.equal(partialTextFailure.response.output[0].content[0].text, 'unfinished')
    assert.equal(partialTextEvents.some(event => event.type === 'response.output_text.done'), false)

    console.log('Responses adapter and stream compatibility tests passed.')
} finally {
    const temporaryRoot = resolve(tmpdir())
    if (dirname(temporaryDirectory) === temporaryRoot && temporaryDirectory.startsWith(`${temporaryRoot}${sep}`)) {
        await rm(temporaryDirectory, { recursive: true, force: true })
    }
}
