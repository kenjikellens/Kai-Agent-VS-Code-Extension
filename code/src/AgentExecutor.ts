import * as path from 'path';
import * as fs from 'fs';
import { LLMProviderFactory } from './providers/LLMProviderFactory';
import { LMStudioClient } from './LMStudioClient';
import { IHostServices } from './core/IHostServices';
import { Tool, getRegisteredTools } from './tools';
import { ContextManager, ContextMessage } from './ContextManager';
import { EditorContextProvider, EditorContext } from './EditorContextProvider';
import { DiagnosticsHelper } from './tools/DiagnosticsHelper';
import { JsonRepairPipeline } from './core/JsonRepairPipeline';
import { ToolAliasDictionary } from './core/ToolAliasDictionary';
import { Logger } from './services/Logger';

/**
 * AgentExecutor coordinates the autonomous AI agent loop.
 * It manages polymorphic tool execution (file operations, search, terminal commands, diagnostics, AST symbols),
 * formats system prompts, parses tool calls, and reports updates back to the UI.
 */
export class AgentExecutor {
    private workspacePath: string;
    private extensionPath: string;
    private serverUrl: string;
    private temperature: number;
    private onProgress: (event: { type: string; text?: string; tool?: string; query?: string; output?: string; toolId?: string; fileName?: string }) => void;
    private tools: Tool[];
    private contextManager: ContextManager;
    private hostServices?: IHostServices;

    /**
     * Initializes a new instance of the AgentExecutor.
     * @param workspacePath The absolute path to the active workspace directory.
     * @param extensionPath The absolute path to the extension's root directory.
     * @param serverUrl The base API URL for LM Studio / LLM provider.
     * @param temperature The sampling temperature parameter.
     * @param onProgress Callback function to report agent steps and execution logs back to the sidebar.
     */
    constructor(
        workspacePath: string,
        extensionPath: string,
        serverUrl: string,
        temperature: number,
        onProgress: (event: { type: string; text?: string; tool?: string; query?: string; output?: string; toolId?: string; fileName?: string }) => void,
        hostServices?: IHostServices
    ) {
        this.workspacePath = workspacePath;
        this.extensionPath = extensionPath;
        this.serverUrl = serverUrl;
        this.temperature = temperature;
        this.onProgress = onProgress;
        this.tools = getRegisteredTools();
        this.hostServices = hostServices;
        this.contextManager = new ContextManager();
    }

