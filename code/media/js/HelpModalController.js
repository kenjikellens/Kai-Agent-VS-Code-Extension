/**
 * HelpModalController manages the quick guide modal dialog lifecycle,
 * keyboard shortcuts display, feature documentation, and backdrop events.
 */
class HelpModalController {
    /**
     * Initializes the modal controller, creates the DOM elements if missing, and binds event listeners.
     * @param {WebviewIPCBridge} [ipcBridge] Optional IPC bridge instance.
     */
    constructor(ipcBridge) {
        this.ipcBridge = ipcBridge;
        this.container = document.getElementById('help-container');
        if (!this.container) {
            this.initModalDOM();
        }
        this.initEventListeners();
    }

    /**
     * Dynamically creates the help modal container structure with ARIA dialog attributes and standalone SVG icons.
     * Appends the modal element to document.body and caches this.container.
     */
    initModalDOM() {
        const modal = document.createElement('div');
        modal.id = 'help-container';
        modal.className = 'help-container hidden';
        modal.innerHTML = `
            <div class="help-backdrop"></div>
            <div class="help-modal-card" role="dialog" aria-modal="true" aria-labelledby="help-modal-title-text">
                <div class="help-modal-header">
                    <div class="help-modal-title">
                        ${DOMUtils.icon('help_circle', 16)}
                        <span id="help-modal-title-text">Kai Quick Guide & Shortcuts</span>
                    </div>
                    <button type="button" class="icon-btn icon-btn--close-pill" id="close-help-btn" title="Close" aria-label="Close">
                        ${DOMUtils.icon('close', 12, { strokeWidth: 2.5 })}
                    </button>
                </div>
                <div class="help-modal-body" id="help-modal-body">
                    <!-- Populated dynamically via renderHelpContent() -->
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.container = modal;
    }

    /**
     * Registers close button click, backdrop click, and Escape key dismissal.
     */
    initEventListeners() {
        if (!this.container) return;

        // Close button click
        const closeBtn = this.container.querySelector('#close-help-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Backdrop click to dismiss
        const backdrop = this.container.querySelector('.help-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', () => this.close());
        }

        // Global Escape key listener
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.close();
            }
        });
    }

    /**
     * Checks whether the help modal is currently visible.
     * @returns {boolean} True if open, false if hidden.
     */
    isOpen() {
        return Boolean(this.container && !this.container.classList.contains('hidden'));
    }

    /**
     * Opens the help modal, captures the previous focus target, and moves focus to the close button.
     */
    open() {
        if (!this.container) return;
        this._previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.renderHelpContent();
        this.container.classList.remove('hidden');
        const closeBtn = this.container.querySelector('#close-help-btn');
        if (closeBtn) closeBtn.focus();
    }

    /**
     * Closes the help modal dialog and restores focus to the prior element or chat input.
     */
    close() {
        if (!this.container) return;
        this.container.classList.add('hidden');
        const target = (this._previousFocus && document.contains(this._previousFocus))
            ? this._previousFocus
            : document.getElementById('message-input');
        this._previousFocus = null;
        if (target && typeof target.focus === 'function') {
            target.focus();
        }
    }

    /**
     * Formats and injects the comprehensive localized guide sections in a borderless accordion (max 1 open).
     */
    renderHelpContent() {
        const bodyEl = document.getElementById('help-modal-body');
        if (!bodyEl) return;

        const i18n = window.KAI_I18N || {};

        const sections = [
            {
                id: 'help-lmstudio',
                title: i18n.lmStudioHeader || 'LM Studio & Local Models',
                content: `
                    <div class="help-desc-text">Kai connects directly to your locally running LM Studio HTTP server for 100% private, offline inference.</div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Server URL:</strong> Defaults to <code>http://localhost:1234/v1</code>. Configurable in Settings.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Model Auto-Discovery:</strong> All downloaded models in LM Studio are detected automatically via the Model Selector dropdown.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Jinja Thinking Capabilities:</strong> When an LM Studio model manifest is detected, native Jinja thinking parameters (e.g. <code>enable_thinking</code>, <code>reasoning_effort</code>) are parsed and used automatically.</div></div>
                `
            },
            {
                id: 'help-modes',
                title: 'Modes & Capabilities (@ Menu)',
                content: `
                    <div class="help-desc-text">Switch agent operation modes dynamically via the <strong>@</strong> button in the prompt toolbar:</div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Agent Mode:</strong> Full autonomous agent with read/write file editing, terminal command execution, grep searching, diagnostics, and multi-file diff application.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Ask Mode:</strong> Read-only exploration and Q&A mode. Safe for code review and queries; writing or modifying files is strictly disabled.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Plan Mode:</strong> Enforces a structured, step-by-step implementation plan before modifying any code. Review and approve the plan with the <em>Proceed with Plan</em> button.</div></div>
                `
            },
            {
                id: 'help-tools',
                title: 'Agent Tools & Execution',
                content: `
                    <div class="help-desc-text">Kai utilizes modular workspace tools to inspect and modify your codebase:</div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>File Operations:</strong> <code>read_file</code>, <code>write_file</code>, <code>edit_file</code>, <code>replace_file_content</code>, <code>multi_replace_file_content</code>, and <code>delete_item</code>.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Code Intelligence:</strong> <code>grep_search</code> for regex/keyword matches across files, <code>list_dir</code> for directory trees, <code>symbol_search</code> for definitions, and <code>get_diagnostics</code> for compiler/linter errors.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Terminal & Web:</strong> <code>run_command</code> to execute PowerShell/Bash commands safely, <code>web_search</code> for live online lookups, and <code>fetch_url</code> to scrape web pages.</div></div>
                `
            },
            {
                id: 'help-thinking',
                title: i18n.thinkingToggle || 'Thinking & Reasoning',
                content: `
                    <div class="help-desc-text">Configure deep reasoning and chain-of-thought behavior for supported thinking models:</div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Reasoning Effort:</strong> Choose between <code>xhigh</code>, <code>medium</code>, and <code>low</code> directly from the model flyout menu.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Thinking Toggle:</strong> Enable or disable thinking blocks with the toggle switch in the model flyout.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Display Preferences:</strong> In Settings, configure whether to keep reasoning thoughts expanded during and after generation, or collapse them cleanly into compact summary blocks.</div></div>
                `
            },
            {
                id: 'help-providers',
                title: 'External AI Providers & API Keys',
                content: `
                    <div class="help-desc-text">Access cloud models alongside local LM Studio models with seamless fallback:</div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Supported Providers:</strong> Google Gemini, Mistral AI, Cohere, Cerebras, Groq, Together AI, OpenRouter, and more.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Global Key Storage:</strong> All API keys are securely saved globally in your user configuration profile. No <code>.env</code> files are ever created in your project folders.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Status Dots:</strong> Green dots in the Model Selector indicate an active, validated connection. Red dots mean an API key is missing or the server is unreachable.</div></div>
                `
            },
            {
                id: 'help-context',
                title: 'Context & File Attachments',
                content: `
                    <div class="help-desc-text">Add rich context to your prompts easily:</div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>File Upload (+):</strong> Click the <strong>+</strong> button on the input bar to attach workspace files or images directly to your prompt.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>Editor Selection:</strong> Highlight code in any open editor file to automatically send code context into the Kai chat window.</div></div>
                    <div class="help-item-row"><span class="help-bullet">•</span><div><strong>File Summaries:</strong> Attached files are indexed and summarized inline for high token efficiency.</div></div>
                `
            },
            {
                id: 'help-shortcuts',
                title: 'Keyboard Shortcuts',
                content: `
                    <div class="help-shortcuts-grid">
                        <div class="help-shortcut-row">
                            <span class="help-shortcut-label">Send prompt / execute</span>
                            <kbd class="help-kbd">Enter</kbd>
                        </div>
                        <div class="help-shortcut-row">
                            <span class="help-shortcut-label">New line in prompt</span>
                            <kbd class="help-kbd">Shift + Enter</kbd>
                        </div>
                        <div class="help-shortcut-row">
                            <span class="help-shortcut-label">Close help modal / flyout</span>
                            <kbd class="help-kbd">Esc</kbd>
                        </div>
                    </div>
                `
            }
        ];

        bodyEl.innerHTML = '';

        sections.forEach((sec, idx) => {
            const categoryDiv = document.createElement('div');
            // First item expanded by default, rest collapsed
            categoryDiv.className = `settings-category ${idx === 0 ? '' : 'collapsed'}`;
            categoryDiv.id = sec.id;

            const headerBtn = document.createElement('button');
            headerBtn.type = 'button';
            headerBtn.className = 'category-header-btn';
            headerBtn.innerHTML = `
                <span class="category-title">${sec.title}</span>
                ${DOMUtils.icon('chevron_down', 10, { className: 'category-chevron', strokeWidth: 2.5 })}
            `;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'category-content';
            contentDiv.innerHTML = `<div class="help-accordion-inner">${sec.content}</div>`;

            headerBtn.addEventListener('click', () => {
                categoryDiv.classList.toggle('collapsed');
            });

            categoryDiv.appendChild(headerBtn);
            categoryDiv.appendChild(contentDiv);
            bodyEl.appendChild(categoryDiv);
        });
    }
}
