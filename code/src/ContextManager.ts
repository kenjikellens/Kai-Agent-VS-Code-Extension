import type { ChatMessage } from './providers/ILLMProvider';

/** A chat message exchanged during an agent run. */
export interface ContextMessage extends ChatMessage {}

/** Represents an indivisible group of assistant tool call(s) and matching tool response(s). */
export interface AtomicToolGroup {
    assistantIndex: number;
    toolIndices: number[];
}

/**
 * Keeps the agent conversation within a dynamic, model-aware context budget.
 * Enforces atomic pairing between assistant tool calls and provider tool results to prevent HTTP 400 schema errors.
 */
export class ContextManager {
    private maxTokens: number;
    private reservedTokens: number;

    /**
     * Initializes ContextManager with token budget limits.
     * @param maxTokens Maximum total tokens allowed.
     * @param reservedTokens Token headroom reserved for completions.
     */
    constructor(maxTokens: number = 16000, reservedTokens: number = 4000) {
        this.maxTokens = maxTokens;
        this.reservedTokens = reservedTokens;
    }

    /**
     * Dynamically determines token context limits by inspecting model identifiers and runtime provider metadata.
     * Queries model configurations in memory without mutating file systems or DOM elements.
     * @param model Model identifier string.
     * @param provider Optional active provider instance or metadata object.
     * @returns Maximum context tokens available for the model.
     */
    public static resolveModelContextLimit(model: string, provider?: any): number {
        if (!model) return 16000;
        const clean = model.toLowerCase();

        // 1. Gemini Models: 1,000,000 tokens
        if (clean.startsWith('gemini')) {
            return 1000000;
        }

        // 2. Specific Cloud Providers
        if (clean.includes('mistral-large') || clean.includes('codestral')) {
            return 128000;
        }
        if (clean.includes('mistral-small')) {
            return 32000;
        }
        if (clean.includes('cerebras')) {
            return 8192;
        }

        // 3. Local GGUF / Ollama Manifest limits from provider if available
        if (provider) {
            if (typeof provider.getContextLength === 'function') {
                const limit = provider.getContextLength(model);
                if (typeof limit === 'number' && limit > 0) return limit;
            }
            if (typeof provider.contextWindow === 'number' && provider.contextWindow > 0) {
                return provider.contextWindow;
            }
        }

        // Safe fallback for standard local models
        return 16000;
    }

    /**
     * Updates the active token budget dynamically for the current model.
     * @param model Model identifier string.
     * @param provider Optional active provider instance.
     */
    public configureForModel(model: string, provider?: any): void {
        const discoveredLimit = ContextManager.resolveModelContextLimit(model, provider);
        this.maxTokens = discoveredLimit;
        // Allocate 20% headroom for output, capped at 8000 tokens
        this.reservedTokens = Math.min(8000, Math.max(2000, Math.floor(discoveredLimit * 0.2)));
    }

    /** Estimates tokens using a conservative four-characters-per-token heuristic. */
    public estimateTokens(text: string): number {
        return Math.ceil((text || '').length / 4);
    }

    /** Returns the estimated token count for a complete message history. */
    public getTotalTokens(messages: ContextMessage[]): number {
        return messages.reduce((total, message) => {
            let msgTokens = this.estimateTokens(message.content);
            if (Array.isArray(message.tool_calls)) {
                for (const tc of message.tool_calls) {
                    msgTokens += this.estimateTokens(JSON.stringify(tc));
                }
            }
            return total + msgTokens;
        }, 0);
    }

    /**
     * Identifies atomic groups of assistant tool calls and corresponding tool response messages.
     * Ensures assistant call and matching tool results are never separated during compaction.
     * @param messages Array of context messages.
     * @returns Array of AtomicToolGroup descriptors.
     */
    public identifyAtomicToolGroups(messages: ContextMessage[]): AtomicToolGroup[] {
        const groups: AtomicToolGroup[] = [];

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                const callIds = new Set(msg.tool_calls.map(tc => tc.id).filter(Boolean));
                const toolIndices: number[] = [];

                // Scan subsequent messages for matching tool_call_id
                for (let j = i + 1; j < messages.length; j++) {
                    const subMsg = messages[j];
                    if (subMsg.role === 'tool' && subMsg.tool_call_id && callIds.has(subMsg.tool_call_id)) {
                        toolIndices.push(j);
                    } else if (subMsg.role === 'assistant') {
                        // Reached next assistant turn
                        break;
                    }
                }

                if (toolIndices.length > 0) {
                    groups.push({ assistantIndex: i, toolIndices });
                }
            }
        }

        return groups;
    }

    /**
     * Compresses older messages using head-tail windowing while preserving atomic tool-pair structural grammar.
     * Prevents HTTP 400 provider rejections by retaining call IDs and system anchors.
     * @param messages Array of chat messages.
     * @returns Compacted array of messages fitting the target token budget.
     */
    public compressIfNeeded(messages: ContextMessage[]): ContextMessage[] {
        const targetTokens = Math.max(0, this.maxTokens - this.reservedTokens);
        if (this.getTotalTokens(messages) <= targetTokens) {
            return messages;
        }

        const protectedIndexes = this.getProtectedIndexes(messages);

        // Pass 1: Apply head-tail windowing to non-protected tool outputs (keep 20 head, 20 tail lines)
        const compressed = messages.map((message, index) => {
            if (protectedIndexes.has(index)) {
                return message;
            }

            return {
                ...message,
                content: this.createHeadTailSummary(message, 20, 20)
            };
        });

        if (this.getTotalTokens(compressed) <= targetTokens) {
            return compressed;
        }

        // Pass 2: Under heavier budget pressure, compact tool outputs further (5 head, 5 tail lines)
        return compressed.map((message, index) => {
            if (protectedIndexes.has(index)) {
                return message;
            }

            return {
                ...message,
                content: this.createHeadTailSummary(message, 5, 5)
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

        // Keep the most recent 3 messages untouched
        for (let index = Math.max(0, messages.length - 3); index < messages.length; index++) {
            protectedIndexes.add(index);
        }

        return protectedIndexes;
    }

    /**
     * Compresses message content using head-tail windowing, retaining anchors and omitting large middle sections.
     * @param message Message to compress.
     * @param headCount Number of leading lines to retain.
     * @param tailCount Number of trailing lines to retain.
     * @returns Truncated content string with omission summary.
     */
    private createHeadTailSummary(message: ContextMessage, headCount: number, tailCount: number): string {
        const lines = (message.content || '').split(/\r?\n/);
        const threshold = headCount + tailCount + 5;

        if (lines.length <= threshold) {
            return message.content;
        }

        const head = lines.slice(0, headCount).join('\n');
        const tail = lines.slice(lines.length - tailCount).join('\n');
        const omittedCount = lines.length - headCount - tailCount;

        return `${head}\n\n[... ${omittedCount} lines omitted for context window optimization ...]\n\n${tail}`;
    }
}
