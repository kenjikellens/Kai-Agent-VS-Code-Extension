import * as http from 'http';
import { IHostServices } from './core/IHostServices';
import { HttpClient } from './HttpClient';
import { ILLMProvider } from './providers/ILLMProvider';
import { GeminiClient } from './providers/GeminiClient';
import { FreeProviderClient, FREE_PROVIDERS, FreeProvider } from './providers/FreeProviderClient';
import { MuseGlimmerStreamParser } from './providers/MuseGlimmerStreamParser';
import { LMStudioReasoningEngine } from './providers/LMStudioReasoningEngine';
import { LMStudioManifestParser } from './providers/LMStudioManifestParser';

export { FreeProvider, FREE_PROVIDERS };

/**
 * LMStudioClient handles communication with the locally running LM Studio HTTP API server.
 * Uses IHostServices for configuration retrieval, ensuring platform neutrality across VS Code and Standalone Desktop.
 */
export class LMStudioClient implements ILLMProvider {
    /** Local models retain the existing text-based tool-call protocol. */
    public supportsNativeFunctionCalling(): boolean {
        return false;
    }
    private hostServices?: IHostServices;
    private serverUrl: string;
    private apiKey: string;
    private geminiClient: GeminiClient;
    private freeProviderClient: FreeProviderClient;

    /**
     * Initializes a new instance of LMStudioClient.
     * @param serverUrl Base API URL of LM Studio.
     * @param apiKey Optional API key.
     * @param hostServices Optional host services adapter for settings retrieval.
     */
    constructor(serverUrl?: string, apiKey?: string, hostServices?: IHostServices) {
        this.hostServices = hostServices;
        const configuredUrl = this.hostServices?.getConfiguration<string>('kai', 'serverUrl');
        const configuredKey = this.hostServices?.getConfiguration<string>('kai', 'apiKey');
        this.serverUrl = serverUrl || configuredUrl || 'http://localhost:1234/v1';
        this.apiKey = apiKey || configuredKey || process.env.GEMINI_API_KEY || '';
        this.geminiClient = new GeminiClient(this.apiKey);
        this.freeProviderClient = new FreeProviderClient();
        this._lastTokensPerSecond = null;
    }

    private _lastTokensPerSecond: string | null = null;

    /**
     * Gets the generation speed (tokens per second) from the last local stream.
     * @returns Speed string (e.g. '34.2 tok/s') or null if not applicable.
     */
    public getLastTokensPerSecond(): string | null {
        return this._lastTokensPerSecond;
    }

