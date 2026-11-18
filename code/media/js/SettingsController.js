/**
 * SettingsController manages the settings panel UI, localStorage preferences,
 * custom select dropdowns, category collapse states, LM Studio server & cache configuration,
 * and external provider API keys with overlay modal.
 */
class SettingsController {
    /**
     * Initializes setting controls and registers DOM listeners.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     */
    constructor(ipcBridge) {
        this.ipcBridge = ipcBridge;

        this.serverUrlInput = document.getElementById('settings-server-url');
        this.lmStudioPathInput = document.getElementById('settings-lmstudio-path');
        this.browseLMStudioBtn = document.getElementById('browse-lmstudio-path-btn');
        this.cacheStatusDot = document.getElementById('cache-status-dot');
        this.cacheStatusText = document.getElementById('cache-status-text');

        this.showThinkingToggle = document.getElementById('show-thinking-toggle');
        this.thinkingSubsettings = document.getElementById('thinking-subsettings');
        this.keepThinkingExpandedToggle = document.getElementById('keep-thinking-expanded-toggle');
        this.keepThinkingFinishedExpandedToggle = document.getElementById('keep-thinking-finished-expanded-toggle');
        this.geminiThinkingLevelInput = document.getElementById('gemini-thinking-level-input');
        this.apiKeyInput = document.getElementById('api-key-input');

        this.keysContainer = document.getElementById('keys-container');
        this.manageKeysBtn = document.getElementById('manage-keys-btn');
        this.closeKeysBtn = document.getElementById('close-keys-btn');
        this.dynamicKeysList = document.getElementById('dynamic-keys-list');

        this.freeProviders = [...KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS];
        this.providerReloadButtons = new Map();

        this.initSettings();
        this.initEventListeners();
    }

    /**
     * Initializes setting toggles and custom selects from localStorage.
     */
    initSettings() {
        const i18n = window.KAI_I18N || {};

        // 1. Show thinking process toggle
        const showContainer = document.getElementById('show-thinking-toggle-container');
        if (showContainer) {
            showContainer.innerHTML = '';
            const stored = localStorage.getItem('kai.showThinking');
            const isChecked = stored === null ? true : stored === 'true';
            const el = ToggleComponent.create({
                id: 'show-thinking-toggle',
                checked: isChecked,
                label: i18n.showThinking || 'Show thinking process',
                onChange: (checked) => {
                    localStorage.setItem('kai.showThinking', checked);
                    this.updateSubsettingsVisibility();
                }
            });
            showContainer.appendChild(el);
            this.showThinkingToggle = el.querySelector('input[type="checkbox"]');
        }

        // 2. Keep thinking expanded while generating
        const keepContainer = document.getElementById('keep-thinking-expanded-container');
        if (keepContainer) {
            keepContainer.innerHTML = '';
            const stored = localStorage.getItem('kai.keepThinkingExpanded');
            const isChecked = stored === null ? true : stored === 'true';
            const el = ToggleComponent.create({
                id: 'keep-thinking-expanded-toggle',
                checked: isChecked,
                label: i18n.keepThinkingGenerating || 'Keep thinking expanded while generating',
                onChange: (checked) => {
                    localStorage.setItem('kai.keepThinkingExpanded', checked);
                }
            });
            keepContainer.appendChild(el);
            this.keepThinkingExpandedToggle = el.querySelector('input[type="checkbox"]');
        }

        // 3. Keep thinking expanded after reasoning
        const finishedContainer = document.getElementById('keep-thinking-finished-container');
        if (finishedContainer) {
            finishedContainer.innerHTML = '';
            const stored = localStorage.getItem('kai.keepThinkingFinishedExpanded');
            const isChecked = stored === null ? false : stored === 'true';
            const el = ToggleComponent.create({
                id: 'keep-thinking-finished-expanded-toggle',
                checked: isChecked,
                label: i18n.keepThinkingFinished || 'Keep thinking expanded after reasoning',
                onChange: (checked) => {
                    localStorage.setItem('kai.keepThinkingFinishedExpanded', checked);
                }
            });
            finishedContainer.appendChild(el);
            this.keepThinkingFinishedExpandedToggle = el.querySelector('input[type="checkbox"]');
        }

        // 4. Gemini Default Thinking Level
        if (this.geminiThinkingLevelInput) {
            const storedLevel = localStorage.getItem('kai.geminiThinkingLevel');
            this.geminiThinkingLevelInput.value = storedLevel || 'high';
        }

        this.updateSubsettingsVisibility();

        // 5. Language Custom Select Dropdown
        const langContainer = document.getElementById('language-select-container');
        if (langContainer && typeof CustomSelectComponent !== 'undefined') {
            const initialLang = window.KAI_LANG || 'auto';
            const langOptions = window.KAI_SUPPORTED_LANGUAGES || [
                { value: 'auto', label: 'Auto (System Default)' },
                { value: 'en', label: 'English' },
                { value: 'nl', label: 'Nederlands' }
            ];
            this.languageSelectComponent = new CustomSelectComponent({
                container: langContainer,
                id: 'language-select-input',
                options: langOptions,
                value: initialLang,
                onChange: (selectedLang) => {
                    this.ipcBridge.updateSettings({
                        language: selectedLang
                    });
                }
            });
        }

        // 6. Stream Lookahead Delay Custom Select Dropdown (None, 200ms, 400ms, 750ms, 1000ms, 1500ms)
        const streamDelayContainer = document.getElementById('stream-settle-delay-select-container');
        if (streamDelayContainer && typeof CustomSelectComponent !== 'undefined') {
            const storedDelay = localStorage.getItem('kai.streamSettleDelay') || '0';
            const delayOptions = [
                { value: '0', label: 'None' },
                { value: '200', label: '200ms' },
                { value: '400', label: '400ms' },
                { value: '750', label: '750ms' },
                { value: '1000', label: '1000ms' },
                { value: '1500', label: '1500ms' }
            ];
            this.streamDelayComponent = new CustomSelectComponent({
                container: streamDelayContainer,
                id: 'stream-settle-delay-select-input',
                options: delayOptions,
                value: storedDelay,
                onChange: (selectedExtraDelay) => {
                    localStorage.setItem('kai.streamSettleDelay', selectedExtraDelay);
                    const extraMs = parseInt(selectedExtraDelay, 10) || 0;
                    const baseMs = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--stream-settle-base-delay'), 10) || 150;
                    const effectiveMs = baseMs + extraMs;
                    document.documentElement.style.setProperty('--stream-settle-delay', `${effectiveMs}ms`);
                    if (window.chatUIController && typeof window.chatUIController.setStreamSettleDelay === 'function') {
                        window.chatUIController.setStreamSettleDelay(extraMs);
                    }
                }
            });
        }
    }

