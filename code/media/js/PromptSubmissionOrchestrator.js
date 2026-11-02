/**
 * PromptSubmissionOrchestrator coordinates prompt preparation, attached files,
 * retry rollbacks, edit prompt dispatches, and IPC communication.
 */
class PromptSubmissionOrchestrator {
    /**
     * Initializes orchestrator with references to core controllers and state.
     * @param {object} options Controller instances map.
     * @param {AppState} options.appState Application state instance.
     * @param {ChatUIController} options.chatUIController Chat UI controller instance.
     * @param {ModelDropdownController} options.modelDropdownController Model dropdown controller.
     * @param {FileUploadController} options.fileUploadController File upload controller.
     * @param {SettingsController} options.settingsController Settings controller.
     * @param {WebviewIPCBridge} options.ipcBridge Webview IPC bridge instance.
     * @param {SessionRepository} [options.sessionRepository] Session repository instance.
     */
    constructor(options) {
        this.appState = options.appState;
        this.chatUIController = options.chatUIController;
        this.modelDropdownController = options.modelDropdownController;
        this.fileUploadController = options.fileUploadController;
        this.settingsController = options.settingsController;
        this.ipcBridge = options.ipcBridge;
        this.sessionRepository = options.sessionRepository;
    }

    /**
     * Submits a user prompt, packages attached files, and initiates execution.
     * Updates AppState with user events and attached files before dispatching to the chat UI and backend.
     * @param {string} promptText The user's input text.
     */
    async submitPrompt(promptText) {
        if (!promptText || !promptText.trim()) return;
        if (this.appState.isWaitingForResponse) return;

        const textToSend = promptText.trim();
        const attachedFiles = this.fileUploadController ? this.fileUploadController.getAttachedFiles() : [];
        if (this.fileUploadController) this.fileUploadController.clear();

        // Add user message to state and UI
        // Store attachedFiles in appState for UI rendering
        this.appState.lastAttachedFiles = [...attachedFiles];
        if (typeof window !== 'undefined') window.appState = this.appState;

        // Format prompt with attached text files
        const textFiles = attachedFiles.filter(f => !f.isImage && (!f.content || !f.content.startsWith('data:image/')));
        let fullPromptContent = textToSend;
        if (textFiles.length > 0) {
            const filesContext = textFiles.map(f => `[Attached File: ${f.fileName}]\n\`\`\`\n${f.content || ''}\n\`\`\``).join('\n\n');
            fullPromptContent = fullPromptContent ? `${fullPromptContent}\n\n${filesContext}` : filesContext;
        }

        // Add user message to state and UI with attachedFiles
        this.appState.addMessage({ role: 'user', content: fullPromptContent, attachedFiles: attachedFiles });
        this.appState.addUiEvent({ type: 'user', text: textToSend, attachedFiles: attachedFiles });
        this.chatUIController.appendMessage('user', textToSend, attachedFiles);

        this.chatUIController.resetAssistantStream();
        this.chatUIController.setUiLoading(true, this.appState);

        if (this.sessionRepository) {
            this.sessionRepository.saveSession({
                id: this.appState.currentChatId,
                title: this.appState.currentChatTitle || textToSend.substring(0, 30),
                timestamp: Date.now(),
                messages: this.appState.messages,
                uiEvents: this.appState.uiEvents,
                model: this.appState.selectedModelValue,
                mode: this.appState.activeMode,
                workspacePath: this.appState.workspacePath || ''
            });
        }

        const modelDetails = this.modelDropdownController.getSelectedModelDetails();
        const reasoningLevel = modelDetails.reasoningEffort || (this.settingsController ? this.settingsController.getGeminiThinkingLevel(modelDetails.model) : 'high');

        const cleanMessages = (this.appState.messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system') && m.content !== undefined);

        this.ipcBridge.sendUserPrompt(
            cleanMessages,
            modelDetails.model,
            modelDetails.thinking,
            reasoningLevel,
            this.appState.activeMode === 'planning',
            attachedFiles,
            this.appState.currentChatId,
            this.appState.activeMode,
            this.appState.workspacePath || ''
        );
    }

    /**
     * Retries the last assistant turn by popping previous assistant message and re-running.
     * @param {HTMLElement} assistantMessageElement Target DOM element to remove.
     */
    async retryLastTurn(assistantMessageElement) {
        if (this.appState.isWaitingForResponse) return;

        const lastUserMsg = [...this.appState.messages].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return;

        if (assistantMessageElement) {
            assistantMessageElement.remove();
        }

        if (this.appState.messages.length > 0 && this.appState.messages[this.appState.messages.length - 1].role === 'assistant') {
            this.appState.messages.pop();
        }
        if (this.appState.uiEvents.length > 0 && this.appState.uiEvents[this.appState.uiEvents.length - 1].type === 'assistant') {
            this.appState.uiEvents.pop();
        }

        this.chatUIController.resetAssistantStream();
        this.chatUIController.setUiLoading(true, this.appState);

        const modelDetails = this.modelDropdownController.getSelectedModelDetails();
        const reasoningLevel = modelDetails.reasoningEffort || (this.settingsController ? this.settingsController.getGeminiThinkingLevel(modelDetails.model) : 'high');

        this.ipcBridge.sendUserPrompt(
            this.appState.messages,
            modelDetails.model,
            modelDetails.thinking,
            reasoningLevel,
            this.appState.activeMode === 'planning',
            [],
            this.appState.currentChatId,
            this.appState.activeMode,
            this.appState.workspacePath || ''
        );
    }

    /**
     * Edits a previously submitted user prompt in-place, truncates subsequent messages, and regenerates response.
     * @param {HTMLElement} userRowElement Target user row DOM element.
     * @param {string} newText Edited prompt string.
     */
    async editPrompt(userRowElement, newText) {
        if (this.appState.isWaitingForResponse) return;
        if (!newText || !newText.trim() || !userRowElement) return;

        const trimmedText = newText.trim();

        // 1. Determine user turn index in chat container
        const allUserRows = Array.from(this.chatUIController.chatContainer ? this.chatUIController.chatContainer.querySelectorAll('.user-message-row') : []);
        const userIndex = allUserRows.indexOf(userRowElement);

        // 2. Remove all DOM elements after this user message row
        if (userRowElement.parentElement) {
            while (userRowElement.nextElementSibling) {
                userRowElement.nextElementSibling.remove();
            }
        }

        // 3. Update the target user row DOM and close inline editor
        userRowElement.dataset.rawPrompt = trimmedText;
        const messageBubble = userRowElement.querySelector('.message.user-message');
        const editBtn = userRowElement.querySelector('.edit-prompt-btn');
        if (messageBubble) {
            messageBubble.classList.remove('hidden');
            const contentDiv = messageBubble.querySelector('.message-content');
            if (contentDiv) {
                contentDiv.innerHTML = this.chatUIController.formatter ? this.chatUIController.formatter.formatMarkdown(trimmedText) : trimmedText;
            }
        }
        if (editBtn) editBtn.classList.remove('hidden');
        const editor = userRowElement.querySelector('.inline-prompt-editor');
        if (editor) editor.remove();
        userRowElement.classList.remove('is-editing');

        // 4. Truncate appState.messages to this user turn
        let userCount = 0;
        let targetMsgIdx = -1;
        for (let i = 0; i < this.appState.messages.length; i++) {
            if (this.appState.messages[i].role === 'user') {
                if (userCount === userIndex) {
                    targetMsgIdx = i;
                    break;
                }
                userCount++;
            }
        }

        if (targetMsgIdx !== -1) {
            this.appState.messages[targetMsgIdx].content = trimmedText;
            this.appState.messages = this.appState.messages.slice(0, targetMsgIdx + 1);
        } else {
            this.appState.messages.push({ role: 'user', content: trimmedText });
        }

        // 5. Truncate appState.uiEvents to this user turn
        let userEventCount = 0;
        let targetEventIdx = -1;
        for (let i = 0; i < this.appState.uiEvents.length; i++) {
            if (this.appState.uiEvents[i].type === 'user') {
                if (userEventCount === userIndex) {
                    targetEventIdx = i;
                    break;
                }
                userEventCount++;
            }
        }

        if (targetEventIdx !== -1) {
            this.appState.uiEvents[targetEventIdx].text = trimmedText;
            this.appState.uiEvents = this.appState.uiEvents.slice(0, targetEventIdx + 1);
        } else {
            this.appState.uiEvents.push({ type: 'user', text: trimmedText });
        }

        // 6. Rollback any file changes from this turn and subsequent truncated turns
        if (this.ipcBridge && typeof this.ipcBridge.rollbackTurn === 'function') {
            this.ipcBridge.rollbackTurn(this.appState.currentChatId || 'default');
        }

        // 7. Reset assistant stream and update UI state
        this.chatUIController.resetAssistantStream();
        this.chatUIController.setUiLoading(true, this.appState);

        // 8. Persist updated session
        if (this.sessionRepository) {
            this.sessionRepository.saveSession({
                id: this.appState.currentChatId,
                title: this.appState.currentChatTitle || trimmedText.substring(0, 30),
                timestamp: Date.now(),
                messages: this.appState.messages,
                uiEvents: this.appState.uiEvents,
                model: this.appState.selectedModelValue,
                mode: this.appState.activeMode,
                workspacePath: this.appState.workspacePath || ''
            });
        }

        // 8. Dispatch prompt with truncated conversation history
        const modelDetails = this.modelDropdownController.getSelectedModelDetails();
        const reasoningLevel = modelDetails.reasoningEffort || (this.settingsController ? this.settingsController.getGeminiThinkingLevel(modelDetails.model) : 'high');

        this.ipcBridge.sendUserPrompt(
            this.appState.messages,
            modelDetails.model,
            modelDetails.thinking,
            reasoningLevel,
            this.appState.activeMode === 'planning',
            [],
            this.appState.currentChatId,
            this.appState.activeMode,
            this.appState.workspacePath || ''
        );
    }
}