    /**
     * The main execution loop of the agent.
     * Continuously calls the LLM, parses tool calls, executes them polymorphically, feeds results back,
     * and stops when the model decides it has finished.
     * @param userPrompt The instruction or request from the user.
     * @param chatHistory The active message log array.
     * @param model The target model selected in the dropdown.
     * @param signal AbortSignal to cancel HTTP requests.
     * @param activeFile Active text editor file path details (without content).
     * @param thinking Toggle parameter for model reasoning phase.
     * @returns A promise that resolves to the final assistant response.
     */
    public async run(
        userPrompt: string,
        chatHistory: { role: string; content: string }[],
        model: string = 'local-model',
        signal?: any,
        activeFile?: EditorContext | { fileName: string; filePath: string },
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high',
        planningMode: boolean = false,
        attachedFiles?: any[],
        maxContextTokens: number = 16000,
        mode: string = 'agent',
        turnId?: string
    ): Promise<{ reply: string; messages: { role: string; content: string }[]; modifiedFiles: string[]; tokensPerSecond?: string | null }> {
        // Deep copy history to avoid mutating the original until loop is complete
        let messages: ContextMessage[] = [...chatHistory];
        const activeTurnId = turnId || `turn-${Date.now()}`;
        this.contextManager = new ContextManager(maxContextTokens);
        const provider = LLMProviderFactory.getProvider(model, this.serverUrl);
        const useNativeFunctionCalling = Boolean(
            provider.supportsNativeFunctionCalling?.() && provider.chatCompletionStreamWithTools
        );

        this.tools = getRegisteredTools(mode);
        // Find existing system prompt or inject ours at the beginning
        let systemContent = this.getSystemPrompt(mode, useNativeFunctionCalling);
        const now = new Date();
        const currentDayTimeStr = `[Temporal Context & Knowledge Cutoff]\n- Current Date and Time: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}\n- Your internal training cutoff is in the past. Events, releases, and information dated prior to the current date are historical facts, not future speculation.\n- NEVER state that an event, product, or topic prior to the current date is unreleased or speculative based on training cutoff limitations. Use available search tools if current details are required.`;
        systemContent += `\n\n${currentDayTimeStr}\n`;

        const existingSystemIndex = messages.findIndex((m) => m.role === 'system');
        if (existingSystemIndex !== -1) {
            messages[existingSystemIndex] = {
                role: 'system',
                content: systemContent
            };
        } else {
            messages.unshift({
                role: 'system',
                content: systemContent
            });
        }

        // Build workspace root & active file indicator context for first new chat message
        const isFirstMessage = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length === 0;
        let contextPrefix = '';

        if (planningMode || mode === 'planning') {
            contextPrefix += `[STRICT PLANNING MODE ACTIVE]\n`;
            contextPrefix += `You are operating in strict Planning Mode. Follow this protocol strictly:\n`;
            contextPrefix += `1. RESEARCH PHASE: First, inspect the codebase using read-only tools (view_file, list_dir, grep_search) to understand context.\n`;
            contextPrefix += `2. ARTIFACT CREATION: Create a dedicated directory '.kai/artifacts/' in the workspace if it does not exist, and write a comprehensive, structured implementation plan to '.kai/artifacts/implementation_plan.md'.\n`;
            contextPrefix += `3. ARTIFACT FORMATTING: The plan file MUST follow standard markdown headings:\n`;
            contextPrefix += `   # Implementation Plan: [Goal Description]\n`;
            contextPrefix += `   ## User Review Required (highlight critical choices / breaking changes)\n`;
            contextPrefix += `   ## Open Questions\n`;
            contextPrefix += `   ## Proposed Changes (grouped by component with [MODIFY] [NEW] [DELETE] file scheme links)\n`;
            contextPrefix += `   ## Verification Plan (Automated and Manual checks)\n`;
            contextPrefix += `4. CHAT OUTPUT: Enclose the summary in <implementation_plan title="Implementation Plan">...</implementation_plan> tags.\n`;
            contextPrefix += `5. GUARDRAIL: Do NOT make any code modifications or run invasive commands until the user reviews and approves the plan.\n\n`;
        } else if (mode === 'ask') {
            contextPrefix += `[ASK MODE ACTIVE]\n`;
            contextPrefix += `You are in Ask mode. You may inspect workspace files using read-only tools (read_file, list_dir, grep_search, symbol_search) to answer user questions, but do NOT execute write/edit tools or run modifying commands.\n\n`;
        }

        if (isFirstMessage && this.workspacePath && fs.existsSync(this.workspacePath)) {
            try {
                const entries = fs.readdirSync(this.workspacePath, { withFileTypes: true });
                const folders: string[] = [];
                const files: string[] = [];

                for (const entry of entries) {
                    if (entry.name === '.git' || entry.name === 'node_modules') continue;
                    if (entry.isDirectory()) {
                        folders.push(entry.name + '/');
                    } else if (entry.isFile()) {
                        files.push(entry.name);
                    }
                }

                contextPrefix += `[Workspace Root Structure]\n`;
                if (folders.length > 0) {
                    contextPrefix += `Folders: ${folders.join(', ')}\n`;
                }
                if (files.length > 0) {
                    contextPrefix += `Files: ${files.join(', ')}\n`;
                }
            } catch {
                // ignore readdir errors
            }
        }

        if (activeFile) {
            if ('activeFile' in activeFile || 'selection' in activeFile || 'openTabs' in activeFile) {
                const banner = EditorContextProvider.formatContextBanner(activeFile as EditorContext);
                if (banner) {
                    contextPrefix += banner;
                }
            } else if ((activeFile as any).filePath) {
                contextPrefix += `[Active Opened File: ${(activeFile as any).filePath}]\n`;
            }
        }

        if (attachedFiles && attachedFiles.length > 0) {
            for (const file of attachedFiles) {
                contextPrefix += `[Attached File: ${file.relativePath || file.fileName}]\n`;
                if (file.content) {
                    contextPrefix += `\`\`\`\n${file.content}\n\`\`\`\n\n`;
                }
            }
        }

        this.contextManager.configureForModel(model, provider);

        let promptWithContext = userPrompt;
        if (contextPrefix) {
            promptWithContext = `${contextPrefix}\n${userPrompt}`;
        }
        messages.push({ role: 'user', content: promptWithContext });

        let iteration = 0;
        // File analysis/editing often needs several read -> edit -> verify cycles.
        // Keep a safety limit, but do not stop ordinary multi-file tasks at 10 calls.
        const maxIterations = 25;
        let lastAssistantResponse = '';
        const modifiedFiles = new Set<string>();
        let stoppedAtIterationLimit = false;

        const isLocalLM = !model.toLowerCase().startsWith('gemini') && !model.toLowerCase().startsWith('omniroute');
        if (isLocalLM && typeof (provider as any).getLoadedModels === 'function') {
            this.onProgress({ type: 'status_update', text: 'Processing...' });
            try {
                const loaded = await (provider as any).getLoadedModels();
                if (loaded && !loaded.some((m: string) => m.toLowerCase().includes(model.toLowerCase()) || model.toLowerCase().includes(m.toLowerCase()))) {
                    this.onProgress({ type: 'status_update', text: 'Loading model into RAM...' });
                }
            } catch {
                this.onProgress({ type: 'status_update', text: 'Processing...' });
            }
        } else {
            this.onProgress({ type: 'status_update', text: 'Processing...' });
        }

        let parseRetryCount = 0;
        while (iteration < maxIterations) {
            iteration++;
            this.onProgress({ type: 'status_update', text: 'Processing...' });

            let response = '';
            let nativeToolCallId: string | undefined;
            let nativeThoughtSignature: string | undefined;
            let toolCall: { name: string; args: any; query: string } | null;

            if (useNativeFunctionCalling && provider.chatCompletionStreamWithTools) {
                const nativeResult = await provider.chatCompletionStreamWithTools(
                    messages,
                    model,
                    this.temperature,
                    this.getToolSchemas(),
                    (token) => {
                        this.onProgress({ type: 'token', output: token });
                    },
                    signal,
                    thinking,
                    geminiThinkingLevel
                );
                response = nativeResult.text;
                if (nativeResult.type === 'tool_call' && nativeResult.toolCall) {
                    nativeToolCallId = nativeResult.toolCall.id;
                    nativeThoughtSignature = nativeResult.toolCall.thoughtSignature;
                    toolCall = {
                        name: nativeResult.toolCall.name,
                        args: nativeResult.toolCall.args,
                        query: `Native tool call: ${nativeResult.toolCall.name}`
                    };
                } else {
                    toolCall = null;
                }
            } else {
                response = await provider.chatCompletionStream(
                    messages,
                    model,
                    this.temperature,
                    (token) => {
                        this.onProgress({ type: 'token', output: token });
                    },
                    signal,
                    thinking,
                    geminiThinkingLevel
                );
                toolCall = this.parseToolCall(response);
            }
            lastAssistantResponse = response;

            if (!toolCall) {
                const toolCallIntentRegex = /(?:<\|?tool_call\|?>|call:\w+|\{\s*["'](?:type|action|tool|name|path|command|chunks|query)["'])/i;
                if (toolCallIntentRegex.test(response) && parseRetryCount < 2) {
                    parseRetryCount++;
                    messages.push({ role: 'assistant', content: response });
                    messages.push({
                        role: 'user',
                        content: 'System Notice: A tool call was detected in your response, but the JSON payload could not be parsed. Please output a valid JSON tool call with double-quoted keys and properly escaped newlines.'
                    });
                    this.onProgress({
                        type: 'status_update',
                        text: `Retrying tool call syntax (attempt ${parseRetryCount}/2)...`
                    });
                    continue;
                }
                // No tools requested, agent is done
                if (!response.trim()) {
                    this.onProgress({
                        type: 'agent_warning',
                        output: 'The agent stopped because the model returned an empty response.'
                    });
                    lastAssistantResponse = 'The agent stopped because the model returned an empty response.';
                }
                break;
            }

            parseRetryCount = 0;

            // Preserve native call metadata so the provider can associate the tool result
            // with the exact call on the following model turn.
            if (nativeToolCallId) {
                messages.push({
                    role: 'assistant',
                    content: response,
                    tool_calls: [{
                        id: nativeToolCallId,
                        type: 'function',
                        ...(nativeThoughtSignature ? { thoughtSignature: nativeThoughtSignature } : {}),
                        function: {
                            name: toolCall.name,
                            arguments: JSON.stringify(toolCall.args)
                        }
                    }]
                });
            } else {
                messages.push({ role: 'assistant', content: response });
            }
            messages = this.contextManager.compressIfNeeded(messages);

            const activeToolId = `tool-${Date.now()}-${iteration}`;
            const targetName = this.getToolTarget(toolCall.name, toolCall.args);

            // Report the tool invocation to the UI
            this.onProgress({
                type: 'tool_start',
                tool: toolCall.name,
                query: toolCall.query,
                toolId: activeToolId,
                fileName: targetName
            });

            // Yield to the event loop so the webview IPC can flush the tool_start
            // render before we block on the actual tool execution
            await new Promise<void>(resolve => setTimeout(resolve, 0));

            // Execute the tool polymorphically
            let toolResult = '';
            Logger.info(`Executing tool "${toolCall.name}"`, { target: targetName, query: toolCall.query });
            try {
                toolResult = await this.executeTool(toolCall.name, toolCall.args, activeTurnId);
            } catch (err: any) {
                Logger.error(`Tool "${toolCall.name}" execution failed: ${err.message || err}`, err);
                console.error(`[KAI Agent Tool Error] Tool ${toolCall.name} execution failed:`, err);
                toolResult = `[Error executing tool ${toolCall.name}]: ${err.message || err}`;
            }

            if (['write_file', 'edit_file', 'replace_file_content', 'multi_replace_file_content'].includes(toolCall.name) && !toolResult.startsWith('[Error')) {
                if (targetName) {
                    modifiedFiles.add(targetName);
                    const isNewFile = toolCall.name === 'write_file';
                    const diagNote = await DiagnosticsHelper.getPostEditDiagnosticsNote(targetName, this.workspacePath, isNewFile);
                    if (diagNote) {
                        toolResult += diagNote;
                    }
                }
            } else if (toolCall.name === 'delete_item' && !toolResult.startsWith('[Error')) {
                if (targetName) {
                    modifiedFiles.add(targetName);
                }
            }

            // Report results back to the UI
            this.onProgress({
                type: 'tool_end',
                tool: toolCall.name,
                output: toolResult,
                toolId: activeToolId,
                fileName: targetName
            });

            // Feed native results back with their call ID; legacy providers keep the existing text protocol.
            if (nativeToolCallId) {
                messages.push({
                    role: 'tool',
                    name: toolCall.name,
                    tool_call_id: nativeToolCallId,
                    content: toolResult
                });
            } else {
                messages.push({
                    role: 'user',
                    content: `[Tool Result for ${toolCall.name}]:\n${toolResult}\n\nPlease proceed with the next step based on this result.`
                });
            }
            messages = this.contextManager.compressIfNeeded(messages);

            if (iteration >= maxIterations) {
                stoppedAtIterationLimit = true;
            }
        }

        if (stoppedAtIterationLimit) {
            const warning = `The agent stopped after ${maxIterations} tool steps. The latest changes were kept, but verification may be incomplete.`;
            this.onProgress({ type: 'agent_warning', output: warning });
            lastAssistantResponse += `\n\n⚠ ${warning}`;
        }

        // Append the final assistant response to the message history
        messages.push({ role: 'assistant', content: lastAssistantResponse });

        let tokensPerSecond: string | null = null;
        if (provider instanceof LMStudioClient) {
            tokensPerSecond = provider.getLastTokensPerSecond();
        }

        return {
            reply: lastAssistantResponse,
            messages: messages,
            modifiedFiles: Array.from(modifiedFiles),
            tokensPerSecond: tokensPerSecond
        };
    }

    /**
     * Constructs the system prompt by loading the appropriate mode-specific markdown file from prompts/.
     * @param mode Active execution mode ('agent' | 'planning' | 'ask' | 'chat').
     * @param nativeFunctionCalling Whether the provider handles native function schemas.
     * @returns The formatting guide system instructions.
     */
    private getSystemPrompt(
        mode: 'agent' | 'planning' | 'ask' | 'chat' | string = 'agent',
        nativeFunctionCalling: boolean = false
    ): string {
        let fileName = 'system_prompt_agent.md';
        if (mode === 'ask') {
            fileName = 'system_prompt_ask.md';
        } else if (mode === 'planning') {
            fileName = 'system_prompt_planning.md';
        }

        const candidatePaths = [
            path.join(this.extensionPath, 'prompts', fileName),
            path.join(process.cwd(), 'prompts', fileName),
            path.join(__dirname, '..', '..', 'prompts', fileName),
            path.join(__dirname, 'prompts', fileName),
            path.join(this.extensionPath, fileName),
            path.join(process.cwd(), fileName),
            // Fallbacks
            path.join(this.extensionPath, 'prompts', 'system_prompt.md'),
            path.join(process.cwd(), 'prompts', 'system_prompt.md'),
            path.join(this.extensionPath, 'system_prompt.md'),
            path.join(process.cwd(), 'system_prompt.md')
        ];

        for (const promptPath of candidatePaths) {
            try {
                if (fs.existsSync(promptPath)) {
                    const prompt = fs.readFileSync(promptPath, 'utf8');
                    return nativeFunctionCalling ? this.getNativeFunctionCallingPrompt(prompt) : prompt;
                }
            } catch {
                // ignore
            }
        }

        return `You are Kai, an autonomous AI Developer Agent operating directly within the user's workspace directory. You have full access to view, list, search, and edit the workspace using tools.`;
    }

    /**
     * Removes text-protocol instructions when providers receive native tool schemas separately.
     * @param prompt The base system prompt string.
     * @returns Cleaned system prompt for native function calling.
     */
    private getNativeFunctionCallingPrompt(prompt: string): string {
        return prompt
            .replace(
                'output a concise explanation followed by exactly ONE tool call enclosed inside `<|tool_call|>` tags per turn.',
                'execute actions using the provided native function tools. Make at most one function call per turn.'
            )
            .replace(
                'Execute actions by outputting exactly ONE tool call enclosed inside `<|tool_call|>` tags per turn.',
                'execute actions using the provided native function tools. Make at most one function call per turn.'
            )
            .replace(/\n## RESPONSE FORMAT[\s\S]*?\n## CORE OPERATIONAL RULES/, '\n## CORE OPERATIONAL RULES')
            .replace(/\n## ACTION SCHEMAS[\s\S]*?\n## JSON ESCAPING RULES/, '\n## JSON ESCAPING RULES');
    }

    /** Returns the native function declarations for all registered tools. */
    private getToolSchemas() {
        return this.tools.map((tool) => tool.getFunctionDeclaration());
    }

    /**
     * Parses the assistant's reply text to extract the first JSON tool call.
     * @param text The model's response.
     * @returns An object representing the tool call name, args, and a readable query, or null if none found.
     */
    private parseToolCall(text: string): { name: string; args: any; query: string } | null {
        // 1. Primary: Extract tool call payload enclosed in <|tool_call|> ... <|tool_call|> or <tool_call> ... </tool_call> tags
        const explicitTagRegex = /<\|?tool_call\|?>\s*([\s\S]*?)\s*(?:<\|?\/tool_call\|?>|<\|?tool_call\|?>|$)/i;
        const explicitTagMatch = explicitTagRegex.exec(text);
        if (explicitTagMatch) {
            const parsed = this.parseJsonString(explicitTagMatch[1]);
            if (parsed) return parsed;
        }

        // 2. Secondary: Regex to extract tool call JSON payload surrounded by optional call:name or loose tags
        const tagRegex = /(?:<\|?tool_call\|?>)?\s*(?:call:\w+)?\s*(\{[\s\S]*?\})\s*(?:<\|?tool_call\|?>)?/i;
        const tagMatch = tagRegex.exec(text);
        if (tagMatch) {
            const parsed = this.parseJsonString(tagMatch[1]);
            if (parsed) return parsed;
        }

        // 3. Fallback: Extract JSON block inside ```json ... ``` code fences
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*(?:```|$)/i;
        const match = jsonBlockRegex.exec(text);
        if (match) {
            const parsed = this.parseJsonString(match[1]);
            if (parsed) return parsed;
        }

        // 4. Fallback: Try extracting using brace counting starting at any JSON object containing known keys
        const braceJson = this.extractJsonBlock(text);
        if (braceJson) {
            const parsed = this.parseJsonString(braceJson);
            if (parsed) return parsed;
        }

        return null;
    }

    /**
     * Extracts the first JSON object string starting with known tool keys using brace counting.
     */
    private extractJsonBlock(text: string): string | null {
        let startIndex = -1;
        const typeRegex = /\{\s*["'](?:type|path|command|chunks|query|action|tool|name)["']/g;
        let match;
        while ((match = typeRegex.exec(text)) !== null) {
            startIndex = match.index;
            break;
        }
        if (startIndex === -1) {
            return null;
        }

        let braceCount = 0;
        let inString = false;
        let escape = false;
        for (let i = startIndex; i < text.length; i++) {
            const char = text[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (char === '\\') {
                escape = true;
                continue;
            }
            if (char === '"') {
                inString = !inString;
                continue;
            }
            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        return text.substring(startIndex, i + 1);
                    }
                }
            }
        }
        return null;
    }

    /**
     * Polymorphically matches JSON payload with registered Tool instances.
     * Auto-infers tool type from payload schema if "type" field is omitted by the model.
     */
    private parseJsonString(jsonStr: string): { name: string; args: any; query: string } | null {
        const repairResult = JsonRepairPipeline.parseWithRepair(jsonStr);
        if (!repairResult || !repairResult.parsed || typeof repairResult.parsed !== 'object') {
            return null;
        }

        const parsed = repairResult.parsed;
        let type = parsed.type || parsed.action || parsed.tool || parsed.name || parsed.function;
        if (!type) {
            type = ToolAliasDictionary.inferToolType(parsed);
        }

        if (type && typeof type === 'string') {
            const canonicalName = ToolAliasDictionary.resolveToolName(type);
            const matchedTool = this.tools.find(t => t.name.toLowerCase() === canonicalName.toLowerCase());
            if (matchedTool) {
                const args = { ...parsed };
                delete args.type;
                delete args.action;
                delete args.tool;
                delete args.name;
                delete args.function;

                const normalizedArgs = ToolAliasDictionary.normalizeArgs(args);

                let query = `Executing ${matchedTool.name}`;
                if (normalizedArgs.path) query = `${matchedTool.name}: ${Array.isArray(normalizedArgs.path) ? normalizedArgs.path.join(', ') : normalizedArgs.path}`;
                else if (normalizedArgs.paths) query = `${matchedTool.name}: ${Array.isArray(normalizedArgs.paths) ? normalizedArgs.paths.join(', ') : normalizedArgs.paths}`;
                else if (normalizedArgs.command) query = `${matchedTool.name}: ${normalizedArgs.command}`;
                else if (normalizedArgs.query) query = `${matchedTool.name}: ${normalizedArgs.query}`;
                else if (normalizedArgs.url) query = `${matchedTool.name}: ${normalizedArgs.url}`;
                else if (normalizedArgs.question) query = `${matchedTool.name}: ${normalizedArgs.question}`;

                return { name: matchedTool.name, args: normalizedArgs, query };
            }
        }

        return null;
    }

    /**
     * Executes the requested tool polymorphically via Tool interface.
     * @param tool The name of the tool.
     * @param args The arguments object parsed from the JSON blocks.
     * @returns A promise resolving to the execution result text.
     */
    private async executeTool(tool: string, args: any, turnId?: string): Promise<string> {
        const matchedTool = this.tools.find((t) => t.name === tool);
        if (!matchedTool) {
            throw new Error(`Unknown tool: ${tool}`);
        }

        let result = await matchedTool.execute(args, {
            workspacePath: this.workspacePath,
            extensionPath: this.extensionPath,
            turnId: turnId,
            hostServices: this.hostServices
        });
        const absoluteMaxBytes = 10000;
        if (Buffer.byteLength(result, 'utf8') > absoluteMaxBytes) {
            result = this.truncateToolOutput(result, absoluteMaxBytes);
        }
        return result;
    }

    /** Applies a final size guard for tools that do not enforce their own output limits. */
    private truncateToolOutput(output: string, maxBytes: number): string {
        const lines = output.split('\n');
        const marker = `\n\n... [AgentExecutor: output truncated from ${lines.length} lines] ...\n\n`;
        const availableBytes = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
        const head = lines.slice(0, 60).join('\n');
        const tail = lines.slice(-30).join('\n');
        const combined = `${head}${marker}${tail}`;

        if (Buffer.byteLength(combined, 'utf8') <= maxBytes) {
            return combined;
        }

        return `${Buffer.from(combined, 'utf8').subarray(0, availableBytes).toString('utf8')}${marker.trimEnd()}`;
    }

    /**
     * Extracts the target file basename or command name for compact UI representation.
     */
    private getToolTarget(tool: string, args: any): string {
        if (tool === 'ask_user') {
            return args.question || '';
        }
        if (tool === 'web_search') {
            return args.query ? `"${args.query}"` : '';
        }
        if (tool === 'run_command') {
            return args.command || '';
        }
        if (args.paths && Array.isArray(args.paths)) {
            return args.paths.map((p: string) => path.basename(p)).join(', ');
        }
        if (args.path) {
            return Array.isArray(args.path) ? args.path.map((p: string) => path.basename(p)).join(', ') : path.basename(args.path);
        }
        if (args.url) {
            return args.url;
        }
        return '';
    }
}