    /**
     * Parses the server URL into hostname, port, and path prefix.
     */
    private parseServerUrl(): { hostname: string; port: number; pathPrefix: string } {
        try {
            let url = (this.serverUrl || 'http://localhost:1234/v1').trim();
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'http://' + url;
            }
            const parsed = new URL(url);
            let pathPrefix = parsed.pathname.replace(/\/$/, '');
            if (!pathPrefix) {
                pathPrefix = '/v1';
            }
            return {
                hostname: parsed.hostname || '127.0.0.1',
                port: parsed.port ? parseInt(parsed.port, 10) : 1234,
                pathPrefix: pathPrefix
            };
        } catch {
            return { hostname: '127.0.0.1', port: 1234, pathPrefix: '/v1' };
        }
    }

    /**
     * Retrieves all available models across local LM Studio, Gemini, and free providers.
     * @returns Array of model ID strings.
     */
    public async getModels(): Promise<string[]> {
        const lmModels = await this.getLMStudioModels().catch(() => []);
        const geminiModels = await this.geminiClient.getModels().catch(() => []);
        const freeProviderModels = await this.freeProviderClient.getModels().catch(() => []);
        const omniModels = await this.getOmniRouteModels().catch(() => []);
        const combined = new Set([...lmModels, ...geminiModels, ...freeProviderModels, ...omniModels]);
        return Array.from(combined);
    }

    /**
     * Returns OmniRoute model list.
     */
    public async getOmniRouteModels(): Promise<string[]> {
        return ['omniroute/auto'];
    }

    /**
     * Returns list of free provider models.
     */
    public getFreeProviderModels(): string[] {
        return FREE_PROVIDERS.flatMap(p => p.models);
    }

    /**
     * Fetches local LM Studio models via HTTP GET /models with IPv4 and path fallbacks.
     */
    public async getLMStudioModels(): Promise<string[]> {
        const { hostname, port, pathPrefix } = this.parseServerUrl();
        const urlsToTry = [
            `http://${hostname}:${port}${pathPrefix}/models`,
            `http://${hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${port}${pathPrefix}/models`,
            `http://${hostname}:${port}/v1/models`,
            `http://${hostname}:${port}/api/v0/models`,
            `http://${hostname}:${port}/models`,
            `http://127.0.0.1:${port || 1234}/v1/models`,
            `http://127.0.0.1:${port || 1234}/api/v0/models`,
            `http://127.0.0.1:${port || 1234}/models`,
            `http://localhost:${port || 1234}/v1/models`,
            `http://localhost:${port || 1234}/api/v0/models`,
            `http://localhost:${port || 1234}/models`
        ];

        const uniqueUrls = Array.from(new Set(urlsToTry));

        const probePromises = uniqueUrls.map(url => HttpClient.getJson<{ data: any[] }>(url, {}, 800));
        const results = await Promise.allSettled(probePromises);

        const allDiscoveredIds: string[] = [];
        for (const res of results) {
            if (res.status === 'fulfilled' && res.value && Array.isArray(res.value.data) && res.value.data.length > 0) {
                const allIds = res.value.data.map((m: any) => m.id || m.name).filter(Boolean);
                allDiscoveredIds.push(...allIds);
            }
        }

        const filtered = LMStudioReasoningEngine.filterChatModels(allDiscoveredIds);
        const seen = new Set<string>();
        const uniqueModels: string[] = [];
        for (const id of filtered) {
            const lower = id.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                uniqueModels.push(id);
            }
        }
        return uniqueModels;
    }

    /**
     * Fetches models currently loaded in LM Studio or Gemini.
     * Only returns models that are actively loaded in memory (state === 'loaded' or active in lms ps).
     */
    public async getLoadedModels(): Promise<string[]> {
        // 1. Try local lms CLI ps command
        const localLoaded = await this.getLocalLoadedModels().catch(() => []);
        if (localLoaded.length > 0) {
            return localLoaded;
        }

        // 2. Try LM Studio api/v0/models endpoint for models with state === 'loaded'
        const { hostname, port } = this.parseServerUrl();
        const urlsToTry = [
            `http://${hostname}:${port}/api/v0/models`,
            `http://${hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${port}/api/v0/models`,
            `http://127.0.0.1:${port || 1234}/api/v0/models`,
            `http://localhost:${port || 1234}/api/v0/models`
        ];

        for (const url of Array.from(new Set(urlsToTry))) {
            try {
                const res = await HttpClient.getJson<{ data: any[] }>(url, {}, 800);
                if (res && Array.isArray(res.data)) {
                    const loadedIds = res.data
                        .filter((m: any) => m && m.state === 'loaded')
                        .map((m: any) => m.id || m.name);
                    const filtered = LMStudioReasoningEngine.filterChatModels(loadedIds);
                    if (filtered.length > 0) {
                        return filtered;
                    }
                }
            } catch {}
        }

        return [];
    }

    /**
     * Queries local loaded LM Studio models via lms CLI or process.
     */
    private async getLocalLoadedModels(): Promise<string[]> {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            const customDir = this.hostServices?.getConfiguration<string>('kai', 'lmStudioCacheDir') || '';
            const lmsPath = LMStudioManifestParser.resolveLmsExecutablePath(customDir);
            const command = (lmsPath.includes(' ') || lmsPath.includes('\\') || lmsPath.includes('/'))
                ? `"${lmsPath}" ps --json`
                : `${lmsPath} ps --json`;

            exec(command, { timeout: 1500 }, (error: any, stdout: string) => {
                if (error) {
                    resolve([]);
                    return;
                }
                try {
                    const parsed = JSON.parse(stdout);
                    if (Array.isArray(parsed)) {
                        const rawModels = parsed.map((m: any) => m.modelKey || m.identifier || m.path);
                        resolve(LMStudioReasoningEngine.filterChatModels(rawModels));
                    } else {
                        resolve([]);
                    }
                } catch {
                    resolve([]);
                }
            });
        });
    }

    /**
     * Enforces the strict rule: MAX 1 MODEL LOADED AT ALL TIMES in LM Studio.
     * If multiple models or a different model is loaded in memory, unloads all previous models first.
     */
    public async ensureSingleLoadedModel(targetModel: string): Promise<void> {
        if (!targetModel || targetModel === 'local-model' || targetModel.toLowerCase().startsWith('gemini')) {
            return;
        }
        const isFreeProvider = this.freeProviderClient.resolveFreeProvider(targetModel);
        if (isFreeProvider) return;

        const cleanTarget = (targetModel.endsWith(' (thinking)') ? targetModel.slice(0, -11) : targetModel).toLowerCase().trim();
        if (!cleanTarget || cleanTarget === 'local-model') return;

        try {
            const loaded = await this.getLoadedModels();
            const isMatch = loaded.some(m => m.toLowerCase().includes(cleanTarget) || cleanTarget.includes(m.toLowerCase()));
            if (!isMatch && loaded.length > 0) {
                const customDir = this.hostServices?.getConfiguration<string>('kai', 'lmStudioCacheDir') || '';
                const lmsPath = LMStudioManifestParser.resolveLmsExecutablePath(customDir);
                const { exec } = require('child_process');
                await new Promise<void>((resolve) => {
                    exec(`"${lmsPath}" unload --all`, { timeout: 10000 }, () => resolve());
                });
            }
        } catch {
            // Ignore unload errors
        }
    }

    /**
     * Delegated method for getGeminiModels.
     */
    public async getGeminiModels(_apiKey?: string): Promise<string[]> {
        return this.geminiClient.getModels();
    }

    /**
     * Validates if Gemini API key is valid.
     * @param apiKey Optional explicit API key.
     * @returns Promise resolving to boolean validity.
     */
    public async validateGemini(apiKey?: string): Promise<boolean> {
        return this.geminiClient.validateApiKey(apiKey);
    }

    /**
     * Validates if a free provider API key is working.
     * @param configKey Provider configuration key.
     * @param apiKey Optional explicit API key.
     * @returns Promise resolving to boolean validity.
     */
    public async validateFreeProvider(configKey: string, apiKey?: string): Promise<boolean> {
        return this.freeProviderClient.validateProvider(configKey, apiKey);
    }

    /**
     * Sends non-streaming chat completion to local LM Studio server.
     */
    public async chatCompletion(
        messages: { role: string; content: string }[],
        model: string = 'local-model',
        temperature: number = 0.7,
        signal?: any,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high'
    ): Promise<string> {
        if (model && model.toLowerCase().startsWith('gemini')) {
            return this.geminiClient.chatCompletion(messages, model, temperature, signal, thinking, geminiThinkingLevel);
        }

        const freeProvider = this.freeProviderClient.resolveFreeProvider(model);
        if (freeProvider) {
            return this.freeProviderClient.chatCompletion(messages, model, temperature, signal, thinking, geminiThinkingLevel);
        }

        const cleanModel = (model || '').endsWith(' (thinking)') ? model.slice(0, -11) : (model || 'local-model');
        await this.ensureSingleLoadedModel(cleanModel);

        return new Promise((resolve, reject) => {
            const { hostname, port, pathPrefix } = this.parseServerUrl();
            
            const requestParams: any = {
                model: cleanModel,
                messages: messages,
                temperature: temperature,
                stream: false
            };

            this.applyThinkingParameters(requestParams, cleanModel, thinking, geminiThinkingLevel);

            const payload = JSON.stringify(requestParams);

            const options: http.RequestOptions = {
                hostname,
                port,
                path: `${pathPrefix}/chat/completions`,
                method: 'POST',
                signal: signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
                                const rawContent = parsed.choices[0].message.content || '';
                                if (MuseGlimmerStreamParser.isMuseGlimmerModel(model) || MuseGlimmerStreamParser.hasMuseGlimmerMarkers(rawContent)) {
                                    resolve(MuseGlimmerStreamParser.parseCompleteResponse(rawContent, thinking));
                                } else {
                                    resolve(rawContent);
                                }
                            } else {
                                reject(new Error('Invalid response structure from completion API'));
                            }
                        } catch {
                            reject(new Error('Failed to parse completion response JSON'));
                        }
                    } else {
                        reject(new Error(`Server returned HTTP status ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.write(payload);
            req.end();
        });
    }

    /**
     * Sends streaming chat completion to local LM Studio server.
     */
    public async chatCompletionStream(
        messages: { role: string; content: string }[],
        model: string = 'local-model',
        temperature: number = 0.7,
        onToken: (token: string) => void = () => {},
        signal?: any,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high'
    ): Promise<string> {
        if (model && model.toLowerCase().startsWith('gemini')) {
            this._lastTokensPerSecond = null;
            return this.geminiClient.chatCompletionStream(messages, model, temperature, onToken, signal, thinking, geminiThinkingLevel);
        }

        const freeProvider = this.freeProviderClient.resolveFreeProvider(model);
        if (freeProvider) {
            this._lastTokensPerSecond = null;
            return this.freeProviderClient.chatCompletionStream(messages, model, temperature, onToken, signal, thinking, geminiThinkingLevel);
        }

        const cleanModel = (model || '').endsWith(' (thinking)') ? model.slice(0, -11) : (model || 'local-model');
        await this.ensureSingleLoadedModel(cleanModel);

        return new Promise((resolve, reject) => {
            const { hostname, port, pathPrefix } = this.parseServerUrl();
            
            const requestParams: any = {
                model: cleanModel,
                messages: messages,
                temperature: temperature,
                stream: true,
                stream_options: { include_usage: true }
            };

            this.applyThinkingParameters(requestParams, cleanModel, thinking, geminiThinkingLevel);

            const payload = JSON.stringify(requestParams);

            const options: http.RequestOptions = {
                hostname,
                port,
                path: `${pathPrefix}/chat/completions`,
                method: 'POST',
                signal: signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const streamStartTime = Date.now();
            let tokenCount = 0;
            let lmStudioTps: number | null = null;

            const req = http.request(options, (res) => {
                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`Server returned HTTP status ${res.statusCode}`));
                    return;
                }

                let buffer = '';
                let fullText = '';
                let inThinking = false;
                const isMuseModel = MuseGlimmerStreamParser.isMuseGlimmerModel(model);
                const museParser = new MuseGlimmerStreamParser(thinking, (token: string) => {
                    fullText += token;
                    tokenCount++;
                    onToken(token);
                });
                let isMuseStreaming = isMuseModel;

                const processParsedChunk = (parsed: any) => {
                    if (parsed.usage) {
                        if (typeof parsed.usage.tokens_per_second === 'number') {
                            lmStudioTps = parsed.usage.tokens_per_second;
                        } else if (typeof parsed.usage.predicted_per_second === 'number') {
                            lmStudioTps = parsed.usage.predicted_per_second;
                        }
                        if (typeof parsed.usage.completion_tokens === 'number' && parsed.usage.completion_tokens > 0) {
                            tokenCount = parsed.usage.completion_tokens;
                        }
                    }
                    if (parsed.stats && typeof parsed.stats.tokens_per_second === 'number') {
                        lmStudioTps = parsed.stats.tokens_per_second;
                    }

                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                        const delta = parsed.choices[0].delta;
                        if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
                            let text = '';
                            if (!inThinking) {
                                text += '<think>';
                                inThinking = true;
                            }
                            text += delta.reasoning_content;
                            fullText += text;
                            tokenCount++;
                            onToken(text);
                        } else if (delta.content !== undefined && delta.content !== null) {
                            if (!isMuseStreaming && delta.content.startsWith('to=self<|message|>')) {
                                isMuseStreaming = true;
                            }

                            if (isMuseStreaming) {
                                museParser.processChunk(delta.content);
                            } else {
                                let text = '';
                                if (inThinking) {
                                    text += '</think>';
                                    inThinking = false;
                                }
                                text += delta.content;
                                fullText += text;
                                tokenCount++;
                                onToken(text);
                            }
                        }
                    }
                };

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') continue;
                        if (trimmed.startsWith('data: ')) {
                            try {
                                const parsed = JSON.parse(trimmed.slice(6));
                                processParsedChunk(parsed);
                            } catch {
                                // Ignore partial lines
                            }
                        }
                    }
                });

                res.on('end', () => {
                    if (buffer.trim().startsWith('data: ')) {
                        try {
                            const trimmed = buffer.trim();
                            if (trimmed !== 'data: [DONE]') {
                                const parsed = JSON.parse(trimmed.slice(6));
                                processParsedChunk(parsed);
                            }
                        } catch {
                            // Ignore trailing incomplete buffers
                        }
                    }
                    if (isMuseStreaming) {
                        museParser.finish();
                    } else if (inThinking && thinking) {
                        fullText += '</think>';
                        onToken('</think>');
                        inThinking = false;
                    }

                    const elapsedSec = Math.max(0.1, (Date.now() - streamStartTime) / 1000);
                    const calculatedTps = lmStudioTps !== null ? lmStudioTps : (tokenCount / elapsedSec);
                    this._lastTokensPerSecond = `${calculatedTps.toFixed(1)} tok/s`;

                    resolve(fullText);
                });
            });

            req.on('error', (err) => reject(err));
            req.write(payload);
            req.end();
        });
    }

    /**
     * Dynamically applies thinking/reasoning parameters based on the target model family.
     */
    private applyThinkingParameters(requestParams: any, model: string, thinking: boolean, reasoningEffort?: string): void {
        const customDir = this.hostServices?.getConfiguration<string>('kai', 'lmStudioCacheDir') || '';
        const capabilitiesMap = LMStudioManifestParser.parseModelCapabilities(customDir);
        const cap = capabilitiesMap[model] || capabilitiesMap[(model || '').toLowerCase()];

        const applied = LMStudioReasoningEngine.applyManifestParameters(requestParams, cap, thinking, reasoningEffort);
        if (!applied) {
            LMStudioReasoningEngine.applyThinkingParameters(requestParams, model, thinking, reasoningEffort);
        }
    }
}