    /**
     * Registers event listeners for settings controls, categories, and keys overlay.
     */
    initEventListeners() {
        // Collapsible category accordion headers (independent toggle)
        const categoryBtns = document.querySelectorAll('.category-header-btn');
        categoryBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const categoryEl = btn.closest('.settings-category');
                if (!categoryEl) return;
                
                categoryEl.classList.toggle('collapsed');
            });
        });

        if (this.browseLMStudioBtn) {
            this.browseLMStudioBtn.addEventListener('click', () => {
                this.ipcBridge.browseLMStudioFolder();
            });
        }

        if (this.serverUrlInput) {
            this.serverUrlInput.addEventListener('change', () => {
                this.saveAllSettings();
            });
        }

        if (this.lmStudioPathInput) {
            this.lmStudioPathInput.addEventListener('change', () => {
                this.saveAllSettings();
            });
        }

        if (this.geminiThinkingLevelInput) {
            this.geminiThinkingLevelInput.addEventListener('change', () => {
                localStorage.setItem('kai.geminiThinkingLevel', this.geminiThinkingLevelInput.value);
            });
        }

        if (this.apiKeyInput) {
            this.apiKeyInput.addEventListener('input', () => {
                const keyVal = this.apiKeyInput.value.trim();
                localStorage.setItem('kai.geminiApiKey', keyVal);
                localStorage.setItem('kai.apiKey', keyVal);
                if (this.settingsRepo) this.settingsRepo.setProviderKey('geminiApiKey', keyVal);
                window.dispatchEvent(new CustomEvent('kaiProviderKeysUpdated'));
            });
            this.apiKeyInput.addEventListener('change', () => {
                this.saveAllSettings();
            });
        }

        if (this.manageKeysBtn) {
            this.manageKeysBtn.addEventListener('click', () => {
                if (this.keysContainer) {
                    this.keysContainer.classList.remove('hidden');
                    this.renderProviderKeyInputs();
                }
            });
        }

        if (this.closeKeysBtn) {
            this.closeKeysBtn.addEventListener('click', () => {
                this.hideKeysOverlay();
            });
        }
    }

    /**
     * Hides the provider API keys overlay modal.
     */
    hideKeysOverlay() {
        if (this.keysContainer) {
            this.keysContainer.classList.add('hidden');
        }
    }

    /**
     * Retrieves the active Gemini reasoning level setting.
     * @param {string} modelId Model ID string.
     * @returns {string} The active reasoning level string.
     */
    getGeminiThinkingLevel(modelId) {
        if (modelId) {
            const perModel = localStorage.getItem(`kai.geminiThinkingLevel.${modelId}`);
            if (perModel) return perModel;
        }
        const globalSaved = localStorage.getItem('kai.geminiThinkingLevel');
        if (globalSaved) return globalSaved;
        if (this.geminiThinkingLevelInput) {
            return this.geminiThinkingLevelInput.value || 'high';
        }
        return 'high';
    }

    /**
     * Updates settings inputs, LM Studio cache status indicator classes, and provider test button icons.
     * Mutates DOM inputs, #cache-status-dot, #cache-status-text, and provider reload button states.
     * @param {object} message Connection status message.
     */
    updateConnectionStatus(message) {
        if (!message) return;

        if (message.type === 'providerTestResult' && message.configKey) {
            const btn = this.providerReloadButtons.get(message.configKey);
            if (btn) {
                btn.classList.remove('testing');
                if (message.success) {
                    btn.classList.remove('error');
                    btn.classList.add('success');
                    btn.innerHTML = DOMUtils.icon('check', 13, { strokeWidth: 2.5 });
                    btn.title = 'Connected';
                } else {
                    btn.classList.remove('success');
                    btn.classList.add('error');
                    btn.innerHTML = DOMUtils.icon('error', 13, { strokeWidth: 2.5 });
                    btn.title = 'Connection failed';
                }
                setTimeout(() => {
                    btn.classList.remove('success', 'error');
                    btn.innerHTML = DOMUtils.icon('refresh', 13);
                    btn.title = 'Test connection';
                }, 2500);
            }
            return;
        }

        if (this.serverUrlInput && message.serverUrl !== undefined) {
            this.serverUrlInput.value = message.serverUrl;
        }
        if (this.lmStudioPathInput && message.lmStudioCacheDir !== undefined) {
            this.lmStudioPathInput.value = message.lmStudioCacheDir;
        }
        if (this.apiKeyInput && message.apiKey !== undefined) {
            this.apiKeyInput.value = message.apiKey;
        }

        if (message.lmStudioCacheStatus && this.cacheStatusDot && this.cacheStatusText) {
            const status = message.lmStudioCacheStatus;
            const i18n = window.KAI_I18N || {};
            if (status.valid) {
                this.cacheStatusDot.className = 'status-dot status-connected';
                const template = i18n.cacheLoaded || 'Model index loaded ({count} models detected)';
                this.cacheStatusText.textContent = template.replace('{count}', status.modelCount);
                this.cacheStatusText.classList.remove('is-error');
                this.cacheStatusText.classList.add('is-success');
            } else {
                this.cacheStatusDot.className = 'status-dot status-disconnected';
                this.cacheStatusText.textContent = status.error || i18n.cacheNotFound || 'Model index not found';
                this.cacheStatusText.classList.remove('is-success');
                this.cacheStatusText.classList.add('is-error');
            }
        }

        if (message.freeProviders && message.freeProviders.length > 0) {
            this.freeProviders = message.freeProviders.map(p => {
                const def = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS)
                    ? KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS.find(d => d.configKey === p.configKey || d.name === p.name)
                    : null;
                return {
                    ...p,
                    docUrl: p.docUrl || (def ? def.docUrl : '')
                };
            });
        }
        this.renderProviderKeyInputs();
    }

    /**
     * Toggles visibility of thinking subsettings based on showThinkingToggle state.
     */
    updateSubsettingsVisibility() {
        if (this.thinkingSubsettings && this.showThinkingToggle) {
            if (this.showThinkingToggle.checked) {
                this.thinkingSubsettings.classList.remove('hidden');
            } else {
                this.thinkingSubsettings.classList.add('hidden');
            }
        }
    }

    /**
     * Collects all settings (Server URL, LM Studio Path, API keys) and sends updateSettings IPC.
     */
    saveAllSettings() {
        const providerKeys = {};
        document.querySelectorAll('.provider-api-key-input').forEach(input => {
            const configKey = input.dataset.configKey;
            if (configKey) {
                providerKeys[configKey] = input.value;
            }
        });

        this.ipcBridge.updateSettings({
            serverUrl: this.serverUrlInput ? this.serverUrlInput.value : 'http://localhost:1234/v1',
            lmStudioCacheDir: this.lmStudioPathInput ? this.lmStudioPathInput.value : '',
            apiKey: (this.freeProviders.find(p => p.configKey === 'geminiApiKey') || {}).apiKey || '',
            providerKeys: providerKeys
        });
    }

    /**
     * Renders API key input fields for external providers inside the keys modal overlay.
     */
    renderProviderKeyInputs() {
        if (!this.dynamicKeysList) return;
        this.dynamicKeysList.innerHTML = '';
        if (!this.providerReloadButtons) {
            this.providerReloadButtons = new Map();
        } else {
            this.providerReloadButtons.clear();
        }

        const providers = this.freeProviders && this.freeProviders.length > 0 ? this.freeProviders : KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS;

        for (const provider of providers) {
            const defaultDef = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS)
                ? KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS.find(d => d.configKey === provider.configKey || d.name === provider.name)
                : null;
            const docUrl = provider.docUrl || (defaultDef ? defaultDef.docUrl : '');

            const wrapper = document.createElement('div');
            wrapper.className = 'setting-item';

            // Provider Name with External Link Icon (↗)
            const labelLink = document.createElement('a');
            labelLink.className = 'provider-label-link';
            if (docUrl) {
                labelLink.href = docUrl;
                labelLink.target = '_blank';
                labelLink.rel = 'noopener noreferrer';
                labelLink.title = `Open ${provider.name} documentation`;
                labelLink.addEventListener('click', (e) => {
                    if (this.ipcBridge) {
                        e.preventDefault();
                        this.ipcBridge.sendMessage('openExternalUrl', { url: docUrl });
                    }
                });
            }

            const name = document.createElement('span');
            name.className = 'setting-label';
            name.textContent = `${provider.name} API Key`;
            labelLink.appendChild(name);

            if (docUrl) {
                const docIconSpan = document.createElement('span');
                docIconSpan.className = 'provider-doc-icon';
                docIconSpan.innerHTML = DOMUtils.icon('external_link', 11);
                labelLink.appendChild(docIconSpan);
            }

            const inputContainer = document.createElement('div');
            inputContainer.className = 'provider-input-container';

            const input = document.createElement('input');
            input.type = provider.configKey && provider.configKey.includes('Url') ? 'text' : 'password';
            input.id = `provider-key-${provider.configKey}`;
            input.className = 'settings-input provider-api-key-input';
            input.dataset.configKey = provider.configKey;
            input.placeholder = `${provider.name} API Key`;
            
            const savedKey = provider.configKey ? localStorage.getItem(`kai.${provider.configKey}`) : null;
            input.value = savedKey !== null ? savedKey : (provider.apiKey || '');
            provider.apiKey = input.value;

            const eyeSvg = DOMUtils.icon('eye', 14);
            const eyeOffSvg = DOMUtils.icon('eye_off', 14);

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'toggle-password-btn';
            toggleBtn.innerHTML = eyeSvg;
            toggleBtn.title = 'Show/Hide';
            toggleBtn.setAttribute('aria-label', 'Show/Hide');
            toggleBtn.addEventListener('click', () => {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                toggleBtn.innerHTML = isPassword ? eyeOffSvg : eyeSvg;
            });

            // Reload / Check Connection Button
            const reloadBtn = document.createElement('button');
            reloadBtn.type = 'button';
            reloadBtn.className = 'reload-key-btn';
            reloadBtn.innerHTML = DOMUtils.icon('refresh', 13);
            reloadBtn.title = 'Test connection';
            reloadBtn.setAttribute('aria-label', 'Test connection');

            if (provider.configKey) {
                this.providerReloadButtons.set(provider.configKey, reloadBtn);
            }

            reloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (reloadBtn.classList.contains('testing')) return;

                const currentKey = input.value.trim();
                provider.apiKey = currentKey;
                if (provider.configKey) {
                    localStorage.setItem(`kai.${provider.configKey}`, currentKey);
                    if (provider.configKey === 'geminiApiKey') {
                        localStorage.setItem('kai.apiKey', currentKey);
                    }
                    if (this.settingsRepo) this.settingsRepo.setProviderKey(provider.configKey, currentKey);
                }
                this.saveAllSettings();

                reloadBtn.classList.remove('success', 'error');
                reloadBtn.classList.add('testing');
                reloadBtn.title = 'Testing connection...';

                if (this.ipcBridge) {
                    this.ipcBridge.sendMessage('testProviderConnection', {
                        configKey: provider.configKey,
                        apiKey: currentKey
                    });
                }
            });

            input.addEventListener('input', () => {
                provider.apiKey = input.value.trim();
                if (provider.configKey) {
                    localStorage.setItem(`kai.${provider.configKey}`, provider.apiKey);
                    if (provider.configKey === 'geminiApiKey') {
                        localStorage.setItem('kai.apiKey', provider.apiKey);
                    }
                    if (this.settingsRepo) this.settingsRepo.setProviderKey(provider.configKey, provider.apiKey);
                    window.dispatchEvent(new CustomEvent('kaiProviderKeysUpdated'));
                }
            });

            input.addEventListener('change', () => this.saveAllSettings());

            inputContainer.appendChild(input);
            inputContainer.appendChild(toggleBtn);

            const inputRow = document.createElement('div');
            inputRow.className = 'provider-input-row';
            inputRow.appendChild(inputContainer);
            inputRow.appendChild(reloadBtn);

            wrapper.appendChild(labelLink);
            wrapper.appendChild(inputRow);
            this.dynamicKeysList.appendChild(wrapper);
        }
    }
}
