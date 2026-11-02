/**
 * ChatUIController controls message bubble rendering, streaming updates,
 * tool status cards, typing indicators, view switching, and auto-scrolling.
 */
class ChatUIController {
    /**
     * Initializes UI references, helper widgets, and event delegation.
     * @param {MarkdownFormatter} formatter Formatter instance.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     * @param {FileSummaryWidget} fileSummaryWidget File summary widget instance.
     * @param {SettingsController} settingsController Settings controller instance.
     * @param {HelpModalController} [helpModalController] Help modal controller instance.
     * @param {ModelDropdownController} [modelDropdownController] Model dropdown controller instance.
     * @param {MermaidRenderer} [mermaidRenderer] Mermaid renderer instance.
     */
    constructor(formatter, ipcBridge, fileSummaryWidget, settingsController, helpModalController, modelDropdownController, mermaidRenderer = null) {
        this.formatter = formatter;
        this.ipcBridge = ipcBridge;
        this.fileSummaryWidget = fileSummaryWidget;
        this.settingsController = settingsController;
        this.helpModalController = helpModalController;
        this.modelDropdownController = modelDropdownController;
        this.mermaidRenderer = mermaidRenderer;

        this.chatContainer = document.getElementById('chat-container');
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.thinkingToggle = document.getElementById('thinking-toggle');
        this.chatView = document.getElementById('chat-view');
        this.historyContainer = document.getElementById('history-container');
        this.settingsContainer = document.getElementById('settings-container');
        this.settingsBtn = document.getElementById('settings-btn');
        this.closeSettingsBtn = document.getElementById('close-settings-btn');

        this.currentAssistantMsgElement = null;
        this.currentAssistantText = '';
        this.renderedWordCount = 0;

        const storedExtraDelay = parseInt(localStorage.getItem('kai.streamSettleDelay') || '0', 10);
        const baseDelay = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--stream-settle-base-delay'), 10) || 150;
        const initialSettleDelay = baseDelay + (isNaN(storedExtraDelay) ? 0 : storedExtraDelay);
        this.streamPipeline = new StreamBufferPipeline((committedText) => this.renderStreamProgress(committedText), initialSettleDelay);

        // Callbacks for retry and edit prompt
        this.onRetry = null;
        this.onEditPrompt = null;

        this.initEventListeners();
        this.renderWelcomeHero();
    }

    /**
     * Updates the stream buffer settle lookahead delay dynamically based on CSS root base delay + extra delay.
     * @param {number} extraMs User-configured delay increment on top of base delay.
     */
    setStreamSettleDelay(extraMs) {
        const validExtra = typeof extraMs === 'number' && !isNaN(extraMs) ? extraMs : 0;
        const baseDelay = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--stream-settle-base-delay'), 10) || 150;
        const effective = baseDelay + validExtra;
        if (this.streamPipeline && typeof this.streamPipeline.setSettleDelay === 'function') {
            this.streamPipeline.setSettleDelay(effective);
        }
    }

