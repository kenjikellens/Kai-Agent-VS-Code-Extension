/**
 * WebviewIPCBridge: Dedicated, lean communication bridge for the Kai VS Code Extension.
 * Exclusively forwards IPC messages to the Extension Host via vscode.postMessage().
 */
class WebviewIPCBridge {
    constructor() {
        this.listeners = new Map();
        this.vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
        this.onCommandApprovalRequest = null;
        this._initMessageListener();
    }

    /**
     * Registers window message event listener to dispatch events to subscribers.
     * @private
     */
    _initMessageListener() {
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message && message.type && this.listeners.has(message.type)) {
                const callbacks = this.listeners.get(message.type);
                callbacks.forEach(cb => {
                    try {
                        cb(message);
                    } catch (err) {
                        console.error(`[KAI WebviewIPCBridge Error] Error in listener for "${message.type}":`, err, message);
                    }
                });
            }
        });
    }

    /**
     * Subscribes a callback to an incoming message type from the Extension Host.
     * @param {string} type Incoming message key.
     * @param {Function} callback Event handler.
     */
    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(callback);
    }

    /**
     * Posts a message directly to the VS Code Extension Host.
     * @param {object} message Message payload.
     */
    postMessage(message) {
        if (this.vscode) {
            this.vscode.postMessage(message);
        }
    }

    // Public API Methods

    sendUserPrompt(messages, model, thinking, geminiThinkingLevel = 'high', planningMode = false, attachedFiles = [], chatId = null, mode = 'agent', workspacePath = '') {
        this.postMessage({
            type: 'sendMessage',
            messages,
            model,
            thinking,
            geminiThinkingLevel,
            planningMode,
            attachedFiles,
            chatId,
            mode,
            workspacePath
        });
    }

    openFilePicker() {
        this.postMessage({ type: 'openFilePicker' });
    }

    browseWorkspaceFolder() {
        this.postMessage({ type: 'browseWorkspaceFolder' });
    }

    browseLMStudioFolder() {
        this.postMessage({ type: 'browseLMStudioFolder' });
    }

    switchLMStudioModel(modelId) {
        this.postMessage({ type: 'switchLMStudioModel', model: modelId });
    }

    saveChat(chat) {
        this.postMessage({ type: 'saveChat', chat });
    }

    loadChatHistory() {
        this.postMessage({ type: 'loadChatHistory' });
    }

    loadChat(chatId) {
        this.postMessage({ type: 'loadChat', chatId });
    }

    deleteChat(chatId) {
        this.postMessage({ type: 'deleteChat', chatId });
    }

    checkConnection() {
        this.postMessage({ type: 'checkConnection' });
    }

    updateSettings(settings) {
        this.postMessage({ type: 'updateSettings', ...settings });
    }

    openFile(filePath) {
        this.postMessage({ type: 'openFile', filePath });
    }

    rollbackTurn(turnIds) {
        const ids = Array.isArray(turnIds) ? turnIds : [turnIds];
        this.postMessage({ type: 'rollbackTurn', turnIds: ids });
    }

    rollbackTurnChanges(turnIds) {
        return this.rollbackTurn(turnIds);
    }

    abort() {
        this.postMessage({ type: 'abort' });
    }

    openExternalUrl(url) {
        if (!url) return;
        this.postMessage({ type: 'openExternal', url });
    }
}

if (typeof window !== 'undefined') {
    window.WebviewIPCBridge = WebviewIPCBridge;
}
