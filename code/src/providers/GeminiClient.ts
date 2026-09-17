import * as https from 'https';
import * as vscode from 'vscode';
import { ChatMessage, ILLMProvider, NativeToolCallResult } from './ILLMProvider';
import { FunctionDeclaration } from '../tools/Tool';
import { buildGeminiThinkingConfig } from './GeminiThinkingConfig';
import { toGeminiSchema } from './GeminiSchema';

/**
 * GeminiClient handles API communication directly with Google Gemini REST endpoints.
 */
export class GeminiClient implements ILLMProvider {
    private apiKey: string;

    /**
     * Initializes GeminiClient instance with target API key or workspace setting.
     * @param apiKey Optional explicit API key.
     */
    constructor(apiKey?: string) {
        const config = vscode.workspace.getConfiguration('kai');
        this.apiKey = apiKey || config.get<string>('apiKey') || process.env.GEMINI_API_KEY || '';
    }

    /** Gemini receives tool declarations and returns structured functionCall parts. */
    public supportsNativeFunctionCalling(): boolean {
        return true;
    }

    /**
     * Retrieves the supported model IDs for Gemini API.
     * @returns A promise resolving to an array of model ID strings.
     */
    public async getModels(): Promise<string[]> {
        return [
            'gemini-3.8-flash',
            'gemini-3.7-flash',
            'gemini-3.6-flash',
            'gemini-3.5-flash',
            'gemini-3.5-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
            'gemini-3.1-flash-lite'
        ];
    }

    /**
     * Validates if the given Gemini API key is valid via a lightweight ping.
     * @param apiKey Optional explicit API key to test.
     * @returns Promise resolving to true if valid, false otherwise.
     */
    public async validateApiKey(apiKey?: string): Promise<boolean> {
        const key = apiKey || this.apiKey;
        if (!key || key.trim() === '') {
            return false;
        }

        return new Promise<boolean>((resolve) => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key.trim())}`;
            try {
                const req = https.get(url, { timeout: 2500 }, (res) => {
                    resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300));
                });
                req.on('error', () => resolve(false));
                req.on('timeout', () => {
                    req.destroy();
                    resolve(false);
                });
            } catch {
                resolve(false);
            }
        });
    }

    /**
     * Executes non-streaming chat completion with Gemini API.
     */
    public async chatCompletion(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number = 0.7,
        signal?: any,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high'
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const apiKey = this.apiKey;
            if (!apiKey) {
                reject(new Error('Gemini API key is not configured in settings. Please add your API key.'));
                return;
            }

            const modelParam = model || 'gemini-3.1-flash-lite';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelParam}:generateContent?key=${apiKey}`;

            const contents = this.toGeminiContents(messages as ChatMessage[]);

            const systemMsg = messages.find(m => m.role === 'system');
            const systemInstruction = systemMsg ? {
                parts: [{ text: systemMsg.content }]
            } : undefined;

            const requestBody: any = {
                contents: contents,
                generationConfig: {
                    temperature: temperature,
                    thinkingConfig: buildGeminiThinkingConfig(modelParam, thinking, geminiThinkingLevel)
                }
            };

            if (systemInstruction) {
                requestBody.systemInstruction = systemInstruction;
            }

            const payload = JSON.stringify(requestBody);

