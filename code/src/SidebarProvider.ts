import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as child_process from 'child_process';
import { AgentExecutor } from './AgentExecutor';
import { LMStudioClient, FREE_PROVIDERS } from './LMStudioClient';
import { LMStudioManifestParser } from './providers/LMStudioManifestParser';
import { I18nManager } from './i18n';
import { SessionStore } from './SessionStore';
import { VSCodeHostServices, MementoSessionStorage } from './adapters/VSCodeHostServices';
import { EditorContextProvider } from './EditorContextProvider';
import { TurnSnapshotManager } from './services/TurnSnapshotManager';
import { Logger } from './services/Logger';

/**
 * SidebarProvider implements the vscode.WebviewViewProvider to govern the behavior,
 * HTML rendering, and message passing of the LM Studio Agent sidebar panel.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kai-chat-sidebar';
    /** Debug output channel for visible logging in VS Code Output panel */
    private static _outputChannel: vscode.OutputChannel;
    private _view?: vscode.WebviewView;
    private _activeAbortController?: AbortController;
    private _currentStreamingText: string = '';
    private _currentStreamingMessages: any[] = [];

    private readonly _extensionUri: vscode.Uri;
    private readonly _sessionStore: SessionStore;

    /**
     * Initializes a new instance of the SidebarProvider.
     * @param context The extension context for persistent state and resource URI.
     */
    constructor(context: vscode.ExtensionContext) {
        this._extensionUri = context.extensionUri;
        this._sessionStore = new SessionStore(new MementoSessionStorage(context.workspaceState));
        SidebarProvider._outputChannel = Logger.initialize();
    }

    /**
     * Called by VS Code when the webview sidebar is resolved/initialized.
     * Sets up the webview HTML content, registers event listeners, and establishes connection status.
     * @param webviewView The webview view to resolve.
     * @param _context Additional contextual information.
     * @param _token Cancellation token.
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        VSCodeHostServices.setActiveWebview(webviewView.webview);

        // Configure options to allow scripts and specify local file access roots
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Inject the HTML template
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Run initial connection verification immediately
        this._handleCheckConnection().catch(err => {
            SidebarProvider._outputChannel.appendLine(`[ERROR] Initial checkConnection failed: ${err?.message || err}`);
        });

        // Handle webview disposal/close
        webviewView.onDidDispose(() => {
            if (this._activeAbortController) {
                this._activeAbortController.abort();
                this._activeAbortController = undefined;
            }
            this._view = undefined;
        });

        // Listen for messages received from the webview client
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'ask_user_response': {
                    VSCodeHostServices.resolveAskUser(data.requestId, data.answer);
                    break;
                }
                case 'sendMessage': {
                    await this._handleSendMessage(
                        data.messages,
                        data.model,
                        data.thinking,
                        data.geminiThinkingLevel || 'high',
                        data.planningMode || false,
                        data.attachedFiles || [],
                        data.mode || 'agent',
                        data.sessionId
                    );
                    break;
                }
                case 'abort': {
                    if (this._activeAbortController) {
                        this._activeAbortController.abort();
                        this._activeAbortController = undefined;
                    }
                    break;
                }
                case 'checkConnection': {
                    await this._handleCheckConnection();
                    break;
                }
                case 'switchLMStudioModel': {
                    await this._handleSwitchLMStudioModel(data.model);
                    break;
                }
                case 'updateSettings': {
                    const config = vscode.workspace.getConfiguration('kai');
                    const envUpdates: Record<string, string> = {};
                    let languageChanged = false;

                    if (data.serverUrl !== undefined) {
                        await config.update('serverUrl', data.serverUrl, vscode.ConfigurationTarget.Global);
                    }
                    if (data.lmStudioCacheDir !== undefined) {
                        await config.update('lmStudioCacheDir', data.lmStudioCacheDir, vscode.ConfigurationTarget.Global);
                    }
                    if (data.apiKey !== undefined) {
                        await config.update('apiKey', data.apiKey, vscode.ConfigurationTarget.Global);
                        envUpdates['GEMINI_API_KEY'] = data.apiKey;
                    }
                    if (data.language !== undefined) {
                        const currentLang = config.get<string>('language') || 'auto';
                        languageChanged = (data.language !== currentLang);
                        await config.update('language', data.language, vscode.ConfigurationTarget.Global);
                    }
                    // Persist per-provider API keys sent from the settings panel
                    if (data.providerKeys && typeof data.providerKeys === 'object') {
                        for (const [configKey, keyValue] of Object.entries(data.providerKeys)) {
                            await config.update(configKey, keyValue as string, vscode.ConfigurationTarget.Global);
                        }
                    }

                    if (languageChanged && this._view) {
                        this._view.webview.html = this._getHtmlForWebview(this._view.webview);
                    }
                    await this._handleCheckConnection();
                    break;
                }
                case 'browseLMStudioFolder': {
                    await this._handleBrowseLMStudioFolder();
                    break;
                }
                case 'showError': {
                    vscode.window.showErrorMessage(data.message);
                    break;
                }
                case 'saveChat': {
                    await this._handleSaveChat(data.chat);
                    break;
                }
                case 'loadChatHistory': {
                    await this._handleLoadChatHistory();
                    break;
                }
                case 'deleteChat': {
                    if (data.chatId) {
                        TurnSnapshotManager.getInstance().clearTurn(data.chatId);
                    }
                    await this._handleDeleteChat(data.chatId);
                    break;
                }
                case 'rollbackTurn': {
                    if (data.turnIds || data.chatId) {
                        const ids = data.turnIds || [data.chatId];
                        await TurnSnapshotManager.getInstance().rollbackTurn(ids);
                    }
                    break;
                }
                case 'loadChat': {
                    await this._handleLoadChat(data.chatId);
                    break;
                }
                case 'openFile': {
                    await this._handleOpenFile(data.filePath);
                    break;
                }
                case 'openFilePicker': {
                    await this._handleOpenFilePicker();
                    break;
                }
                case 'openExternal':
                case 'openExternalUrl': {
                    if (data.url) {
                        vscode.env.openExternal(vscode.Uri.parse(data.url));
                    }
                    break;
                }
                case 'testProviderConnection': {
                    const configKey = data.configKey;
                    const apiKey = data.apiKey;
                    let isValid = false;
                    try {
                        const client = new LMStudioClient('http://localhost:1234/v1', apiKey);
                        if (configKey === 'geminiApiKey') {
                            isValid = await client.validateGemini(apiKey);
                        } else {
                            isValid = await client.validateFreeProvider(configKey, apiKey);
                        }
                    } catch (e) {
                        isValid = false;
                    }
                    this._view?.webview.postMessage({
                        type: 'providerTestResult',
                        configKey: configKey,
                        success: isValid
                    });
                    break;
                }
                case 'webviewLog': {
                    SidebarProvider._outputChannel.appendLine(`[WEBVIEW] ${data.text}`);
                    break;
                }
                case 'replyError': {
                    SidebarProvider._outputChannel.appendLine(`[WEBVIEW ERROR] ${data.message}`);
                    break;
                }
            }
        });

        // Notify the webview if the agent is currently running
        webviewView.webview.postMessage({
            type: 'initialState',
            isRunning: this._activeAbortController !== undefined,
            streamingText: this._currentStreamingText,
            messages: this._currentStreamingMessages
        });

        // Trigger an initial connection status check
        this._handleCheckConnection();
    }

    /**
     * Handles the 'sendMessage' event from the webview, forwards it to LM Studio,
     * and sends the response back to the webview UI.
     * @param messages The chat history payload array.
     * @param model Selected model identifier.
     * @param thinking Flag indicating if thinking mode is active.
     * @param geminiThinkingLevel Reasoning effort or gemini thinking budget.
     * @param planningMode Whether planning mode is toggled.
     * @param attachedFiles List of user-attached files.
     */
    private async _handleSendMessage(
        messages: { role: string; content: string }[],
        model?: string,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high',
        planningMode: boolean = false,
        attachedFiles: any[] = [],
        mode: string = 'agent',
        _sessionId?: string
    ) {
        if (!this._view) {
            return;
        }

        // Retrieve workspace root and extension directory paths
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspacePath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
        const extensionPath = this._extensionUri.fsPath;

        // Read configuration values
        const config = vscode.workspace.getConfiguration('kai');
        const serverUrl = config.get<string>('serverUrl') || 'http://localhost:1234/v1';

        // Initialize executor and abort controller
        this._activeAbortController = new AbortController();

        const hostServices = new VSCodeHostServices();
        const executor = new AgentExecutor(
            workspacePath,
            extensionPath,
            serverUrl,
            0.2,
            (event) => {
                this._view?.webview.postMessage({
                    type: 'agentProgress',
                    progressType: event.type,
                    text: event.text || event.output,
                    tool: event.tool,
                    query: event.query,
                    output: event.output,
                    toolId: event.toolId,
                    fileName: event.fileName
                });
            },
            hostServices
        );

        this._currentStreamingText = '';
        this._currentStreamingMessages = messages;

        try {
            const userPrompt = messages.length > 0 ? messages[messages.length - 1].content : '';
            const history = messages.slice(0, -1);
            const activeFile = EditorContextProvider.captureEditorContext(workspacePath);

            const result = await executor.run(
                userPrompt,
                history,
                model || 'local-model',
                this._activeAbortController.signal,
                activeFile,
                thinking,
                geminiThinkingLevel,
                planningMode || mode === 'planning',
                attachedFiles,
                16000,
                mode
            );

            // Signal stream completion to the webview
            this._view.webview.postMessage({
                type: 'reply',
                content: result.reply,
                modifiedFiles: result.modifiedFiles,
                tokensPerSecond: result.tokensPerSecond,
                fullHistory: result.messages
            });
        } catch (error: any) {
            // Re-throw if error was generated from manual abort cancellation
            if (error.name === 'AbortError') {
                return;
            }
            this._view.webview.postMessage({
                type: 'replyError',
                message: error.message || 'Error occurred during execution.'
            });
        } finally {
            this._activeAbortController = undefined;
            this._currentStreamingText = '';
        }
    }

    /**
     * Connects to LM Studio to verify server status and retrieve the active loaded model.
     * Reports the model status and manifest capabilities back to the webview.
     */
    private async _handleCheckConnection() {
        if (!this._view) {
            SidebarProvider._outputChannel.appendLine('[WARN] _handleCheckConnection called but _view is undefined');
            return;
        }

        const log = (msg: string) => SidebarProvider._outputChannel.appendLine(`[KAI] ${msg}`);

        try {
            log('checkConnection START');
            const config = vscode.workspace.getConfiguration('kai');
            const serverUrl = config.get<string>('serverUrl') || 'http://localhost:1234/v1';
            const apiKey = config.get<string>('apiKey') || '';
            const translations = I18nManager.getTranslations();
            const activeLang = I18nManager.getActiveLanguage();

            log(`serverUrl=${serverUrl}`);

            const buildFreeProviders = () => {
                return FREE_PROVIDERS.map(p => ({
                    name: p.name,
                    configKey: p.configKey,
                    keyHint: p.keyHint,
                    models: p.models,
                    apiKey: (config.get<string>(p.configKey) || '').trim(),
                    connected: false
                }));
            };

            const client = new LMStudioClient(serverUrl, apiKey);
            const rawFreeProviders = buildFreeProviders();

            // Perform fast concurrent validation across local server, Gemini, and cloud providers
            log('Starting Promise.allSettled for LM/Gemini/Free providers...');
            const [lmResult, geminiValidationResult, ...freeValidationResults] = await Promise.allSettled([
                client.getLMStudioModels(),
                apiKey ? client.validateGemini(apiKey) : Promise.resolve(false),
                ...rawFreeProviders.map(p => p.apiKey ? client.validateFreeProvider(p.configKey, p.apiKey) : Promise.resolve(false))
            ]);

            const lmModels = lmResult.status === 'fulfilled' ? lmResult.value : [];
            const lmStudioConnected = lmResult.status === 'fulfilled' && lmModels.length > 0;
            const isGeminiValid = geminiValidationResult.status === 'fulfilled' ? Boolean(geminiValidationResult.value) : false;
            const geminiModels = await client.getGeminiModels();

            log(`lmResult.status=${lmResult.status}, lmModels=[${lmModels.join(', ')}], connected=${lmStudioConnected}`);
            if (lmResult.status === 'rejected') {
                log(`lmResult.reason=${(lmResult as PromiseRejectedResult).reason}`);
            }

            const updatedFreeProviders = rawFreeProviders.map((p, idx) => {
                const valRes = freeValidationResults[idx];
                const isConnected = valRes && valRes.status === 'fulfilled' ? Boolean(valRes.value) : false;
                return {
                    ...p,
                    connected: isConnected
                };
            });

            let loadedModels: string[] = [];
            if (lmStudioConnected) {
                loadedModels = await client.getLoadedModels().catch(() => []);
            } else if (isGeminiValid) {
                loadedModels = [...geminiModels];
            }

            const activeModel = lmModels.length > 0
                ? lmModels[0]
                : (isGeminiValid && geminiModels.length > 0 ? geminiModels[0] : 'local-model');

            // 2. Validate LM Studio Cache directory and extract model capabilities
            const lmStudioCacheDir = config.get<string>('lmStudioCacheDir') || '';
            const lmStudioCacheStatus = LMStudioManifestParser.validateCache(lmStudioCacheDir);
            const lmStudioCapabilities = LMStudioManifestParser.parseModelCapabilities(lmStudioCacheDir);

            log(`loadedModels=[${loadedModels.join(', ')}], activeModel=${activeModel}`);
            log(`Posting connectionStatus to webview: connected=${lmStudioConnected}, models=${lmModels.length}, loaded=${loadedModels.length}`);

            // 3. Post updated model availability and manifest capabilities
            this._view.webview.postMessage({
                type: 'connectionStatus',
                connected: lmStudioConnected,
                geminiConnected: isGeminiValid,
                model: activeModel,
                lmStudioModels: lmModels,
                geminiModels: geminiModels,
                loadedModels: loadedModels,
                freeProviders: updatedFreeProviders,
                serverUrl: serverUrl,
                apiKey: apiKey,
                lmStudioCacheDir: lmStudioCacheDir,
                lmStudioCacheStatus: lmStudioCacheStatus,
                lmStudioCapabilities: lmStudioCapabilities,
                translations: translations,
                language: activeLang
            });

            log('checkConnection DONE');
        } catch (err: any) {
            SidebarProvider._outputChannel.appendLine(`[ERROR] _handleCheckConnection crashed: ${err?.message || err}`);
            SidebarProvider._outputChannel.appendLine(`[ERROR] Stack: ${err?.stack || 'no stack'}`);
            SidebarProvider._outputChannel.show(true);
        }
    }

    /**
     * Helper command execution method that pushes the current text editor selection into the webview.
     */
    public sendSelectionToChat() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active text editor open.');
            return;
        }

        const selectionText = editor.document.getText(editor.selection);
        if (!selectionText) {
            vscode.window.showInformationMessage('Please select some code to send to the local agent.');
            return;
        }

        if (this._view) {
            this._view.show(true);
            this._view.webview.postMessage({
                type: 'addCodeSelection',
                text: selectionText
            });
        }
    }

    /**
     * Saves a chat session in workspaceState storage via SessionStore.
     * @param chat The ChatSession object to be stored.
     */
    private async _handleSaveChat(chat: any) {
        await this._sessionStore.saveChat(chat);
    }

    /**
     * Loads saved chat history via SessionStore and sends the sorted list to the webview.
     */
    private async _handleLoadChatHistory() {
        if (!this._view) {
            return;
        }
        const chatsList = this._sessionStore.getHistoryList();
        this._view.webview.postMessage({
            type: 'chatHistory',
            chats: chatsList
        });
    }

    /**
     * Deletes a chat session by ID via SessionStore and updates the webview's list.
     * @param chatId The unique ID of the chat to delete.
     */
    private async _handleDeleteChat(chatId: string) {
        if (!chatId) {
            return;
        }
        const updatedList = await this._sessionStore.deleteChat(chatId);
        if (this._view) {
            this._view.webview.postMessage({
                type: 'chatHistory',
                chats: updatedList
            });
        }
    }

    /**
     * Retrieves a specific chat session by ID via SessionStore and sends it back to the webview.
     * @param chatId The unique ID of the chat to load.
     */
    private async _handleLoadChat(chatId: string) {
        if (!this._view || !chatId) {
            return;
        }
        const chat = this._sessionStore.getChat(chatId);
        if (chat) {
            this._view.webview.postMessage({
                type: 'loadChat',
                chat: chat
            });
        }
    }

    /**
     * Handles opening a file in the active VS Code editor tab when clicked from the webview.
     * @param relOrAbsPath Relative or absolute file path to open.
     */
    private async _handleOpenFile(relOrAbsPath: string) {
        if (!relOrAbsPath) {
            return;
        }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const targetPath = path.isAbsolute(relOrAbsPath)
            ? relOrAbsPath
            : path.join(workspacePath, relOrAbsPath);

        if (fs.existsSync(targetPath)) {
            const docUri = vscode.Uri.file(targetPath);
            const doc = await vscode.workspace.openTextDocument(docUri);
            await vscode.window.showTextDocument(doc);
        }
    }

    /**
     * Opens VS Code native file open dialog to select text/code/image files.
     */
    private async _handleOpenFilePicker() {
        if (!this._view) {
            return;
        }

        const selectedUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            openLabel: 'Attach Files',
            filters: {
                'Code & Text Files': ['js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'json', 'md', 'txt', 'csv', 'java', 'c', 'cpp', 'rs', 'go', 'php', 'rb', 'sql', 'sh', 'yaml', 'yml', 'xml', 'env', 'toml'],
                'Images (Multimodal)': ['png', 'jpg', 'jpeg', 'webp', 'gif']
            }
        });

        if (!selectedUris || selectedUris.length === 0) {
            return;
        }

        const files: { fileName: string; filePath: string; relativePath: string; content: string }[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspacePath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';

        for (const uri of selectedUris) {
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.size > 2 * 1024 * 1024) {
                    vscode.window.showWarningMessage(`File ${path.basename(uri.fsPath)} exceeds 2MB limit and was skipped.`);
                    continue;
                }

                let relPath = uri.fsPath;
                if (workspacePath && uri.fsPath.startsWith(workspacePath)) {
                    relPath = path.relative(workspacePath, uri.fsPath);
                }

                const fileContent = await fs.promises.readFile(uri.fsPath, 'utf8').catch(() => '');

                files.push({
                    fileName: path.basename(uri.fsPath),
                    filePath: uri.fsPath,
                    relativePath: relPath,
                    content: fileContent
                });
            } catch {
                // skip unreadable files
            }
        }

        if (files.length > 0) {
            this._view.webview.postMessage({
                type: 'filesSelected',
                files: files
            });
        }
    }

    /**
     * Opens VS Code native folder picker dialog to select custom LM Studio directory path.
     */
    private async _handleBrowseLMStudioFolder() {
        if (!this._view) {
            return;
        }

        const selectedUris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select .lmstudio Folder',
            title: 'Select LM Studio Directory'
        });

        if (selectedUris && selectedUris.length > 0) {
            const selectedPath = selectedUris[0].fsPath;
            const config = vscode.workspace.getConfiguration('kai');
            await config.update('lmStudioCacheDir', selectedPath, vscode.ConfigurationTarget.Global);
            await this._handleCheckConnection();
        }
    }

    /**
     * Unloads prior LM Studio models and loads the specified model dynamically in LM Studio.
     * Invokes the lms command line tool to manage VRAM memory and refreshes connection state.
     * @param modelId Identifier of the LM Studio model to load.
     */
    private async _handleSwitchLMStudioModel(modelId: string) {
        if (!modelId || modelId === 'local-model' || modelId.toLowerCase().startsWith('gemini')) {
            return;
        }

        const homeDir = os.homedir();
        const candidates = [
            path.join(homeDir, '.cache', 'lm-studio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms'),
            path.join(homeDir, '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms')
        ];

        const lmsBin = candidates.find(c => fs.existsSync(c));
        if (lmsBin) {
            try {
                // Unload all previous models to free up GPU memory
                await new Promise<void>((resolve) => {
                    child_process.execFile(lmsBin, ['unload', '--all'], { timeout: 15000 }, () => resolve());
                });
                // Load newly selected model
                await new Promise<void>((resolve) => {
                    child_process.execFile(lmsBin, ['load', modelId, '-y'], { timeout: 30000 }, () => resolve());
                });
            } catch {}
        }
        await this._handleCheckConnection();
    }

    /**
     * Loads SVG icons from the media/svg directory.
     * @returns Map of icon names to SVG strings.
     */
    private _loadSvgs(): Record<string, string> {
        const svgDir = path.join(this._extensionUri.fsPath, 'media', 'svg');
        const svgs: Record<string, string> = {};
        try {
            if (fs.existsSync(svgDir)) {
                const files = fs.readdirSync(svgDir);
                for (const file of files) {
                    if (file.endsWith('.svg')) {
                        const name = path.basename(file, '.svg');
                        svgs[name] = fs.readFileSync(path.join(svgDir, file), 'utf8').trim();
                    }
                }
            }
        } catch (e) {
            console.error('Error loading SVGs:', e);
        }
        return svgs;
    }

    /**
     * Compiles and returns the full HTML string for the webview.
     * Links CSS/JS files and configures Content Security Policy.
     * @param webview The webview instance.
     * @returns The HTML document string.
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Resolve resources from media directory
        const constantsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'Constants.js'));
        const domUtilsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'DOMUtils.js'));
        const streamBufferPipelineUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'StreamBufferPipeline.js'));
        const modelProviderResolverUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ModelProviderResolver.js'));
        const sessionRepositoryUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'SessionRepository.js'));
        const settingsRepositoryUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'SettingsRepository.js'));
        const appStateUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'AppState.js'));
        const mermaidVendorUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vendor', 'mermaid.min.js'));
        const mermaidRendererUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'MermaidRenderer.js'));
        const markdownFormatterUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'MarkdownFormatter.js'));
        const ipcBridgeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'WebviewIPCBridge.js'));
        const fileSummaryWidgetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'FileSummaryWidget.js'));
        const toggleComponentUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ToggleComponent.js'));
        const customSelectComponentUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'CustomSelectComponent.js'));
        const thinkingStateFormatterUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ThinkingStateFormatter.js'));
        const apiKeyNoticeCardUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ApiKeyNoticeCard.js'));
        const toolStatusCardUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ToolStatusCard.js'));
        const thinkingBlockComponentUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ThinkingBlockComponent.js'));
        const planCardComponentUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'PlanCardComponent.js'));
        const userMessageBubbleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'UserMessageBubble.js'));
        const assistantMessageBubbleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'AssistantMessageBubble.js'));
        const inlinePromptEditorUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'InlinePromptEditor.js'));
        const activityStatusIndicatorUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ActivityStatusIndicator.js'));
        const welcomeHeroComponentUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'WelcomeHeroComponent.js'));
        const modeManagerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ModeManager.js'));
        const fileUploadControllerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'FileUploadController.js'));
        const helpModalControllerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'HelpModalController.js'));
        const historyManagerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'HistoryManager.js'));
        const settingsControllerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'SettingsController.js'));
        const modelDropdownControllerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ModelDropdownController.js'));
        const chatUIControllerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ChatUIController.js'));
        const promptSubmissionOrchestratorUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'PromptSubmissionOrchestrator.js'));
        const hashRouterUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'HashRouter.js'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'codicons', 'codicon.css'));

        // Use a nonce to restrict script source access
        const nonce = getNonce();
        const svgs = this._loadSvgs();

        const translations = I18nManager.getTranslations();
        const activeLang = I18nManager.getActiveLanguage();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!--
                    Content Security Policy (CSP):
                    Allows loading scripts with the specific nonce and styles/images/fonts from the extension's resources and local server APIs.
                -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src *;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${codiconUri}" rel="stylesheet" />
                <link href="${styleUri}" rel="stylesheet" />
                <title>Kai</title>
                <script nonce="${nonce}">
                    window.KAI_SVGS = ${JSON.stringify(svgs)};
                    window.KAI_I18N = ${JSON.stringify(translations)};
                    window.KAI_LANG = "${activeLang}";
                    window.KAI_SUPPORTED_LANGUAGES = ${JSON.stringify(I18nManager.getSupportedLanguages())};
                </script>
            </head>
            <body>
                <div class="sidebar-container">
                    <!-- Container 1: Minimalist Top Bar -->
                    <div class="sidebar-header">
                        <div class="header-actions">
                            <button id="new-chat-btn" class="icon-btn icon-btn--header" title="${translations.newChat}">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                            <button id="history-btn" class="icon-btn icon-btn--header" title="${translations.history}">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            </button>
                            <button id="settings-btn" class="icon-btn icon-btn--header" title="${translations.settings}">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Container 2: Main Content Area (Swappable Views) -->
                    <div id="main-content-container" class="main-content-container">
                        <!-- View A: Active Chat View (Default) -->
                        <div id="chat-view" class="content-view">
                            <!-- Chat Output Area -->
                            <div id="chat-container" class="chat-container"></div>

                            <!-- Chat Input Area -->
                            <div class="input-panel">
                                <div class="input-card">
                                    <div id="attached-files-bar" class="attached-files-bar hidden"></div>
                                    <textarea id="message-input" placeholder="${translations.messagePlaceholder}" rows="1"></textarea>
                                    <div class="input-toolbar">
                                         <div class="toolbar-left">
                                            <!-- FILE UPLOAD ATTACHMENT BUTTON -->
                                            <button type="button" class="icon-btn icon-btn--toolbar" id="attach-file-btn" title="${translations.uploadFile}">
                                                ${svgs.plus || ''}
                                            </button>

                                             <!-- 
                                                MODEL SELECTOR DROPDOWN:
                                                Primary dropdown menu for selecting active AI provider/model (LM Studio, Gemini, Mistral, etc.).
                                                Options inside are dynamically created interactive button items (.dropdown-item).
                                            -->
                                            <div class="custom-dropdown" id="model-dropdown-container">
                                                <button type="button" class="dropdown-trigger" id="dropdown-trigger-btn" title="Active Model">
                                                    <span id="status-dot" class="status-dot status-disconnected"></span>
                                                    <div id="selected-model-text-container" class="model-text-container">
                                                        <span id="selected-model-text" class="model-text-inner">${translations.selectModel || 'Select Model'}</span>
                                                    </div>
                                                    <svg class="dropdown-trigger-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                                </button>
                                                <div class="dropdown-menu hidden" id="dropdown-options-menu">
                                                    <!-- Dynamically populated with model option buttons -->
                                                </div>
                                            </div>
                                        </div>
                                        <div class="toolbar-right">
                                            <!--
                                                CONTEXT & MODE SELECTOR DROPDOWN ("@" BUTTON):
                                                Dropdown containing mode options: Agent, Ask, Plan.
                                            -->
                                            <div class="custom-dropdown" id="context-options-dropdown-container">
                                                <button type="button" class="icon-btn icon-btn--toolbar" id="at-mention-trigger-btn" title="Modes & Capabilities (@)">
                                                    ${svgs.at || ''}
                                                </button>
                                                <div class="dropdown-menu hidden" id="context-options-menu">
                                                    <div class="context-options-header">
                                                        <span>Select Mode</span>
                                                    </div>
                                                    <div class="context-modes-list" id="context-mode-selector">
                                                        <button type="button" class="context-mode-item active" id="mode-opt-agent" data-mode="agent" title="Autonomous code editing and tool execution">
                                                            <span class="mode-icon">${svgs.agent_mode || '<svg class="mode-item-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>'}</span>
                                                            <span>Agent</span>
                                                        </button>
                                                        <button type="button" class="context-mode-item" id="mode-opt-ask" data-mode="ask" title="Read-only workspace exploration and Q&A">
                                                            <span class="mode-icon">${svgs.ask_mode || '<svg class="mode-item-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'}</span>
                                                            <span>Ask</span>
                                                        </button>
                                                        <button type="button" class="context-mode-item" id="mode-opt-planning" data-mode="planning" title="Structured plan-first protocol before code edits">
                                                            <span class="mode-icon">${svgs.plan_mode || '<svg class="mode-item-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>'}</span>
                                                            <span>Plan</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <button id="send-btn" title="Send message">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- View B: History View -->
                        <div id="history-container" class="content-view history-container hidden">
                            <div class="history-panel-header">
                                <span>${translations.previousChats}</span>
                                <button id="close-history-btn" class="icon-btn icon-btn--header" title="Close History">✕</button>
                            </div>
                            <div id="history-list" class="history-list"></div>
                        </div>

                        <!-- View C: Settings View -->
                        <div id="settings-container" class="content-view settings-container hidden">
                            <div class="settings-panel-header">
                                <span>${translations.settings}</span>
                                <button id="close-settings-btn" class="icon-btn icon-btn--header" title="Close Settings">✕</button>
                            </div>
                            <div class="settings-content-panel">
                                <!-- CATEGORY 1: GENERAL SETTINGS -->
                                <div class="settings-category" id="category-general">
                                    <button type="button" class="category-header-btn" data-category="general">
                                        <span class="category-title">${translations.generalSettings || 'General Settings'}</span>
                                        <svg class="category-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                    </button>
                                    <div class="category-content">
                                        <div class="setting-item">
                                            <label for="language-select-container" style="font-size: 0.75rem; color: var(--app-muted); margin-bottom: 4px; display: block;">${translations.language}</label>
                                            <div id="language-select-container"></div>
                                        </div>
                                        <div class="setting-item">
                                            <label for="stream-settle-delay-select-container" style="font-size: 0.75rem; color: var(--app-muted); margin-bottom: 2px; display: block;">${translations.streamSettleDelay || 'Stream Lookahead Delay'}</label>
                                            <span class="setting-subtitle">${translations.streamSettleDelayDesc || 'Buffer delay before streaming markdown formatting settles into the DOM'}</span>
                                            <div id="stream-settle-delay-select-container"></div>
                                        </div>
                                    </div>
                                </div>

                                <!-- CATEGORY 2: LM STUDIO -->
                                <div class="settings-category" id="category-lmstudio">
                                    <button type="button" class="category-header-btn" data-category="lmstudio">
                                        <span class="category-title">${translations.lmStudioHeader || 'LM Studio'}</span>
                                        <svg class="category-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                    </button>
                                    <div class="category-content">
                                        <div class="setting-item">
                                            <label for="settings-server-url" style="font-size: 0.75rem; color: var(--app-muted); margin-bottom: 2px; display: block;">${translations.serverUrl || 'Server URL'}</label>
                                            <span class="setting-subtitle">${translations.serverUrlDesc || 'Local endpoint of the LM Studio API server (default http://localhost:1234/v1)'}</span>
                                            <input type="text" id="settings-server-url" placeholder="http://localhost:1234/v1" />
                                        </div>
                                        <div class="setting-item">
                                            <label for="settings-lmstudio-path" style="font-size: 0.75rem; color: var(--app-muted); margin-bottom: 2px; display: block;">${translations.lmStudioDirectory || 'LM Studio Directory'}</label>
                                            <span class="setting-subtitle">${translations.lmStudioDirectoryDesc || 'Path to the local LM Studio cache directory for model detection'}</span>
                                            <div style="display: flex; gap: 6px; align-items: center;">
                                                <input type="text" id="settings-lmstudio-path" style="flex: 1;" placeholder="Auto-detected (~/.cache/lm-studio, ~/.lmstudio)" />
                                                <button type="button" id="browse-lmstudio-path-btn" class="settings-browse-btn">${translations.browse || 'Browse...'}</button>
                                            </div>
                                            <div id="lmstudio-cache-status-indicator" class="cache-status-indicator">
                                                <span id="cache-status-dot" class="status-dot status-disconnected"></span>
                                                <span id="cache-status-text" class="cache-status-text">${translations.checkingCache || 'Checking cache...'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- CATEGORY 3: THINKING & REASONING -->
                                <div class="settings-category" id="category-thinking">
                                    <button type="button" class="category-header-btn" data-category="thinking">
                                        <span class="category-title">${translations.thinkingSettings || 'Thinking & Reasoning'}</span>
                                        <svg class="category-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                    </button>
                                    <div class="category-content">
                                        <div class="setting-item">
                                            <label for="thinking-display-style-container" class="setting-label">${translations.thinkingDisplayStyle}</label>
                                            <span class="setting-subtitle">${translations.thinkingDisplayStyleDesc || 'Choose between a collapsible card or inline text'}</span>
                                            <div id="thinking-display-style-container"></div>
                                        </div>
                                        <div class="setting-item">
                                            <div id="show-thinking-toggle-container"></div>
                                        </div>
                                        <div id="thinking-subsettings" class="setting-sub-panel">
                                            <div id="keep-thinking-expanded-container"></div>
                                            <div id="keep-thinking-finished-container"></div>
                                        </div>
                                    </div>
                                </div>

                                <!-- CATEGORY 4: EXTERNAL AI PROVIDERS -->
                                <div class="settings-category" id="category-apikeys">
                                    <button type="button" class="category-header-btn" data-category="apikeys">
                                        <span class="category-title">${translations.externalProvidersHeader || 'External AI Providers'}</span>
                                        <svg class="category-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                    </button>
                                    <div class="category-content">
                                        <span class="setting-subtitle" style="margin-bottom: 6px;">${translations.apiKeysSettingsDesc || 'Manage API keys and test live connections for cloud models'}</span>
                                        <div class="setting-item" id="manage-keys-container">
                                            <button type="button" class="btn btn--primary" id="manage-keys-btn">
                                                ${svgs.manage_keys || ''}
                                                <span>${translations.manageFreeProviderKeys || 'Manage External Provider Keys'}</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- API Keys Overlay -->
                            <div id="keys-container" class="keys-container hidden">
                                <div class="keys-panel-header">
                                    <span>${translations.externalProviderApiKeys || 'External Provider API Keys'}</span>
                                    <button id="close-keys-btn" class="icon-btn icon-btn--header" title="${translations.close || 'Close'}">✕</button>
                                </div>
                                <div class="keys-content-panel">
                                    <!-- Dynamic provider key inputs rendered here -->
                                    <div id="dynamic-keys-list"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Load all modular ES6 Javascript controllers -->
                <script nonce="${nonce}" src="${constantsUri}"></script>
                <script nonce="${nonce}" src="${domUtilsUri}"></script>
                <script nonce="${nonce}" src="${streamBufferPipelineUri}"></script>
                <script nonce="${nonce}" src="${modelProviderResolverUri}"></script>
                <script nonce="${nonce}" src="${sessionRepositoryUri}"></script>
                <script nonce="${nonce}" src="${settingsRepositoryUri}"></script>
                <script nonce="${nonce}" src="${appStateUri}"></script>
                <script nonce="${nonce}" src="${mermaidVendorUri}"></script>
                <script nonce="${nonce}" src="${mermaidRendererUri}"></script>
                <script nonce="${nonce}" src="${markdownFormatterUri}"></script>
                <script nonce="${nonce}" src="${ipcBridgeUri}"></script>
                <script nonce="${nonce}" src="${fileSummaryWidgetUri}"></script>
                <script nonce="${nonce}" src="${toggleComponentUri}"></script>
                <script nonce="${nonce}" src="${customSelectComponentUri}"></script>
                <script nonce="${nonce}" src="${thinkingStateFormatterUri}"></script>
                <script nonce="${nonce}" src="${apiKeyNoticeCardUri}"></script>
                <script nonce="${nonce}" src="${toolStatusCardUri}"></script>
                <script nonce="${nonce}" src="${thinkingBlockComponentUri}"></script>
                <script nonce="${nonce}" src="${planCardComponentUri}"></script>
                <script nonce="${nonce}" src="${userMessageBubbleUri}"></script>
                <script nonce="${nonce}" src="${assistantMessageBubbleUri}"></script>
                <script nonce="${nonce}" src="${inlinePromptEditorUri}"></script>
                <script nonce="${nonce}" src="${activityStatusIndicatorUri}"></script>
                <script nonce="${nonce}" src="${welcomeHeroComponentUri}"></script>
                <script nonce="${nonce}" src="${modeManagerUri}"></script>
                <script nonce="${nonce}" src="${fileUploadControllerUri}"></script>
                <script nonce="${nonce}" src="${helpModalControllerUri}"></script>
                <script nonce="${nonce}" src="${historyManagerUri}"></script>
                <script nonce="${nonce}" src="${settingsControllerUri}"></script>
                <script nonce="${nonce}" src="${modelDropdownControllerUri}"></script>
                <script nonce="${nonce}" src="${chatUIControllerUri}"></script>
                <script nonce="${nonce}" src="${promptSubmissionOrchestratorUri}"></script>
                <script nonce="${nonce}" src="${hashRouterUri}"></script>
                <script nonce="${nonce}">
                    try {
                        const savedExtraDelay = parseInt(localStorage.getItem('kai.streamSettleDelay') || '0', 10);
                        const baseDelay = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--stream-settle-base-delay'), 10) || 150;
                        const effectiveSettle = baseDelay + (isNaN(savedExtraDelay) ? 0 : savedExtraDelay);
                        document.documentElement.style.setProperty('--stream-settle-delay', effectiveSettle + 'ms');
                    } catch (e) {}
                </script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

/**
 * Generates a random cryptographic nonce string for Content Security Policy scripts.
 * @returns Nonce string.
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
