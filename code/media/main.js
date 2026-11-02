/**
 * Client-side entry script for Kai Agent Chat Webview (VS Code Extension).
 * Instantiates and orchestrates ES6 OOP modules.
 */
(function () {
    try {
        // 1. Instantiate Core State and Utility Modules
        const appState = new AppState();
        const formatter = new MarkdownFormatter();
        const mermaidRenderer = new MermaidRenderer();
        const ipcBridge = new WebviewIPCBridge();
        const fileSummaryWidget = new FileSummaryWidget();
        const sessionRepository = new SessionRepository(ipcBridge);

        // 2. Instantiate Feature and View Controllers
        const settingsController = new SettingsController(ipcBridge);
        const fileUploadController = new FileUploadController(ipcBridge, appState);
        const helpModalController = new HelpModalController(ipcBridge);

        const modelDropdownController = new ModelDropdownController(formatter, (selectedModel) => {
            appState.selectedModelValue = selectedModel;
            saveCurrentChat();
        }, ipcBridge);

        const chatUIController = new ChatUIController(
            formatter,
            ipcBridge,
            fileSummaryWidget,
            settingsController,
            helpModalController,
            modelDropdownController,
            mermaidRenderer
        );
        window.chatUIController = chatUIController;

        const historyManager = new HistoryManager(ipcBridge, (viewName) => {
            if (chatUIController && typeof chatUIController.showView === 'function') {
                chatUIController.showView(viewName);
            }
        });

        // 3. Mode Manager (3 workspace modes in VS Code: ask, agent, planning)
        const modeManager = new ModeManager({
            appState: appState,
            contextModeSelector: document.getElementById('context-options-menu'),
            atMentionTriggerBtn: document.getElementById('at-mention-trigger-btn'),
            contextOptionsMenu: document.getElementById('context-options-menu'),
            messageInput: document.getElementById('message-input'),
            onModeChange: (newMode) => {
                saveCurrentChat();
            }
        });

        // 4. Prompt Submission Orchestrator
        const promptOrchestrator = new PromptSubmissionOrchestrator({
            appState: appState,
            chatUIController: chatUIController,
            modelDropdownController: modelDropdownController,
            fileUploadController: fileUploadController,
            settingsController: settingsController,
            ipcBridge: ipcBridge,
            sessionRepository: sessionRepository
        });

        // Wire Retry Callback (Rolls back last turn and re-runs previous prompt)
        chatUIController.onRetry = async (assistantMessageElement) => {
            if (appState.isWaitingForResponse) return;
            await promptOrchestrator.retryLastTurn(assistantMessageElement);
        };

        // Wire Edit Prompt Callback
        chatUIController.onEditPrompt = async (userMessageRowElement, editedText) => {
            if (appState.isWaitingForResponse) return;
            if (!editedText || !editedText.trim()) return;
            await promptOrchestrator.editPrompt(userMessageRowElement, editedText);
        };

        // DOM Element References for Input Orchestration
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const newChatBtn = document.getElementById('new-chat-btn');
        // Delegate Proceed button inside plan card: switches mode to agent and executes
        if (chatUIController.chatContainer) {
            chatUIController.chatContainer.addEventListener('click', (e) => {
                const proceedBtn = e.target.closest('.plan-proceed-btn');
                if (proceedBtn) {
                    if (appState.isWaitingForResponse) return;
                    proceedBtn.disabled = true;
                    modeManager.setActiveMode('agent');
                    if (messageInput) {
                        messageInput.value = 'Proceed with the implementation plan.';
                    }
                    sendMessage();
                }
            });
        }

        /**
         * Persists current active chat session to workspace state.
         */
        function saveCurrentChat() {
            if ((!appState.messages || appState.messages.length === 0) && (!appState.uiEvents || appState.uiEvents.length === 0)) {
                return;
            }
            const details = modelDropdownController.getSelectedModelDetails();
            sessionRepository.saveSession(appState.toChatPayload(details.thinking));
        }

        /**
         * Sends user prompt input to extension host or aborts ongoing generation.
         */
        function sendMessage() {
            if (appState.isWaitingForResponse) {
                ipcBridge.abort();
                chatUIController.setUiLoading(false, appState);
                chatUIController.resetAssistantStream();
                chatUIController.appendMessage('system', 'Generation stopped.');
                return;
            }

            const text = messageInput ? messageInput.value.trim() : '';
            if (!text && !appState.selectedCodeContext) {
                return;
            }

            let userPrompt = '';
            if (appState.selectedCodeContext) {
                userPrompt += `Here is the selected code context from the editor:\n\`\`\`\n${appState.selectedCodeContext}\n\`\`\`\n\n`;
            }
            userPrompt += text;

            if (messageInput) {
                messageInput.value = '';
                autoResizeInput();
            }
            appState.selectedCodeContext = '';

            promptOrchestrator.submitPrompt(userPrompt);
        }

        /**
         * Loads a saved chat session into state and updates UI views.
         * @param {object} chat Saved chat session object.
         */
        function loadChatSession(chat) {
            if (!chat) return;
            chatUIController.resetAssistantStream();
            appState.loadSession(chat);

            modeManager.setActiveMode(appState.activeMode || 'agent');
            chatUIController.renderUiEvents(appState.uiEvents, appState.messages);
            modelDropdownController.setSelectedModel(appState.selectedModelValue);

            chatUIController.setUiLoading(false, appState);
            chatUIController.showView('chat');
            ipcBridge.checkConnection();
        }

        // Bind Primary UI Buttons & Input Handlers
        if (sendBtn) {
            sendBtn.addEventListener('click', sendMessage);
        }

        if (newChatBtn) {
            newChatBtn.addEventListener('click', () => {
                if (appState.isWaitingForResponse) {
                    ipcBridge.abort();
                }
                appState.resetChat();
                chatUIController.clearChatContainer();
                chatUIController.resetAssistantStream();
                chatUIController.setUiLoading(false, appState);
                chatUIController.showView('chat');
            });
        }

        /**
         * Auto-resizes the input textarea as user types, up to MAX_HEIGHT.
         */
        function autoResizeInput() {
            if (!messageInput) return;
            messageInput.style.height = 'auto';
            const MAX_HEIGHT = 200;
            const newHeight = Math.min(messageInput.scrollHeight, MAX_HEIGHT);
            messageInput.style.height = `${newHeight}px`;
            messageInput.style.overflowY = messageInput.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
        }

        if (messageInput) {
            messageInput.addEventListener('input', autoResizeInput);
            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
        }

        // Register Incoming IPC Message Handlers
        ipcBridge.on('initialState', (message) => {
            if (message.isRunning) {
                chatUIController.setUiLoading(true, appState);
                if (message.messages && message.messages.length > 0) {
                    appState.messages = message.messages;
                    chatUIController.clearChatContainer();
                    appState.messages.forEach(msg => {
                        if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'file-summary') {
                            chatUIController.appendMessage(msg.role, msg.content);
                        }
                    });
                }
                if (message.streamingText) {
                    chatUIController.currentAssistantText = message.streamingText;
                    chatUIController.appendMessage('assistant', message.streamingText);
                }
            }
        });

        ipcBridge.on('connectionStatus', (message) => {
            if (message.translations) {
                window.KAI_I18N = message.translations;
                if (modeManager && typeof modeManager.updatePlaceholder === 'function') {
                    modeManager.updatePlaceholder(message.translations);
                } else if (messageInput && message.translations.messagePlaceholder) {
                    messageInput.placeholder = message.translations.messagePlaceholder;
                }
                const thinkingLabel = document.getElementById('thinking-toggle-label');
                if (thinkingLabel && message.translations.thinkingToggle) {
                    thinkingLabel.textContent = message.translations.thinkingToggle;
                }
            }
            
            settingsController.updateConnectionStatus(message);
            modelDropdownController.updateConnectionStatus(message);
        });

        ipcBridge.on('addCodeSelection', (message) => {
            appState.selectedCodeContext = message.text;
            if (messageInput) {
                messageInput.focus();
            }
        });

        const handleAgentProgress = (message) => {
            const payload = message.event || message;
            if (payload.type && !payload.progressType) {
                payload.progressType = payload.type;
            }
            chatUIController.handleAgentProgress(payload, appState);
            const session = appState.toChatPayload(modelDropdownController.getSelectedModelDetails().thinking);
            if (payload.progressType === 'tool_start' || payload.progressType === 'tool_end') {
                sessionRepository.saveSession(session);
            } else {
                sessionRepository.markDirty(session);
            }
        };

        ipcBridge.on('agentProgress', handleAgentProgress);
        ipcBridge.on('toolActivity', handleAgentProgress);

        ipcBridge.on('typing', () => {
            chatUIController.setUiLoading(true, appState);
            chatUIController.resetAssistantStream();
        });

        /**
         * Handles final assistant completion replies, updates UI bubble and persists chat history.
         * @param {object} message Reply payload from extension host.
         */
        const handleReply = (message) => {
            chatUIController.setUiLoading(false, appState);

            let forceThinkingCollapsed = null;
            if (chatUIController.currentAssistantMsgElement) {
                const existingThinking = chatUIController.currentAssistantMsgElement.querySelector('.thinking-block');
                if (existingThinking) {
                    forceThinkingCollapsed = existingThinking.classList.contains('collapsed');
                }
            }

            const replyContent = message.content !== undefined ? message.content : (message.text || '');
            const isThinkingChecked = (settingsController && settingsController.showThinkingToggle) 
                ? settingsController.showThinkingToggle.checked 
                : (localStorage.getItem('kai.showThinking') !== 'false');
            const formatted = formatter.formatMarkdown(replyContent, forceThinkingCollapsed, isThinkingChecked);

            const modelDetails = modelDropdownController.getSelectedModelDetails();
            const effectiveMeta = {
                model: modelDetails.model,
                thinking: modelDetails.thinking,
                reasoningEffort: modelDetails.reasoningEffort,
                mode: appState.activeMode,
                tokensPerSecond: message.tokensPerSecond || null
            };

            if (chatUIController.currentAssistantMsgElement && chatUIController.chatContainer && chatUIController.chatContainer.contains(chatUIController.currentAssistantMsgElement)) {
                if (formatted.trim()) {
                    chatUIController.currentAssistantMsgElement.dataset.rawContent = replyContent;
                    const existingActions = chatUIController.currentAssistantMsgElement.querySelector('.message-actions');
                    if (existingActions) {
                        existingActions.remove();
                    }
                    chatUIController.currentAssistantMsgElement.appendChild(chatUIController.createAssistantActionBar(appState.activeMode, effectiveMeta));
                } else {
                    chatUIController.currentAssistantMsgElement.remove();
                }
            } else if (formatted.trim()) {
                chatUIController.appendMessage('assistant', replyContent, appState.activeMode, effectiveMeta);
            }

            if (message.fullHistory && Array.isArray(message.fullHistory)) {
                appState.messages = message.fullHistory;
            } else {
                const lastMsg = appState.messages[appState.messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                    lastMsg.content = replyContent;
                } else {
                    appState.addMessage({ role: 'assistant', content: replyContent });
                }
            }

            appState.finalizeAssistantUiEvent(replyContent, appState.activeMode, effectiveMeta);

            if (message.modifiedFiles && message.modifiedFiles.length > 0) {
                appState.addUiEvent({ type: 'file-summary', files: message.modifiedFiles });
                chatUIController.appendMessage('file-summary', JSON.stringify(message.modifiedFiles));
            }

            if (mermaidRenderer && chatUIController.chatContainer) {
                mermaidRenderer.renderDiagrams(chatUIController.chatContainer);
            }

            saveCurrentChat();
            chatUIController.resetAssistantStream();
        };

        
        ipcBridge.on('ask_user_request', (message) => {
            chatUIController.renderAskUserDock(message, (answer) => {
                ipcBridge.postMessage({
                    type: 'ask_user_response',
                    requestId: message.requestId,
                    answer: answer
                });
            });
        });

        ipcBridge.on('reply', handleReply);
        ipcBridge.on('replyComplete', handleReply);

        ipcBridge.on('replyError', (message) => {
            chatUIController.setUiLoading(false, appState);
            chatUIController.removeActivityStatus();
            const errText = `Error: ${message.message || message.error || 'Request failed'}`;
            appState.addUiEvent({ type: 'system', content: errText });
            chatUIController.appendMessage('system', errText);
            saveCurrentChat();
            chatUIController.resetAssistantStream();
        });

        ipcBridge.on('chatHistory', (message) => {
            const chats = (message && Array.isArray(message.chats)) ? message.chats : [];
            try {
                localStorage.setItem('kai.savedChatsSummary', JSON.stringify(chats));
            } catch (e) {}
            historyManager.renderHistoryList(chats, appState.isWaitingForResponse);
        });

        ipcBridge.on('loadChat', (message) => {
            if (message && message.chat) {
                sessionRepository.saveSession(message.chat);
                loadChatSession(message.chat);
            }
        });

        // Start periodic server connection health checks
        ipcBridge.checkConnection();
        setInterval(() => ipcBridge.checkConnection(), 15000);
    } catch (err) {
        console.error('[KAI Extension Error] Failed to initialize webview:', err);
    }
})();