            try {
                const parsedUrl = new URL(url);
                const options: https.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'POST',
                    signal: signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', (d) => data += d);
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.candidates && parsed.candidates[0].content && parsed.candidates[0].content.parts) {
                                    const parts = parsed.candidates[0].content.parts;
                                    let fullText = '';
                                    let inThinking = false;
                                    for (const part of parts) {
                                        if (part.thought === true && part.text) {
                                            if (!inThinking) {
                                                fullText += '<think>';
                                                inThinking = true;
                                            }
                                            fullText += part.text;
                                        } else if (part.text) {
                                            if (inThinking) {
                                                fullText += '</think>';
                                                inThinking = false;
                                            }
                                            fullText += part.text;
                                        }
                                    }
                                    if (inThinking) fullText += '</think>';
                                    resolve(fullText);
                                } else {
                                    reject(new Error('Invalid response structure from Gemini API'));
                                }
                            } catch {
                                reject(new Error('Failed to parse Gemini response JSON'));
                            }
                        } else {
                            reject(this.createGeminiHttpError(res.statusCode, data));
                        }
                    });
                });

                req.on('error', (err) => reject(err));
                req.write(payload);
                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Executes streaming chat completion with Gemini API.
     */
    public async chatCompletionStream(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        onToken: (token: string) => void,
        signal?: any,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high'
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const apiKey = this.apiKey;
            if (!apiKey) {
                reject(new Error('Gemini API key is not configured in settings. Please add your API key.'));
                return;
            }

            const modelParam = model || 'gemini-3.1-flash-lite';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelParam}:streamGenerateContent?key=${apiKey}`;

            const contents = this.toGeminiContents(messages as ChatMessage[]);

            const systemMsg = messages.find(m => m.role === 'system');
            const systemInstruction = systemMsg ? {
                parts: [{ text: systemMsg.content }]
            } : undefined;

            const generationConfig: any = {
                temperature: temperature,
                thinkingConfig: buildGeminiThinkingConfig(modelParam, thinking, geminiThinkingLevel)
            };

            const requestBody: any = {
                contents: contents,
                generationConfig: generationConfig
            };

            if (systemInstruction) {
                requestBody.systemInstruction = systemInstruction;
            }

            const payload = JSON.stringify(requestBody);

            try {
                const parsedUrl = new URL(url);
                const options: https.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'POST',
                    signal: signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };

                const req = https.request(options, (res) => {
                    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                        let errData = '';
                        res.on('data', (d) => errData += d);
                        res.on('end', () => {
                            reject(this.createGeminiHttpError(res.statusCode, errData));
                        });
                        return;
                    }

                    let buffer = '';
                    let fullText = '';
                    let inThinking = false;

                    res.on('data', (chunk) => {
                        buffer += chunk.toString();
                        let startIdx = 0;
                        while (true) {
                            const openBrace = buffer.indexOf('{', startIdx);
                            if (openBrace === -1) break;

                            let depth = 0;
                            let foundMatch = false;
                            let endBrace = -1;
                            let inString = false;
                            let escape = false;

                            for (let i = openBrace; i < buffer.length; i++) {
                                const char = buffer[i];
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
                                    if (char === '{') depth++;
                                    else if (char === '}') {
                                        depth--;
                                        if (depth === 0) {
                                            foundMatch = true;
                                            endBrace = i;
                                            break;
                                        }
                                    }
                                }
                            }

                            if (foundMatch && endBrace !== -1) {
                                const jsonStr = buffer.slice(openBrace, endBrace + 1);
                                try {
                                    const parsed = JSON.parse(jsonStr);
                                    if (parsed.candidates && parsed.candidates[0].content && parsed.candidates[0].content.parts) {
                                        const parts = parsed.candidates[0].content.parts;
                                        for (const part of parts) {
                                            if (part.thought === true && part.text) {
                                                let text = '';
                                                if (!inThinking) {
                                                    text += '<think>';
                                                    inThinking = true;
                                                }
                                                text += part.text;
                                                fullText += text;
                                                onToken(text);
                                            } else if (part.text) {
                                                let text = '';
                                                if (inThinking) {
                                                    text += '</think>';
                                                    inThinking = false;
                                                }
                                                text += part.text;
                                                fullText += text;
                                                onToken(text);
                                            }
                                        }
                                    }
                                } catch {
                                    // ignore parse errors for partial objects
                                }
                                buffer = buffer.slice(endBrace + 1);
                                startIdx = 0;
                            } else {
                                break;
                            }
                        }
                    });

                    res.on('end', () => {
                        if (inThinking) {
                            fullText += '</think>';
                            onToken('</think>');
                            inThinking = false;
                        }
                        resolve(fullText);
                    });
                });

                req.on('error', (err) => reject(err));
                req.write(payload);
                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    /** Streams a Gemini GenerateContent response with native function declarations. */
    public async chatCompletionStreamWithTools(
        messages: ChatMessage[],
        model: string,
        temperature: number,
        tools: FunctionDeclaration[],
        onToken: (token: string) => void,
        signal?: any,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high'
    ): Promise<NativeToolCallResult> {
        return new Promise((resolve, reject) => {
            const apiKey = this.apiKey;
            if (!apiKey) {
                reject(new Error('Gemini API key is not configured in settings. Please add your API key.'));
                return;
            }

            const modelParam = model || 'gemini-3.1-flash-lite';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelParam}:streamGenerateContent?key=${apiKey}`;
            const requestBody: any = {
                contents: this.toGeminiContents(messages),
                generationConfig: {
                    temperature,
                    thinkingConfig: buildGeminiThinkingConfig(modelParam, thinking, geminiThinkingLevel)
                },
                tools: [{
                    functionDeclarations: tools.map((tool) => ({
                        name: tool.function.name,
                        description: tool.function.description,
                        parameters: toGeminiSchema(tool.function.parameters)
                    }))
                }],
                toolConfig: {
                    functionCallingConfig: { mode: 'AUTO' }
                }
            };
            const systemInstruction = this.getSystemInstruction(messages);
            if (systemInstruction) {
                requestBody.systemInstruction = systemInstruction;
            }
            const payload = JSON.stringify(requestBody);

            try {
                const parsedUrl = new URL(url);
                const options: https.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'POST',
                    signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };

                const req = https.request(options, (res) => {
                    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                        let errData = '';
                        res.on('data', (chunk) => { errData += chunk; });
                        res.on('end', () => {
                            reject(this.createGeminiHttpError(res.statusCode, errData));
                        });
                        return;
                    }

                    let buffer = '';
                    let fullText = '';
                    let inThinking = false;
                    const toolCalls = new Map<string, { id: string; name: string; args: Record<string, any>; thoughtSignature?: string }>();

                    const processResponse = (parsed: any) => {
                        const parts = parsed.candidates?.[0]?.content?.parts || [];
                        for (const part of parts) {
                            if (part.thought === true && part.text) {
                                const text = `${inThinking ? '' : '<think>'}${part.text}`;
                                inThinking = true;
                                fullText += text;
                                onToken(text);
                            } else if (part.text) {
                                const text = `${inThinking ? '</think>' : ''}${part.text}`;
                                inThinking = false;
                                fullText += text;
                                onToken(text);
                            } else if (part.functionCall) {
                                const functionCall = part.functionCall;
                                const id = functionCall.id || `gemini_call_${toolCalls.size}`;
                                toolCalls.set(id, {
                                    id,
                                    name: functionCall.name,
                                    args: functionCall.args || {},
                                    thoughtSignature: part.thoughtSignature || part.thought_signature || functionCall.thoughtSignature
                                });
                            }
                        }
                    };

                    res.on('data', (chunk) => {
                        buffer += chunk.toString();
                        while (true) {
                            const openBrace = buffer.indexOf('{');
                            if (openBrace === -1) return;
                            let depth = 0;
                            let inString = false;
                            let escaped = false;
                            let endBrace = -1;
                            for (let index = openBrace; index < buffer.length; index++) {
                                const character = buffer[index];
                                if (escaped) {
                                    escaped = false;
                                } else if (character === '\\') {
                                    escaped = true;
                                } else if (character === '"') {
                                    inString = !inString;
                                } else if (!inString && character === '{') {
                                    depth++;
                                } else if (!inString && character === '}') {
                                    depth--;
                                    if (depth === 0) {
                                        endBrace = index;
                                        break;
                                    }
                                }
                            }
                            if (endBrace === -1) return;
                            try {
                                processResponse(JSON.parse(buffer.slice(openBrace, endBrace + 1)));
                            } catch {
                                // Ignore malformed chunks; the next complete response can still be processed.
                            }
                            buffer = buffer.slice(endBrace + 1);
                        }
                    });

                    res.on('end', () => {
                        if (inThinking) {
                            fullText += '</think>';
                            onToken('</think>');
                        }
                        if (toolCalls.size > 1) {
                            reject(new Error('Gemini returned multiple tool calls; multi-tool execution is not supported yet.'));
                            return;
                        }
                        const toolCall = toolCalls.values().next().value as { id: string; name: string; args: Record<string, any>; thoughtSignature?: string } | undefined;
                        resolve(toolCall ? { type: 'tool_call', text: fullText, toolCall } : { type: 'text', text: fullText });
                    });
                });

                req.on('error', reject);
                req.write(payload);
                req.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    private toGeminiContents(messages: ChatMessage[]): any[] {
        const raw = messages
            .filter((message) => message.role !== 'system')
            .map((message) => {
                if (message.role === 'assistant') {
                    const parts: any[] = [];
                    if (message.content) {
                        parts.push({ text: message.content });
                    }
                    for (const toolCall of message.tool_calls || []) {
                        parts.push({
                            functionCall: {
                                id: toolCall.id,
                                name: toolCall.function.name,
                                args: JSON.parse(toolCall.function.arguments || '{}')
                            },
                            ...(toolCall.thoughtSignature ? { thoughtSignature: toolCall.thoughtSignature } : {})
                        });
                    }
                    return { role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] };
                }

                if (message.role === 'tool') {
                    return {
                        role: 'user',
                        parts: [{
                            functionResponse: {
                                id: message.tool_call_id,
                                name: message.name,
                                response: { result: message.content }
                            }
                        }]
                    };
                }

                return { role: 'user', parts: [{ text: message.content || '' }] };
            });

        const collapsed: any[] = [];
        for (const item of raw) {
            if (collapsed.length > 0 && collapsed[collapsed.length - 1].role === item.role) {
                collapsed[collapsed.length - 1].parts.push(...item.parts);
            } else {
                collapsed.push(item);
            }
        }
        return collapsed;
    }

    private createGeminiHttpError(statusCode: number | undefined, responseBody: string): Error {
        try {
            const parsed = JSON.parse(responseBody);
            const message = parsed.error?.message || parsed.message;
            if (message) return new Error(`Gemini HTTP ${statusCode}: ${message}`);
        } catch {
            // Fall through to a bounded raw response for non-JSON proxy errors.
        }
        const detail = responseBody.trim().replace(/\s+/g, ' ').slice(0, 500);
        return new Error(`Gemini HTTP ${statusCode}${detail ? `: ${detail}` : ''}`);
    }

    private getSystemInstruction(messages: ChatMessage[]): { parts: { text: string }[] } | undefined {
        const systemMessage = messages.find((message) => message.role === 'system');
        return systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined;
    }
}