    /**
     * Registers settings button, close settings button, and container event delegation.
     */
    initEventListeners() {
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => {
                this.showView('settings');
            });
        }

        if (this.closeSettingsBtn) {
            this.closeSettingsBtn.addEventListener('click', () => {
                if (this.settingsController) {
                    this.settingsController.hideKeysOverlay();
                }
                this.showView('chat');
            });
        }

        if (this.chatContainer) {
            this.chatContainer.addEventListener('click', (e) => {
                // 1. Welcome Help button
                const helpBtn = e.target.closest('#welcome-help-btn');
                if (helpBtn) {
                    if (this.helpModalController) {
                        this.helpModalController.open();
                    } else {
                        this.showView('settings');
                    }
                    return;
                }

                // 2. Welcome README button (Opens GitHub repository README in default browser)
                const readmeBtn = e.target.closest('#welcome-readme-btn');
                if (readmeBtn) {
                    const url = 'https://github.com/kenjikellens/Kai-Agent#readme';
                    if (this.ipcBridge && typeof this.ipcBridge.openExternalUrl === 'function') {
                        this.ipcBridge.openExternalUrl(url);
                    } else {
                        window.open(url, '_blank', 'noopener,noreferrer');
                    }
                    return;
                }

                // 3. Open file in VS Code editor when clicking file cards
                const fileCard = e.target.closest('.file-card');
                if (fileCard) {
                    const filePath = fileCard.dataset.filepath;
                    if (filePath) {
                        this.ipcBridge.openFile(filePath);
                    }
                    return;
                }

                // 4. Toggle tool execution result output dropdown
                const toolRow = e.target.closest('.tool-status-row');
                if (toolRow) {
                    const dropdown = toolRow.querySelector('.tool-result-dropdown');
                    if (dropdown) {
                        dropdown.classList.toggle('hidden');
                        toolRow.classList.toggle('expanded');
                    }
                    return;
                }

                // 5. Collapsible thinking block trigger
                const header = e.target.closest('.thinking-header');
                if (header) {
                    ThinkingBlockComponent.toggle(header);
                    return;
                }

                // 5b. Collapsible implementation plan card trigger
                const planHeader = e.target.closest('.kai-plan-header');
                if (planHeader) {
                    const card = planHeader.closest('.kai-plan-card');
                    if (card) {
                        const isExpanded = card.classList.toggle('expanded');
                        const label = planHeader.querySelector('.plan-toggle-label');
                        if (label) {
                            label.textContent = isExpanded ? 'Show less' : 'Show more';
                        }
                    }
                    return;
                }

                // 6. Copy code snippet button
                const copyBtn = e.target.closest('.copy-code-btn');
                if (copyBtn) {
                    const wrapper = copyBtn.closest('.code-block-wrapper');
                    const codeEl = wrapper ? wrapper.querySelector('pre code') : null;
                    if (codeEl) {
                        const textToCopy = codeEl.textContent || '';
                        navigator.clipboard.writeText(textToCopy).then(() => {
                            const originalHTML = copyBtn.innerHTML;
                            copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                            copyBtn.classList.add('copied');
                            setTimeout(() => {
                                copyBtn.innerHTML = originalHTML;
                                copyBtn.classList.remove('copied');
                            }, 1600);
                        });
                    }
                    return;
                }

                // 7. Download code snippet file button
                const downloadBtn = e.target.closest('.download-code-btn');
                if (downloadBtn) {
                    const wrapper = downloadBtn.closest('.code-block-wrapper');
                    const codeEl = wrapper ? wrapper.querySelector('pre code') : null;
                    if (codeEl) {
                        const textToDownload = codeEl.textContent || '';
                        const lang = (downloadBtn.dataset.lang || 'txt').toLowerCase();
                        const extMap = {
                            python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
                            html: 'html', css: 'css', json: 'json', csharp: 'cs', cs: 'cs', cpp: 'cpp', c: 'c',
                            java: 'java', rust: 'rs', rs: 'rs', go: 'go', sql: 'sql', sh: 'sh', bash: 'sh',
                            powershell: 'ps1', ps1: 'ps1', yaml: 'yml', yml: 'yml', markdown: 'md', md: 'md',
                            xml: 'xml', php: 'php', ruby: 'rb', rb: 'rb'
                        };
                        const ext = extMap[lang] || 'txt';
                        const blob = new Blob([textToDownload], { type: 'text/plain;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `snippet_${Date.now()}.${ext}`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                    return;
                }

                // 8. Copy full response button on assistant message
                const copyRespBtn = e.target.closest('.copy-response-btn');
                if (copyRespBtn) {
                    const assistantMsg = copyRespBtn.closest('.assistant-message');
                    if (assistantMsg) {
                        const rawText = assistantMsg.dataset.rawContent || (assistantMsg.querySelector('.message-content') ? assistantMsg.querySelector('.message-content').innerText : '') || '';
                        navigator.clipboard.writeText(rawText).then(() => {
                            const originalHTML = copyRespBtn.innerHTML;
                            copyRespBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                            copyRespBtn.classList.add('copied');
                            setTimeout(() => {
                                copyRespBtn.innerHTML = originalHTML;
                                copyRespBtn.classList.remove('copied');
                            }, 1600);
                        });
                    }
                    return;
                }

                // 8a. Mermaid diagram tabs switching (Diagram vs Code view)
                const mermaidTabBtn = e.target.closest('.mermaid-tab-btn');
                if (mermaidTabBtn) {
                    const card = mermaidTabBtn.closest('.mermaid-diagram-card');
                    const tabName = mermaidTabBtn.dataset.tab;
                    if (card && tabName && this.mermaidRenderer) {
                        this.mermaidRenderer.setActiveTab(card, tabName);
                    }
                    return;
                }

                // 8a2. Copy Mermaid code button
                const copyMermaidCodeBtn = e.target.closest('.copy-mermaid-code-btn');
                if (copyMermaidCodeBtn) {
                    const card = copyMermaidCodeBtn.closest('.mermaid-diagram-card');
                    if (card && this.mermaidRenderer) {
                        this.mermaidRenderer.copyMermaidCode(card, copyMermaidCodeBtn);
                    }
                    return;
                }

                // 8a3. Copy Mermaid rendered SVG button
                const copyMermaidSvgBtn = e.target.closest('.copy-mermaid-svg-btn');
                if (copyMermaidSvgBtn) {
                    const card = copyMermaidSvgBtn.closest('.mermaid-diagram-card');
                    if (card && this.mermaidRenderer) {
                        this.mermaidRenderer.copyMermaidSvg(card, copyMermaidSvgBtn);
                    }
                    return;
                }

                // 8a4. Download Mermaid rendered SVG button
                const downloadMermaidSvgBtn = e.target.closest('.download-mermaid-svg-btn');
                if (downloadMermaidSvgBtn) {
                    const card = downloadMermaidSvgBtn.closest('.mermaid-diagram-card');
                    if (card && this.mermaidRenderer) {
                        this.mermaidRenderer.downloadMermaidSvg(card);
                    }
                    return;
                }

                // 8b. Toggle Raw text button on assistant message
                const rawToggleBtn = e.target.closest('.toggle-raw-btn');
                if (rawToggleBtn) {
                    const assistantMsg = rawToggleBtn.closest('.assistant-message');
                    if (assistantMsg) {
                        const contentEl = assistantMsg.querySelector('.message-content');
                        if (contentEl) {
                            const isRaw = assistantMsg.classList.toggle('show-raw-mode');
                            rawToggleBtn.classList.toggle('active', isRaw);
                            const rawText = assistantMsg.dataset.rawContent || '';
                            if (isRaw) {
                                contentEl.dataset.formattedHtml = contentEl.innerHTML;
                                const existingThinking = contentEl.querySelector('.thinking-block');
                                const wasCollapsed = existingThinking ? existingThinking.classList.contains('collapsed') : null;
                                contentEl.innerHTML = this.formatter.formatRawContent(rawText, wasCollapsed);
                            } else {
                                if (contentEl.dataset.formattedHtml) {
                                    contentEl.innerHTML = contentEl.dataset.formattedHtml;
                                } else {
                                    contentEl.innerHTML = this.formatter.formatMarkdown(rawText);
                                }
                            }
                        }
                    }
                    return;
                }

                // 9. Retry / Redo button on assistant message
                const retryBtn = e.target.closest('.retry-btn');
                if (retryBtn) {
                    const assistantMsg = retryBtn.closest('.assistant-message');
                    if (assistantMsg && typeof this.onRetry === 'function') {
                        this.onRetry(assistantMsg);
                    }
                    return;
                }

                // 10. Edit prompt button next to user message (opens inline editor inside chat bubble)
                const editPromptBtn = e.target.closest('.edit-prompt-btn');
                if (editPromptBtn) {
                    const userRow = editPromptBtn.closest('.user-message-row');
                    if (userRow) {
                        this.openInlineEditor(userRow);
                    }
                    return;
                }

                // 11. Cancel button inside inline prompt editor
                const cancelBtn = e.target.closest('.inline-cancel-btn');
                if (cancelBtn) {
                    const userRow = cancelBtn.closest('.user-message-row');
                    if (userRow) {
                        this.closeInlineEditor(userRow);
                    }
                    return;
                }

                // 12. Send button inside inline prompt editor
                const inlineSendBtn = e.target.closest('.inline-send-btn');
                if (inlineSendBtn) {
                    const userRow = inlineSendBtn.closest('.user-message-row');
                    if (userRow) {
                        this.submitInlineEditor(userRow);
                    }
                    return;
                }
            });

            // Double-click on a user chat bubble to trigger inline editing
            this.chatContainer.addEventListener('dblclick', (e) => {
                const userBubble = e.target.closest('.user-message');
                if (userBubble) {
                    const userRow = userBubble.closest('.user-message-row');
                    if (userRow && !userRow.classList.contains('is-editing')) {
                        this.openInlineEditor(userRow);
                    }
                }
            });
        }
    }

    /**
     * Opens an inline editor inside the specified user message row bubble.
     * Replaces the prompt bubble with an editable textarea while preserving any attached gallery above.
     * @param {HTMLElement} userRow The .user-message-row container.
     */
    openInlineEditor(userRow) {
        if (!userRow || userRow.classList.contains('is-editing')) return;

        if (this.chatContainer) {
            this.chatContainer.querySelectorAll('.user-message-row.is-editing').forEach(row => {
                this.closeInlineEditor(row);
            });
        }

        const rawPrompt = userRow.dataset.rawPrompt || (userRow.querySelector('.message-content') ? userRow.querySelector('.message-content').innerText.trim() : '');
        userRow.classList.add('is-editing');

        const messageBubble = userRow.querySelector('.message.user-message');
        const editBtn = userRow.querySelector('.edit-prompt-btn');
        if (messageBubble) messageBubble.classList.add('hidden');
        if (editBtn) editBtn.classList.add('hidden');

        const sendSvg = window.KAI_SVGS['send'] || '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        const cancelSvg = window.KAI_SVGS['cancel'] || '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

        const editorDiv = document.createElement('div');
        editorDiv.className = 'inline-prompt-editor';
        editorDiv.innerHTML = `
            <textarea class="inline-prompt-textarea" rows="2">${this.formatter.escapeHtml(rawPrompt)}</textarea>
            <div class="inline-editor-actions">
                <button type="button" class="inline-action-btn inline-cancel-btn" title="Cancel">
                    ${cancelSvg}
                </button>
                <button type="button" class="inline-action-btn inline-send-btn" title="Send">
                    ${sendSvg}
                </button>
            </div>
        `;

        const textarea = editorDiv.querySelector('.inline-prompt-textarea');
        const autoResize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
        };

        textarea.addEventListener('input', autoResize);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitInlineEditor(userRow);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeInlineEditor(userRow);
            }
        });

        const bubbleWrapper = userRow.querySelector('.user-message-bubble-wrapper');
        if (bubbleWrapper) {
            bubbleWrapper.appendChild(editorDiv);
        } else {
            userRow.appendChild(editorDiv);
        }
        autoResize();
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    /**
     * Cancels inline editing and restores normal message bubble view.
     * Removes the active textarea editor and unhides the user bubble and edit button.
     * @param {HTMLElement} userRow The .user-message-row container.
     */
    closeInlineEditor(userRow) {
        if (!userRow) return;
        const editor = userRow.querySelector('.inline-prompt-editor');
        if (editor) editor.remove();

        const messageBubble = userRow.querySelector('.message.user-message');
        const editBtn = userRow.querySelector('.edit-prompt-btn');
        if (messageBubble) messageBubble.classList.remove('hidden');
        if (editBtn) editBtn.classList.remove('hidden');

        userRow.classList.remove('is-editing');
    }

    /**
     * Submits the edited prompt from inside the inline editor.
     * @param {HTMLElement} userRow The .user-message-row container.
     */
    submitInlineEditor(userRow) {
        if (!userRow) return;
        const textarea = userRow.querySelector('.inline-prompt-textarea');
        const newText = textarea ? textarea.value.trim() : '';

        if (!newText) {
            this.closeInlineEditor(userRow);
            return;
        }

        if (typeof this.onEditPrompt === 'function') {
            this.onEditPrompt(userRow, newText);
        }
    }

    /**
     * Renders centered Welcome Hero in chat container when there are no messages.
     */
    renderWelcomeHero() {
        if (!this.chatContainer) return;
        const i18n = window.KAI_I18N || {};
        const svgs = window.KAI_SVGS || {};

        const heroDiv = document.createElement('div');
        heroDiv.className = 'welcome-hero-container';
        heroDiv.id = 'welcome-hero';

        const logoSvg = svgs['kai_icon'] || '<svg width="24" height="24" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="7.5" y="1" width="1" height="2" fill="currentColor"/><circle cx="8" cy="1" r="0.8" fill="currentColor"/><rect x="2" y="6" width="1" height="3" rx="0.5" fill="currentColor"/><rect x="13" y="6" width="1" height="3" rx="0.5" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" d="M4 4.5 h8 a0.5 0.5 0 0 1 0.5 0.5 v5.5 a0.5 0.5 0 0 1 -0.5 0.5 h-6 l-2 2 v-2 h-0.5 a0.5 0.5 0 0 1 -0.5 -0.5 v-5.5 a0.5 0.5 0 0 1 0.5 -0.5 z"/><rect x="5.5" y="6.5" width="1.2" height="1.2" fill="currentColor"/><rect x="9.3" y="6.5" width="1.2" height="1.2" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" d="M6 9.2 Q8 10.5 10 9.2"/></svg>';

        heroDiv.innerHTML = `
            <div class="welcome-badge-icon">
                ${logoSvg}
            </div>
            <div class="welcome-title">${i18n.welcomeTitle || 'Welcome to Kai'}</div>
            <div class="welcome-hint">${i18n.welcomePromptHint || 'Ask a question, edit code, or attach files to begin'}</div>
            <div class="welcome-links-row">
                <button type="button" class="welcome-link-btn" id="welcome-help-btn">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    <span>${i18n.help || 'Help'}</span>
                </button>
                <button type="button" class="welcome-link-btn" id="welcome-readme-btn">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                    <span>${i18n.readme || 'README'}</span>
                </button>
            </div>
        `;

        this.chatContainer.innerHTML = '';
        this.chatContainer.appendChild(heroDiv);
    }

    /**
     * Removes the welcome hero container from the chat view.
     */
    removeWelcomeHero() {
        const hero = document.getElementById('welcome-hero');
        if (hero) {
            hero.remove();
        }
    }

    /**
     * Resets the active assistant streaming DOM element reference, accumulated text buffer, and word counter.
     */
    resetAssistantStream() {
        if (this.streamPipeline) {
            this.streamPipeline.reset();
        }
        this.currentAssistantMsgElement = null;
        this.currentAssistantText = '';
        this.renderedWordCount = 0;
    }

    /**
     * Wraps words in HTML text nodes with .kai-word-fade during streaming.
     * Skips pre/code blocks, svg, buttons, and HTML tags to avoid breaking markup and syntax highlighting.
     * @param {string} html Formatted HTML string.
     * @returns {string} Processed HTML with word fade spans applied to text tokens.
     */
    applyStreamingWordFade(html) {
        if (!html) return '';
        const parts = html.split(/(<[^>]+>)/g);
        let inCodeOrBlock = false;
        let result = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part) continue;

            if (part.startsWith('<')) {
                if (/^<\s*(?:pre|code|svg|button|script|style)\b/i.test(part)) {
                    inCodeOrBlock = true;
                } else if (/^<\/\s*(?:pre|code|svg|button|script|style)\s*>/i.test(part)) {
                    inCodeOrBlock = false;
                }
                result += part;
            } else {
                if (inCodeOrBlock) {
                    result += part;
                } else {
                    const transformed = part.replace(/(\S+)/g, '<span class="kai-word-fade">$1</span>');
                    result += transformed;
                }
            }
        }
        return result;
    }

    /**
     * Incrementally morphs target DOM element to match source DOM nodes without destroying untouched nodes.
     * Preserves active CSS animations on existing elements while smoothly introducing newly appended nodes.
     * @param {HTMLElement} target The existing DOM element to update.
     * @param {DocumentFragment|HTMLElement} source The new DOM tree to sync from.
     */
    morphDOM(target, source) {
        const targetNodes = Array.from(target.childNodes);
        const sourceNodes = Array.from(source.childNodes);

        // 1. Remove excess target nodes
        while (targetNodes.length > sourceNodes.length) {
            const excess = targetNodes.pop();
            if (excess && excess.parentNode) excess.parentNode.removeChild(excess);
        }

        // 2. Diff and patch node by node
        for (let i = 0; i < sourceNodes.length; i++) {
            const sNode = sourceNodes[i];
            const tNode = targetNodes[i];

            if (!tNode) {
                target.appendChild(sNode.cloneNode(true));
                continue;
            }

            if (tNode.nodeType !== sNode.nodeType || tNode.nodeName !== sNode.nodeName) {
                target.replaceChild(sNode.cloneNode(true), tNode);
                continue;
            }

            if (tNode.nodeType === Node.TEXT_NODE) {
                if (tNode.nodeValue !== sNode.nodeValue) {
                    tNode.nodeValue = sNode.nodeValue;
                }
                continue;
            }

            if (tNode.nodeType === Node.ELEMENT_NODE) {
                const tAttrs = tNode.attributes;
                const sAttrs = sNode.attributes;

                for (let a = tAttrs.length - 1; a >= 0; a--) {
                    const attrName = tAttrs[a].name;
                    if (!sNode.hasAttribute(attrName)) {
                        tNode.removeAttribute(attrName);
                    }
                }

                for (let a = 0; a < sAttrs.length; a++) {
                    const attr = sAttrs[a];
                    if (tNode.getAttribute(attr.name) !== attr.value) {
                        tNode.setAttribute(attr.name, attr.value);
                    }
                }

                this.morphDOM(tNode, sNode);
            }
        }
    }

    /**
     * Creates an action toolbar containing Copy Response, View Raw, Retry buttons, and an Info button for assistant messages.
     * @param {string} [mode] The mode under which the reply was generated ('agent' | 'planning' | 'ask').
     * @param {object} [meta] Additional metadata including model and thinking parameters.
     * @returns {HTMLElement} The actions toolbar element.
     */
    createAssistantActionBar(mode, meta = {}) {
        const bar = document.createElement('div');
        bar.className = 'message-actions';

        const copySvg = window.KAI_SVGS['copy_response'] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        const retrySvg = window.KAI_SVGS['retry'] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
        const rawSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
        const infoSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

        const rawModelName = meta.model || (this.settingsController ? this.settingsController.getSelectedModel() : '') || localStorage.getItem('kai.selectedModel') || 'Local Model';
        const displayModelName = this.formatter.formatModelName(rawModelName);
        const effectiveMode = mode || meta.mode || 'agent';
        const modeLabel = effectiveMode === 'planning' ? 'Plan' : (effectiveMode.charAt(0).toUpperCase() + effectiveMode.slice(1));

        // Inspect thinking and reasoning capabilities
        const caps = ThinkingStateFormatter.getCapabilitiesState(rawModelName);
        const hasThinkingSupport = caps.hasThinkingToggle || caps.hasReasoningEffort;
        
        let thinkingText = 'Not supported';
        if (hasThinkingSupport) {
            const isThinkingOn = meta.thinking !== undefined ? meta.thinking : caps.isThinkingOn;
            thinkingText = isThinkingOn ? 'On' : 'Off';
        }

        // Only show the Reasoning row if the model actually has reasoning effort / levels
        let reasoningRowHtml = '';
        if (caps.hasReasoningEffort) {
            const isThinkingOn = meta.thinking !== undefined ? meta.thinking : caps.isThinkingOn;
            const effort = meta.reasoningEffort || caps.reasoningLevel || '';
            const reasoningVal = !isThinkingOn ? 'Off' : (effort && effort !== 'none' ? effort : 'Default');
            reasoningRowHtml = `
                    <div class="info-popover-row">
                        <span class="info-popover-label">Reasoning:</span>
                        <span class="info-popover-value">${this.formatter.escapeHtml(reasoningVal)}</span>
                    </div>`;
        }

        // Speed (Tokens Per Second) row - strictly for local LM Studio models
        let speedRowHtml = '';
        const resolver = typeof ModelProviderResolver !== 'undefined' ? new ModelProviderResolver() : null;
        const isCloudModel = resolver ? !!resolver.getProviderInfo(rawModelName) : false;
        if (!isCloudModel && meta.tokensPerSecond) {
            speedRowHtml = `
                    <div class="info-popover-row">
                        <span class="info-popover-label" data-i18n="speed">Speed:</span>
                        <span class="info-popover-value">${this.formatter.escapeHtml(meta.tokensPerSecond)}</span>
                    </div>`;
        }

        bar.innerHTML = `
            <button type="button" class="icon-btn copy-response-btn" title="Copy response">
                ${copySvg}
            </button>
            <button type="button" class="icon-btn toggle-raw-btn" title="View raw markdown">
                ${rawSvg}
            </button>
            <button type="button" class="icon-btn retry-btn" title="Retry / Undo turn">
                ${retrySvg}
            </button>
            <div class="message-info-container">
                <button type="button" class="icon-btn" title="Message Details (Model & Settings)">
                    ${infoSvg}
                </button>
                <div class="msg-info-popover">
                    <div class="info-popover-row">
                        <span class="info-popover-label">Model:</span>
                        <span class="info-popover-value" title="${this.formatter.escapeHtml(rawModelName)}">${this.formatter.escapeHtml(displayModelName)}</span>
                    </div>
                    <div class="info-popover-row">
                        <span class="info-popover-label">Mode:</span>
                        <span class="info-popover-value">${this.formatter.escapeHtml(modeLabel)}</span>
                    </div>
                    <div class="info-popover-row">
                        <span class="info-popover-label">Thinking:</span>
                        <span class="info-popover-value">${this.formatter.escapeHtml(thinkingText)}</span>
                    </div>${reasoningRowHtml}${speedRowHtml}
                </div>
            </div>
        `;
        return bar;
    }

    /**
     * Appends a message bubble and optional attachments into the chat container.
     * Positions user attachment galleries above the prompt bubble and handles assistant streaming states.
     * @param {string} role Sender role ('user', 'assistant', 'system', or 'file-summary').
     * @param {string} text Message content string.
     * @param {string|Array} [mode] Active mode for assistant messages or attached files array for user messages.
     * @param {object} [meta] Metadata for model, thinking, or attached files.
     */
    appendMessage(role, text, mode, meta = {}) {
        this.removeWelcomeHero();

        if (role === 'user') {
            this.resetAssistantStream();
            if (!text || 
                text.startsWith('[Tool Result') || 
                text.startsWith('[Tool Execution') || 
                text.startsWith('[Tool Error') || 
                text.startsWith('[Execution Output') || 
                text.startsWith('[Tool Call') || 
                text.includes('[Tool Result for')) {
                return;
            }
        }

        if (role === 'file-summary') {
            let files = [];
            try {
                files = JSON.parse(text);
            } catch (e) {
                files = [];
            }
            const widgetEl = this.fileSummaryWidget.renderWidget(files, this.formatter);
            if (widgetEl && this.chatContainer) {
                this.chatContainer.appendChild(widgetEl);
                this.scrollToBottom();
            }
            return;
        }

        const formatted = this.formatter.formatMarkdown(text);
        if (!formatted.trim()) return;

        if (role === 'user') {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'user-message-row';
            rowDiv.dataset.rawPrompt = text;

            // Render attached images and files gallery directly above user message bubble
            const attachedFiles = (arguments[2] && Array.isArray(arguments[2]))
                ? arguments[2]
                : (meta && Array.isArray(meta.attachedFiles)
                    ? meta.attachedFiles
                    : (window.appState && Array.isArray(window.appState.lastAttachedFiles) ? window.appState.lastAttachedFiles : []));

            if (attachedFiles && attachedFiles.length > 0) {
                const gallery = document.createElement('div');
                gallery.className = 'user-message-attachments-gallery';
                for (const f of attachedFiles) {
                    const isImg = (f.content && typeof f.content === 'string' && f.content.startsWith('data:image/')) ||
                                  (f.dataUrl && typeof f.dataUrl === 'string' && f.dataUrl.startsWith('data:image/')) ||
                                  f.isImage;
                    if (isImg && (f.content || f.dataUrl)) {
                        const img = document.createElement('img');
                        img.className = 'user-attached-image';
                        img.src = f.content || f.dataUrl;
                        img.alt = f.fileName || 'Attached Image';
                        gallery.appendChild(img);
                    } else {
                        const pill = document.createElement('div');
                        pill.className = 'user-attached-pill';
                        const fileSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
                        pill.innerHTML = `${fileSvg}<span>${this.formatter.escapeHtml(f.fileName || 'file')}</span>`;
                        gallery.appendChild(pill);
                    }
                }
                rowDiv.appendChild(gallery);
            }

            const bubbleWrapper = document.createElement('div');
            bubbleWrapper.className = 'user-message-bubble-wrapper';

            const editSvg = window.KAI_SVGS['edit_prompt'] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'edit-prompt-btn';
            editBtn.title = 'Edit prompt';
            editBtn.innerHTML = editSvg;

            const isMulti = text && (text.includes('\n') || text.length > 80);
            const messageDiv = document.createElement('div');
            messageDiv.className = `message user-message${isMulti ? ' is-multiline' : ''}`;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = formatted;
            messageDiv.appendChild(contentDiv);

            bubbleWrapper.appendChild(editBtn);
            bubbleWrapper.appendChild(messageDiv);
            rowDiv.appendChild(bubbleWrapper);

            if (this.chatContainer) {
                this.chatContainer.appendChild(rowDiv);
                this.scrollToBottom();
            }
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}-message`;
        if (role === 'assistant') {
            messageDiv.dataset.rawContent = text;
            if (mode) messageDiv.dataset.mode = mode;
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = formatted;
        messageDiv.appendChild(contentDiv);

        if (role === 'assistant') {
            messageDiv.appendChild(this.createAssistantActionBar(mode, meta));
        }

        if (this.chatContainer) {
            this.chatContainer.appendChild(messageDiv);
            this.scrollToBottom();
            if (this.mermaidRenderer) {
                this.mermaidRenderer.renderDiagrams(this.chatContainer);
            }
        }
    }

    /**
     * Handles streaming agent progress updates from extension host.
     * @param {object} progress Progress event object.
     * @param {AppState} appState Active state instance.
     */
    handleAgentProgress(progress, appState) {
        if (progress.progressType === 'status_update') {
            const statusText = progress.text || progress.output || 'Processing...';
            this.updateActivityStatus(statusText);
        } else if (progress.progressType === 'token') {
            this.removeActivityStatus();
            this.currentAssistantText += progress.output;
            appState.updateOrAddAssistantUiEvent(this.currentAssistantText);
            this.streamPipeline.append(progress.output);
        } else if (progress.progressType === 'tool_start') {
            if (this.streamPipeline) {
                this.streamPipeline.flushImmediate();
            }
            this.removeActivityStatus();
            appState.finalizeAssistantUiEvent();
            if (this.currentAssistantMsgElement) {
                const contentEl = this.currentAssistantMsgElement.querySelector('.message-content');
                if (contentEl) {
                    const cleaned = (this.currentAssistantText || '')
                        .replace(/<\|?(?:tool_call|tool|execute_plan|action)\|?>[\s\S]*?(?:<\|?\/(?:tool_call|tool|execute_plan|action)\|?>|<\|?(?:tool_call|tool|execute_plan|action)\|?>|$)/gi, '')
                        .replace(/<\|?tool[\s\S]*$/gi, '')
                        .replace(/<\|?\/tool[\s\S]*$/gi, '')
                        .replace(/<\|[\s\S]*$/gi, '')
                        .trim();
                    this.currentAssistantText = cleaned;
                    if (!cleaned) {
                        this.currentAssistantMsgElement.remove();
                        this.currentAssistantMsgElement = null;
                    } else {
                        contentEl.innerHTML = this.formatter.formatMarkdown(cleaned);
                    }
                }
            }
            this.resetAssistantStream();
            
            let existingDiv = document.getElementById(progress.toolId);
            if (existingDiv) {
                existingDiv.innerHTML = this.getToolDescription(progress.tool, progress.fileName, 'start');
                const evt = appState.uiEvents.find(e => e.type === 'tool' && e.toolId === progress.toolId);
                if (evt) {
                    evt.tool = progress.tool;
                    evt.fileName = progress.fileName;
                }
            } else {
                appState.addUiEvent({
                    type: 'tool',
                    toolId: progress.toolId,
                    tool: progress.tool,
                    fileName: progress.fileName,
                    state: 'start'
                });

                const statusDiv = document.createElement('div');
                statusDiv.id = progress.toolId;
                statusDiv.className = 'tool-status-row in-progress';
                statusDiv.innerHTML = this.getToolDescription(progress.tool, progress.fileName, 'start');
                if (this.chatContainer) {
                    this.chatContainer.appendChild(statusDiv);
                }
            }
        } else if (progress.progressType === 'tool_end') {
        } else if (progress.progressType === 'tool_end') {
            const isError = progress.output && (
                progress.output.startsWith('[Error') || 
                progress.output.startsWith('[Execution Cancelled]')
            );

            const evt = appState.uiEvents.find(e => e.type === 'tool' && e.toolId === progress.toolId);
            if (evt) {
                evt.state = isError ? 'error' : 'success';
                evt.output = progress.output || '';
            }

            const statusDiv = document.getElementById(progress.toolId);
            if (statusDiv) {
                statusDiv.className = `tool-status-row ${isError ? 'errored' : 'completed'}`;
                statusDiv.innerHTML = this.getToolDescription(progress.tool, progress.fileName, isError ? 'error' : 'success');
                
                if (progress.output) {
                    const dropdownDiv = document.createElement('div');
                    dropdownDiv.className = 'tool-result-dropdown hidden';
                    dropdownDiv.innerHTML = `<pre><code>${this.formatter.escapeHtml(progress.output)}</code></pre>`;
                    statusDiv.appendChild(dropdownDiv);
                }
            }
        } else if (progress.progressType === 'agent_warning') {
            const warning = progress.output || 'The agent stopped before completing the task.';
            appState.addUiEvent({ type: 'system', content: warning });
            this.appendMessage('system', warning);
        }
        this.scrollToBottom();
    }

    /**
     * Renders committed streaming text to the active assistant message bubble.
     * @param {string} committedText Text that has settled through the lookahead pipeline.
     */
    renderStreamProgress(committedText) {
        if (!committedText) return;

        let forceThinkingCollapsed = null;
        let forcePlanExpanded = null;
        if (this.currentAssistantMsgElement) {
            const existingThinking = this.currentAssistantMsgElement.querySelector('.thinking-block');
            if (existingThinking) {
                forceThinkingCollapsed = existingThinking.classList.contains('collapsed');
            }
            const existingPlan = this.currentAssistantMsgElement.querySelector('.kai-plan-card');
            if (existingPlan) {
                forcePlanExpanded = existingPlan.classList.contains('expanded');
            }
        }

        const isThinkingChecked = (this.settingsController && this.settingsController.showThinkingToggle) 
            ? this.settingsController.showThinkingToggle.checked 
            : (localStorage.getItem('kai.showThinking') !== 'false');
        const formatted = this.formatter.formatMarkdown(committedText, forceThinkingCollapsed, isThinkingChecked, forcePlanExpanded);
        
        if (formatted.trim()) {
            if (!this.currentAssistantMsgElement || (this.chatContainer && !this.chatContainer.contains(this.currentAssistantMsgElement))) {
                this.removeActivityStatus();
                this.currentAssistantMsgElement = document.createElement('div');
                this.currentAssistantMsgElement.className = 'message assistant-message';
                const contentDiv = document.createElement('div');
                contentDiv.className = 'message-content';
                this.currentAssistantMsgElement.appendChild(contentDiv);
                if (this.chatContainer) {
                    this.chatContainer.appendChild(this.currentAssistantMsgElement);
                }
            }
            this.currentAssistantMsgElement.dataset.rawContent = committedText;
            const contentEl = this.currentAssistantMsgElement.querySelector('.message-content');
            const animatedHtml = this.applyStreamingWordFade(formatted);
            const tmpl = document.createElement('template');
            tmpl.innerHTML = animatedHtml;
            this.morphDOM(contentEl, tmpl.content);

            // Ensure action bar is removed while actively streaming
            const existingActions = this.currentAssistantMsgElement.querySelector('.message-actions');
            if (existingActions) {
                existingActions.remove();
            }

            const thinkingBlockEl = this.currentAssistantMsgElement.querySelector('.thinking-block');
            const thinkingContentEl = this.currentAssistantMsgElement.querySelector('.thinking-content');
            if (thinkingBlockEl && thinkingContentEl && !committedText.includes('</think>')) {
                if (!thinkingBlockEl.classList.contains('collapsed')) {
                    thinkingContentEl.scrollTop = thinkingContentEl.scrollHeight;
                }
            }

            this.scrollToBottom();
        }
    }

    /**
     * Translates tool name and arguments into SVG icons and status header HTML.
     * @param {string} tool Tool identifier name.
     * @param {string} targetName Tool argument target name.
     * @param {string} state Execution state ('start', 'success', 'error').
     * @returns {string} Status header HTML string.
     */
    getToolDescription(tool, targetName, state) {
        const svgs = window.KAI_SVGS || (typeof KAI_CONSTANTS !== 'undefined' ? KAI_CONSTANTS.DEFAULT_SVGS : {}) || {};
        const iconSvg = svgs[tool] || svgs['default_tool'] || '';
        let verb = '';
        
        switch (tool) {
            case 'read_file':
                verb = state === 'start' ? 'analysing' : (state === 'success' ? 'analysed' : 'failed analysing');
                break;
            case 'write_file':
                verb = state === 'start' ? 'creating' : (state === 'success' ? 'created' : 'failed creating');
                break;
            case 'edit_file':
            case 'replace_file_content':
            case 'multi_replace_file_content':
                verb = state === 'start' ? 'editing' : (state === 'success' ? 'edited' : 'failed editing');
                break;
            case 'list_dir':
                verb = state === 'start' ? 'scanning' : (state === 'success' ? 'scanned' : 'failed scanning');
                break;
            case 'grep_search':
            case 'search_web':
            case 'web_search':
                verb = state === 'start' ? 'searching' : (state === 'success' ? 'searched' : 'failed searching');
                break;
            case 'symbol_search':
                verb = state === 'start' ? 'indexing symbols' : (state === 'success' ? 'found symbols' : 'failed symbol search');
                break;
            case 'get_diagnostics':
                verb = state === 'start' ? 'checking diagnostics' : (state === 'success' ? 'checked diagnostics' : 'failed diagnostics');
                break;
            case 'fetch_url':
                verb = state === 'start' ? 'fetching' : (state === 'success' ? 'fetched' : 'failed fetching');
                break;
            case 'run_command':
                verb = state === 'start' ? 'running' : (state === 'success' ? 'ran' : 'failed running');
                break;
            case 'delete_item':
                verb = state === 'start' ? 'deleting' : (state === 'success' ? 'deleted' : 'failed deleting');
                break;
            case 'utility_tools':
                verb = state === 'start' ? 'running utility' : (state === 'success' ? 'completed utility' : 'failed utility');
                break;
            case 'get_time':
                verb = state === 'start' ? 'checking time' : (state === 'success' ? 'checked time' : 'failed time check');
                break;
            case 'calculate':
                verb = state === 'start' ? 'calculating' : (state === 'success' ? 'calculated' : 'failed calculating');
                break;
            case 'unit_converter':
                verb = state === 'start' ? 'converting' : (state === 'success' ? 'converted' : 'failed converting');
                break;
            case 'text_stats':
                verb = state === 'start' ? 'analysing text' : (state === 'success' ? 'analysed text' : 'failed text analysis');
                break;
            case 'uuid_random':
                verb = state === 'start' ? 'generating' : (state === 'success' ? 'generated' : 'failed generating');
                break;
            default:
                verb = state === 'start' ? 'running' : (state === 'success' ? 'completed' : 'failed');
        }

        const prefixSvg = state === 'start' 
            ? (svgs['spinner'] || '<span class="thinking-spinner"></span>') 
            : (state === 'success' 
                ? (svgs['success'] || '') 
                : (svgs['error'] || ''));
        
        let target = targetName || '';
        if (tool === 'run_command' && target.length > 40) {
            target = target.substring(0, 37) + '...';
        }

        return `
            <div class="tool-call-header">
                <div class="tool-call-title">
                    ${prefixSvg}${iconSvg} ${verb} ${target ? `<code>${this.formatter.escapeHtml(target)}</code>` : ''}
                </div>
                <i class="codicon codicon-chevron-right tool-chevron"></i>
            </div>
        `;
    }

    /**
     * Appends dynamic activity status card (spinner + status text) into chat container.
     * @param {string} [statusText='Processing...'] Initial status message.
     */
    showActivityStatus(statusText = 'Processing...') {
        this.removeActivityStatus();

        const statusDiv = document.createElement('div');
        statusDiv.id = 'activity-status-container';
        statusDiv.className = 'activity-status-card';
        statusDiv.innerHTML = `
            <span class="thinking-spinner"></span>
            <span class="activity-status-text">${this.formatter.escapeHtml(statusText)}</span>
        `;

        if (this.chatContainer) {
            this.chatContainer.appendChild(statusDiv);
            this.scrollToBottom();
        }
    }

    /**
     * Updates the text inside the active activity status card.
     * @param {string} statusText New status message.
     */
    updateActivityStatus(statusText) {
        if (!statusText) return;
        const statusEl = document.getElementById('activity-status-container');
        if (statusEl) {
            const textEl = statusEl.querySelector('.activity-status-text');
            if (textEl) {
                textEl.textContent = statusText;
            }
        } else {
            this.showActivityStatus(statusText);
        }
    }

    /**
     * Removes active activity status element.
     */
    removeActivityStatus() {
        const statusEl = document.getElementById('activity-status-container');
        if (statusEl) {
            statusEl.remove();
        }
    }

    /**
     * Scrolls chat container element to bottom.
     * Batches scroll execution via requestAnimationFrame to eliminate forced synchronous layout reflows.
     * @param {boolean} [immediate=false] True to scroll synchronously without RAF batching.
     */
    scrollToBottom(immediate = false) {
        if (!this.chatContainer) return;
        if (immediate || typeof requestAnimationFrame !== 'function') {
            this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
            return;
        }
        if (this._scrollRafId) return;
        this._scrollRafId = requestAnimationFrame(() => {
            this._scrollRafId = null;
            if (this.chatContainer) {
                this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
            }
        });
    }

    /**
     * Toggles UI control lock state during agent generation.
     * @param {boolean} isLoading True when generation is active.
     * @param {AppState} appState Active state instance.
     */
    setUiLoading(isLoading, appState) {
        if (appState) {
            appState.isWaitingForResponse = isLoading;
        }
        if (this.messageInput) {
            this.messageInput.disabled = isLoading;
        }
        if (this.sendBtn) {
            this.sendBtn.disabled = false;
            if (isLoading) {
                this.sendBtn.innerHTML = window.KAI_SVGS['stop'] || '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
                this.sendBtn.title = 'Stop generation';
                this.showActivityStatus('Processing...');
            } else {
                this.sendBtn.innerHTML = window.KAI_SVGS['send'] || '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
                this.sendBtn.title = 'Send message';
                this.removeActivityStatus();
                if (this.streamPipeline) {
                    this.streamPipeline.flushImmediate();
                }
            }
        }
    }

    /**
     * Clears all content elements inside chat container and displays Welcome Hero.
     */
    clearChatContainer() {
        this.resetAssistantStream();
        if (this.chatContainer) {
            this.chatContainer.innerHTML = '';
            this.renderWelcomeHero();
        }
    }

    /**
     * Rebuilds the chat stream from historical UI event records or fallback messages.
     * Renders attachment galleries above historical user bubbles and restores assistant responses.
     * @param {Array<object>} uiEvents UI events array.
     * @param {Array<object>} messages Fallback messages array.
     */
    renderUiEvents(uiEvents, messages) {
        if (this.chatContainer) {
            this.chatContainer.innerHTML = '';
        }
        this.resetAssistantStream();
        this.closeAskUserDock();

        const safeUiEvents = Array.isArray(uiEvents) ? uiEvents : [];
        const safeMessages = Array.isArray(messages) ? messages : [];

        if (safeUiEvents.length === 0 && safeMessages.length === 0) {
            this.renderWelcomeHero();
            return;
        }

        const eventsToRender = safeUiEvents.length > 0 ? safeUiEvents : safeMessages.map(m => ({
            type: m.role,
            text: m.content,
            content: m.content,
            mode: m.mode,
            attachedFiles: m.attachedFiles || m.files
        }));

        eventsToRender.forEach(evt => {
            if (!evt || typeof evt !== 'object') return;
            if (evt.type === 'user' || evt.role === 'user') {
                this.appendMessage('user', evt.text || evt.content || '', evt.attachedFiles || evt.files || []);
            } else if (evt.type === 'assistant' || evt.role === 'assistant') {
                this.appendMessage('assistant', evt.content || evt.text || '', evt.mode, {
                    model: evt.model,
                    thinking: evt.thinking,
                    isThinkingCapable: evt.isThinkingCapable,
                    reasoningEffort: evt.reasoningEffort
                });
            } else if (evt.type === 'system') {
                this.appendMessage('system', evt.content || evt.text || '');
            } else if (evt.type === 'file-summary' || evt.role === 'file-summary') {
                this.appendMessage('file-summary', typeof evt.files === 'string' ? evt.files : JSON.stringify(evt.files || evt.content || []));
            } else if (evt.type === 'tool') {
                const statusDiv = document.createElement('div');
                if (evt.toolId) statusDiv.id = evt.toolId;
                statusDiv.className = `tool-status-row ${evt.state === 'error' ? 'errored' : (evt.state === 'success' ? 'completed' : 'in-progress')}`;
                statusDiv.innerHTML = this.getToolDescription(evt.tool, evt.fileName, evt.state === 'error' ? 'error' : 'success');
                if (evt.output) {
                    const dropdownDiv = document.createElement('div');
                    dropdownDiv.className = 'tool-result-dropdown hidden';
                    dropdownDiv.innerHTML = `<pre><code>${this.formatter.escapeHtml(evt.output)}</code></pre>`;
                    statusDiv.appendChild(dropdownDiv);
                }
                if (this.chatContainer) {
                    this.chatContainer.appendChild(statusDiv);
                }
            }
        });

        this.scrollToBottom();
        if (this.mermaidRenderer && this.chatContainer) {
            this.mermaidRenderer.renderDiagrams(this.chatContainer);
        }
    }
    showView(viewName) {
        if (this.settingsController && typeof this.settingsController.hideKeysOverlay === 'function') {
            this.settingsController.hideKeysOverlay();
        }
        if (viewName === 'chat') {
            if (this.chatView) this.chatView.classList.remove('hidden');
            if (this.historyContainer) this.historyContainer.classList.add('hidden');
            if (this.settingsContainer) this.settingsContainer.classList.add('hidden');
        } else if (viewName === 'history') {
            if (this.chatView) this.chatView.classList.add('hidden');
            if (this.historyContainer) this.historyContainer.classList.remove('hidden');
            if (this.settingsContainer) this.settingsContainer.classList.add('hidden');
        } else if (viewName === 'settings') {
            if (this.chatView) this.chatView.classList.add('hidden');
            if (this.historyContainer) this.historyContainer.classList.add('hidden');
            if (this.settingsContainer) this.settingsContainer.classList.remove('hidden');
        }
    }

    /**
     * Renders a styled alert card in the chat view informing the user that an API key is required.
     * Directs the user to provider registration URLs and opens Settings focused on target input.
     * @param {object} info Provider requirement information.
     * @param {string} info.providerName Provider display name.
     * @param {string} info.modelName Model display name.
     * @param {string} [info.url] External link to obtain free API key.
     * @param {string} [info.keyHint] Guidance hint.
     * @param {string} [info.configKey] Storage key name for input focus.
     */
    /**
     * Renders a styled alert card in the chat view informing the user that an API key is required.
     * Directs the user to provider registration URLs and opens Settings focused on target input.
     * @param {object} info Provider requirement information.
     */
    showApiKeyRequiredNotice(info) {
        if (!this.chatContainer) return;
        const oldNotice = document.getElementById('api-key-required-notice');
        if (oldNotice) oldNotice.remove();

        const noticeDiv = typeof ApiKeyNoticeCard !== 'undefined'
            ? ApiKeyNoticeCard.render(info, this.ipcBridge)
            : document.createElement('div');
        this.chatContainer.appendChild(noticeDiv);
        this.scrollToBottom();
    }

    /**
     * Docks an interactive clarification prompt above the bottom input card.
     * Features a Claude Code-style card with numbered choices, dismiss close button,
     * and a bottom row with custom answer input and skip pill button.
     * @param {Object} req Prompt request object containing requestId, question, options, and allowCustom.
     * @param {Function} onAnswer Callback triggered with the chosen or typed answer string.
     */
    renderAskUserDock(req, onAnswer) {
        if (!req) return;

        // Close any existing active dock first
        this.closeAskUserDock();

        const inputCard = document.querySelector('.input-card');
        if (!inputCard || !this.messageInput) return;

        const i18n = (typeof window !== 'undefined' && window.KAI_I18N) || {};
        const dock = document.createElement('div');
        dock.id = 'ask-user-dock';
        dock.className = 'ask-user-dock';
        dock.dataset.requestId = req.requestId || '';

        // 1. Header with Title and Close button
        const header = document.createElement('div');
        header.className = 'ask-dock-header';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'ask-dock-title';
        titleSpan.textContent = req.question || (i18n.welcomeTitle || 'How can I help you today?');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'ask-dock-close-btn';
        closeBtn.title = i18n.close || 'Dismiss';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.closeAskUserDock();
            if (typeof onAnswer === 'function') {
                onAnswer('');
            }
        });

        header.appendChild(titleSpan);
        header.appendChild(closeBtn);
        dock.appendChild(header);

        const resolveAnswer = (answerText) => {
            if (!answerText || !answerText.trim()) return;
            const finalAnswer = answerText.trim();

            this.closeAskUserDock();

            if (typeof onAnswer === 'function') {
                onAnswer(finalAnswer);
            }
        };

        // 2. Vertical Options List (Claude Code style)
        if (Array.isArray(req.options) && req.options.length > 0) {
            const optionsList = document.createElement('div');
            optionsList.className = 'ask-options-list';
            req.options.forEach((opt, idx) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'ask-option-item';
                item.dataset.index = String(idx + 1);

                const badge = document.createElement('span');
                badge.className = 'ask-option-badge';
                badge.textContent = String(idx + 1);

                const label = document.createElement('span');
                label.className = 'ask-option-label';
                label.textContent = opt;

                item.appendChild(badge);
                item.appendChild(label);

                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    resolveAnswer(opt);
                });
                optionsList.appendChild(item);
            });
            dock.appendChild(optionsList);
        }

        // 3. Footer with custom text input and Skip button
        const footer = document.createElement('div');
        footer.className = 'ask-dock-footer';

        const customWrap = document.createElement('div');
        customWrap.className = 'ask-custom-input-wrap';

        const pencilSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        pencilSvg.setAttribute('class', 'ask-custom-icon');
        pencilSvg.setAttribute('width', '13');
        pencilSvg.setAttribute('height', '13');
        pencilSvg.setAttribute('viewBox', '0 0 24 24');
        pencilSvg.setAttribute('fill', 'none');
        pencilSvg.setAttribute('stroke', 'currentColor');
        pencilSvg.setAttribute('stroke-width', '2');
        pencilSvg.setAttribute('stroke-linecap', 'round');
        pencilSvg.setAttribute('stroke-linejoin', 'round');
        pencilSvg.innerHTML = '<path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>';

        const customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.className = 'ask-custom-input';
        customInput.placeholder = i18n.askUserCustomPlaceholder || 'Something else...';

        customInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const val = (customInput.value || '').trim();
                if (val) {
                    resolveAnswer(val);
                }
            }
        });

        customWrap.appendChild(pencilSvg);
        customWrap.appendChild(customInput);
        footer.appendChild(customWrap);

        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'ask-skip-btn';
        skipBtn.textContent = i18n.askUserSkip || 'Skip';
        skipBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            resolveAnswer(i18n.askUserSkip || 'Skipped');
        });
        footer.appendChild(skipBtn);

        dock.appendChild(footer);

        // Cache original input attributes to restore later
        this._originalPlaceholder = this.messageInput.placeholder;
        this._originalDisabled = this.messageInput.disabled;

        const handleKeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const val = (this.messageInput.value || '').trim();
                if (val) {
                    this.messageInput.value = '';
                    resolveAnswer(val);
                }
            }
        };

        const handleSendClick = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (req.allowCustom !== false) {
                const val = (this.messageInput.value || '').trim();
                if (val) {
                    this.messageInput.value = '';
                    resolveAnswer(val);
                }
            }
        };

        const handleGlobalKeydown = (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                return;
            }
            if (e.key >= '1' && e.key <= '9') {
                const num = parseInt(e.key, 10);
                if (Array.isArray(req.options) && num <= req.options.length) {
                    e.preventDefault();
                    resolveAnswer(req.options[num - 1]);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeAskUserDock();
                if (typeof onAnswer === 'function') {
                    onAnswer('');
                }
            }
        };

        this._askDockInputKeydown = handleKeydown;
        this._askDockSendClick = handleSendClick;
        this._askDockGlobalKeydown = handleGlobalKeydown;
        document.addEventListener('keydown', handleGlobalKeydown, true);

        if (req.allowCustom === false) {
            this.messageInput.disabled = true;
            this.messageInput.placeholder = i18n.askUserCustomPlaceholder || 'Please choose one of the options above';
        } else {
            this.messageInput.disabled = false;
            this.messageInput.placeholder = i18n.placeholderChat || 'Type custom response... (or select an option above)';
            this.messageInput.addEventListener('keydown', handleKeydown, true);
        }

        if (this.sendBtn) {
            this.sendBtn.addEventListener('click', handleSendClick, true);
        }

        // Mount cleanly above .input-card inside .input-panel
        const inputPanel = inputCard.closest('.input-panel') || inputCard.parentElement;
        if (inputPanel && inputPanel.contains(inputCard)) {
            inputPanel.insertBefore(dock, inputCard);
        } else {
            inputCard.insertBefore(dock, this.messageInput);
        }
        this._activeAskUserDock = dock;
    }

    /**
     * Closes the active ask_user dock and restores message input to its default state.
     * Removes the dock from .input-panel / .input-card, unbinds captured event listeners, and resets input placeholders.
     */
    closeAskUserDock() {
        if (this._activeAskUserDock) {
            this._activeAskUserDock.remove();
            this._activeAskUserDock = null;
        } else {
            const existing = document.getElementById('ask-user-dock');
            if (existing) existing.remove();
        }

        if (this._askDockGlobalKeydown) {
            document.removeEventListener('keydown', this._askDockGlobalKeydown, true);
            this._askDockGlobalKeydown = null;
        }

        if (this.messageInput) {
            if (this._askDockInputKeydown) {
                this.messageInput.removeEventListener('keydown', this._askDockInputKeydown, true);
                this._askDockInputKeydown = null;
            }
            if (this._originalPlaceholder !== undefined) {
                this.messageInput.placeholder = this._originalPlaceholder;
                delete this._originalPlaceholder;
            }
            if (this._originalDisabled !== undefined) {
                this.messageInput.disabled = this._originalDisabled;
                delete this._originalDisabled;
            }
        }

        if (this.sendBtn && this._askDockSendClick) {
            this.sendBtn.removeEventListener('click', this._askDockSendClick, true);
            this._askDockSendClick = null;
        }
    }

    /**
     * Legacy wrapper that delegates clarification prompt rendering to the bottom dock.
     * Maintains backward compatibility for callers expecting the card interface.
     * @param {Object} req Prompt request containing requestId, question, options, and allowCustom.
     * @param {Function} onAnswer Callback triggered with the selected or typed answer string.
     */
    renderAskUserCard(req, onAnswer) {
        this.renderAskUserDock(req, onAnswer);
    }

}
