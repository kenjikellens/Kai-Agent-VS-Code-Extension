import type { ChatMessage } from './providers/ILLMProvider';

/** A chat message exchanged during an agent run. */
export interface ContextMessage extends ChatMessage {}

/**
 * Keeps the agent conversation within a configurable context budget.
 * Token usage is estimated without an external tokenizer so this remains
 * suitable for all configured local and cloud providers.
 */
export class ContextManager {
    private readonly maxTokens: number;
    private readonly reservedTokens: number;

    /**
     * Initializes ContextManager with token budget limits.
     * @param maxTokens Maximum total tokens allowed.
     * @param reservedTokens Token headroom reserved for completions.
     */
    constructor(maxTokens: number = 16000, reservedTokens: number = 4000) {
        this.maxTokens = maxTokens;
        this.reservedTokens = reservedTokens;
    }

    /** Estimates tokens using a conservative four-characters-per-token heuristic. */
    public estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /** Returns the estimated token count for a complete message history. */
    public getTotalTokens(messages: ContextMessage[]): number {
        return messages.reduce((total, message) => total + this.estimateTokens(message.content), 0);
    }

    /** Compresses older messages when the reserved context budget is exceeded. */
    public compressIfNeeded(messages: ContextMessage[]): ContextMessage[] {
        const targetTokens = Math.max(0, this.maxTokens - this.reservedTokens);
        if (this.getTotalTokens(messages) <= targetTokens) {
            return messages;
        }

        const protectedIndexes = this.getProtectedIndexes(messages);
        const compressed = messages.map((message, index) => {
            if (protectedIndexes.has(index)) {
                return message;
            }

            return {
                ...message,
                content: this.createSummary(message)
            };
        });

        if (this.getTotalTokens(compressed) <= targetTokens) {
            return compressed;
        }

        // For unusually large histories, shorten already-created summaries again.
        return compressed.map((message, index) => {
            if (protectedIndexes.has(index)) {
                return message;
            }

            return {
                ...message,
                content: message.role === 'assistant' ? '[Previous assistant step omitted]' : '[Previous tool result omitted]'
            };
        });
    }

    /**
     * Identifies indices of essential messages that must never be compressed (system prompt, first user, recent turns).
     */
    private getProtectedIndexes(messages: ContextMessage[]): Set<number> {
        const protectedIndexes = new Set<number>();
        const systemIndex = messages.findIndex((message) => message.role === 'system');
        if (systemIndex !== -1) {
            protectedIndexes.add(systemIndex);
        }

        const firstUserIndex = messages.findIndex((message) => message.role === 'user');
        if (firstUserIndex !== -1) {
            protectedIndexes.add(firstUserIndex);
        }

        for (let index = Math.max(0, messages.length - 2); index < messages.length; index++) {
            protectedIndexes.add(index);
        }

        return protectedIndexes;
    }

    /**
     * Generates a concise summary placeholder for an older message.
     */
    private createSummary(message: ContextMessage): string {
        const lineCount = message.content.split(/\r?\n/).length;
        if (message.role === 'assistant') {
            const toolMatch = message.content.match(/(?:"type"|"tool"|"name")\s*:\s*"([^"]+)"/i);
            const toolName = toolMatch ? ` ${toolMatch[1]}` : '';
            return `[Previous step:${toolName} response omitted; ${lineCount} lines]`;
        }

        const toolMatch = message.content.match(/^\[Tool Result for ([^\]]+)\]/i);
        const toolName = toolMatch ? toolMatch[1] : 'unknown tool';
        return `[Tool Result for ${toolName}: output compressed; ${lineCount} lines omitted]`;
    }
}
