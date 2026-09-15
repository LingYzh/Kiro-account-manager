import { v4 as uuidv4 } from 'uuid'
import type { KiroUsage } from './types'

export interface ResponsesStreamEvent {
    type: string
    sequence_number: number
    [key: string]: unknown
}

export type ResponsesStreamEventHandler = (event: ResponsesStreamEvent) => void

export interface ResponsesStreamTool {
    toolUseId: string
    name: string
    input?: Record<string, unknown>
    stop?: boolean
}

interface ResponsesStreamTextPart {
    type: 'output_text'
    text: string
    annotations: []
}

interface ResponsesStreamMessageItem {
    id: string
    type: 'message'
    status: 'in_progress' | 'completed' | 'incomplete'
    role: 'assistant'
    content: ResponsesStreamTextPart[]
}

interface ResponsesStreamFunctionItem {
    id: string
    type: 'function_call'
    status: 'in_progress' | 'completed' | 'incomplete'
    call_id: string
    name: string
    arguments: string
}

type ResponsesStreamItem = ResponsesStreamMessageItem | ResponsesStreamFunctionItem

interface ResponsesStreamUsage {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    input_tokens_details?: { cached_tokens?: number }
    output_tokens_details?: { reasoning_tokens?: number }
}

interface ResponsesStreamSnapshot {
    id: string
    object: 'response'
    created_at: number
    status: 'in_progress' | 'completed' | 'failed'
    error: { code: string | null; message: string } | null
    incomplete_details: null
    model: string
    output: ResponsesStreamItem[]
    previous_response_id: null
    usage: ResponsesStreamUsage | null
}

interface ResponsesStreamToolState {
    item: ResponsesStreamFunctionItem
    outputIndex: number
    completed: boolean
}

/** Converts Kiro callbacks into the ordered event sequence expected by Responses clients. */
export class ResponsesStream {
    readonly responseId: string

    private readonly createdAt = Math.floor(Date.now() / 1000)
    private readonly items: ResponsesStreamItem[] = []
    private readonly tools = new Map<string, ResponsesStreamToolState>()
    private sequenceNumber = 0
    private state: 'created' | 'started' | 'completed' | 'failed' = 'created'
    private activeText: ResponsesStreamMessageItem | null = null

    constructor(
        private readonly model: string,
        private readonly emit: ResponsesStreamEventHandler,
        responseId = `resp_${uuidv4()}`
    ) {
        this.responseId = responseId
    }

    start(): void {
        if (this.state !== 'created') {
            throw new Error('Responses stream has already started or completed')
        }
        this.state = 'started'
        this.emitEvent('response.created', { response: this.createSnapshot('in_progress', null, null) })
        this.emitEvent('response.in_progress', { response: this.createSnapshot('in_progress', null, null) })
    }

    text(delta: string): void {
        this.assertStarted()
        if (!delta) return
        this.finalizePendingTools()

        if (!this.activeText) {
            const item: ResponsesStreamMessageItem = {
                id: `msg_${uuidv4()}`,
                type: 'message',
                status: 'in_progress',
                role: 'assistant',
                content: [{ type: 'output_text', text: '', annotations: [] }]
            }
            this.activeText = item
            const outputIndex = this.items.length
            this.items.push(item)
            this.emitEvent('response.output_item.added', {
                output_index: outputIndex,
                item: { ...this.cloneItem(item), content: [] }
            })
            this.emitEvent('response.content_part.added', {
                item_id: item.id,
                output_index: outputIndex,
                content_index: 0,
                part: { type: 'output_text', text: '', annotations: [] }
            })
        }

        const outputIndex = this.items.indexOf(this.activeText)
        const part = this.activeText.content[0]
        part.text += delta
        this.emitEvent('response.output_text.delta', {
            item_id: this.activeText.id,
            output_index: outputIndex,
            content_index: 0,
            delta
        })
    }

    tool(tool: ResponsesStreamTool): void {
        this.assertStarted()
        if (!tool || typeof tool.toolUseId !== 'string' || !tool.toolUseId) {
            throw new Error('Responses stream tool requires toolUseId')
        }
        if (typeof tool.name !== 'string' || !tool.name) {
            throw new Error('Responses stream tool requires name')
        }
        if (tool.input !== undefined && (typeof tool.input !== 'object' || tool.input === null || Array.isArray(tool.input))) {
            throw new Error('Responses stream tool input must be an object')
        }

        let toolState = this.tools.get(tool.toolUseId)
        if (toolState?.completed) {
            const finalInput = tool.input === undefined ? toolState.item.arguments : JSON.stringify(tool.input)
            if (tool.name !== toolState.item.name || (finalInput && finalInput !== toolState.item.arguments)) {
                throw new Error(`Responses stream tool ${tool.toolUseId} was already completed`)
            }
            return
        }

        if (!toolState) {
            this.finalizePendingItems()
            const item: ResponsesStreamFunctionItem = {
                id: `fc_${uuidv4()}`,
                type: 'function_call',
                status: 'in_progress',
                call_id: tool.toolUseId,
                name: tool.name,
                arguments: ''
            }
            toolState = { item, outputIndex: this.items.length, completed: false }
            this.tools.set(tool.toolUseId, toolState)
            this.items.push(item)
            this.emitEvent('response.output_item.added', {
                output_index: toolState.outputIndex,
                item: this.cloneItem(item)
            })
        } else if (tool.name !== toolState.item.name) {
            throw new Error(`Responses stream tool ${tool.toolUseId} changed name before completion`)
        }

        if (tool.input !== undefined) {
            const argumentsText = JSON.stringify(tool.input)
            if (argumentsText !== toolState.item.arguments) {
                if (!argumentsText.startsWith(toolState.item.arguments)) {
                    throw new Error(`Responses stream tool ${tool.toolUseId} arguments must append to the existing delta`)
                }
                const delta = argumentsText.slice(toolState.item.arguments.length)
                toolState.item.arguments = argumentsText
                if (delta) {
                    this.emitEvent('response.function_call_arguments.delta', {
                        item_id: toolState.item.id,
                        output_index: toolState.outputIndex,
                        delta
                    })
                }
            }
        }

        if (tool.stop !== false) {
            this.finalizeTool(toolState)
        }
    }

    complete(usage: KiroUsage): void {
        this.assertStarted()
        this.finalizePendingItems()
        this.state = 'completed'
        this.emitEvent('response.completed', {
            response: this.createSnapshot('completed', this.convertUsage(usage), null)
        })
    }

    fail(message: string): void {
        if (this.state === 'completed' || this.state === 'failed') return
        if (this.state === 'created') this.start()
        for (const item of this.items) {
            if (item.status === 'in_progress') item.status = 'incomplete'
        }
        this.activeText = null
        this.state = 'failed'
        this.emitEvent('response.failed', {
            response: this.createSnapshot('failed', null, {
                code: 'server_error',
                message
            })
        })
    }

    private assertStarted(): void {
        if (this.state !== 'started') {
            throw new Error('Responses stream must be started before writing output')
        }
    }

    private finalizePendingItems(): void {
        for (const item of this.items) {
            if (item.status === 'completed') continue
            if (item.type === 'message') {
                this.finalizeText(item)
            } else {
                const toolState = this.tools.get(item.call_id)
                if (toolState) this.finalizeTool(toolState)
            }
        }
    }

    private finalizePendingTools(): void {
        for (const item of this.items) {
            if (item.type !== 'function_call' || item.status !== 'in_progress') continue
            const toolState = this.tools.get(item.call_id)
            if (toolState) this.finalizeTool(toolState)
        }
    }

    private finalizeText(item: ResponsesStreamMessageItem): void {
        if (item.status === 'completed') return
        const outputIndex = this.items.indexOf(item)
        const part = item.content[0]
        if (!part) return

        this.emitEvent('response.output_text.done', {
            item_id: item.id,
            output_index: outputIndex,
            content_index: 0,
            text: part.text
        })
        this.emitEvent('response.content_part.done', {
            item_id: item.id,
            output_index: outputIndex,
            content_index: 0,
            part: { ...part, annotations: [] }
        })
        item.status = 'completed'
        this.emitEvent('response.output_item.done', {
            output_index: outputIndex,
            item: this.cloneItem(item)
        })
        if (this.activeText === item) this.activeText = null
    }

    private finalizeTool(toolState: ResponsesStreamToolState): void {
        if (toolState.completed) return
        if (!toolState.item.arguments) {
            toolState.item.arguments = '{}'
            this.emitEvent('response.function_call_arguments.delta', {
                item_id: toolState.item.id,
                output_index: toolState.outputIndex,
                delta: toolState.item.arguments
            })
        }
        this.emitEvent('response.function_call_arguments.done', {
            item_id: toolState.item.id,
            output_index: toolState.outputIndex,
            name: toolState.item.name,
            arguments: toolState.item.arguments
        })
        toolState.item.status = 'completed'
        toolState.completed = true
        this.emitEvent('response.output_item.done', {
            output_index: toolState.outputIndex,
            item: this.cloneItem(toolState.item)
        })
    }

    private createSnapshot(
        status: ResponsesStreamSnapshot['status'],
        usage: ResponsesStreamUsage | null,
        error: ResponsesStreamSnapshot['error']
    ): ResponsesStreamSnapshot {
        return {
            id: this.responseId,
            object: 'response',
            created_at: this.createdAt,
            status,
            error,
            incomplete_details: null,
            model: this.model,
            output: this.items.map(item => this.cloneItem(item)),
            previous_response_id: null,
            usage
        }
    }

    private convertUsage(usage: KiroUsage): ResponsesStreamUsage {
        const result: ResponsesStreamUsage = {
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            total_tokens: usage.inputTokens + usage.outputTokens
        }
        if (usage.cacheReadTokens !== undefined) {
            result.input_tokens_details = { cached_tokens: usage.cacheReadTokens }
        }
        if (usage.reasoningTokens !== undefined) {
            result.output_tokens_details = { reasoning_tokens: usage.reasoningTokens }
        }
        return result
    }

    private cloneItem(item: ResponsesStreamItem): ResponsesStreamItem {
        if (item.type === 'message') {
            return {
                ...item,
                content: item.content.map(part => ({ ...part, annotations: [] }))
            }
        }
        return { ...item }
    }

    private emitEvent(type: string, fields: Record<string, unknown>): void {
        this.emit({ ...fields, type, sequence_number: this.sequenceNumber++ })
    }
}
