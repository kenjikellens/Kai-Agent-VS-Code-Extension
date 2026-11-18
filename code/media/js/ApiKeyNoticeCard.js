/**
 * ApiKeyNoticeCard encapsulates the warning banner displayed when a user selects
 * or prompts an unconfigured cloud AI provider, with actions to focus settings or obtain keys.
 */
class ApiKeyNoticeCard {
    /**
     * Renders a styled alert card in the specified container.
     * @param {object} info Provider requirement descriptor.
     * @param {string} info.providerName Provider display name.
     * @param {string} [info.modelName] Model display name.
     * @param {string} [info.url] Registration link to get a free API key.
     * @param {string} [info.keyHint] Guidance hint.
     * @param {string} [info.configKey] Target settings input config key.
     * @param {WebviewIPCBridge} [ipcBridge] IPC bridge for external link opening.
     * @returns {HTMLElement} The created notice card DOM element.
     */
    static render(info, ipcBridge = null) {
        const { providerName, modelName, url, keyHint, configKey } = info || {};

        const noticeDiv = document.createElement('div');
        noticeDiv.id = 'api-key-required-notice';
        noticeDiv.className = 'api-key-notice-card';

        const iconDiv = document.createElement('div');
        iconDiv.className = 'api-key-notice-icon';
        iconDiv.innerHTML = DOMUtils.icon('alert_circle', 20);

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'api-key-notice-body';

        const titleH4 = document.createElement('h4');
        titleH4.className = 'api-key-notice-title';
        titleH4.textContent = `API Key Required for ${providerName || 'Provider'}`;

        const descP = document.createElement('p');
        descP.className = 'api-key-notice-desc';
        const safeModel = typeof DOMUtils !== 'undefined' ? DOMUtils.escapeHtml(modelName || providerName) : (modelName || providerName);
        const safeHint = (keyHint && typeof DOMUtils !== 'undefined') ? DOMUtils.escapeHtml(keyHint) : (keyHint || '');
        descP.innerHTML = `To use <strong>${safeModel}</strong>, you need to provide an API key in Settings. ${safeHint ? `<br><span class="api-key-notice-hint">${safeHint}</span>` : ''}`;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'api-key-notice-actions';

        const openSettingsBtn = document.createElement('button');
        openSettingsBtn.type = 'button';
        openSettingsBtn.className = 'api-key-notice-btn api-key-notice-primary';
        openSettingsBtn.textContent = 'Open Settings';
        openSettingsBtn.addEventListener('click', () => {
            window.location.hash = 'settings';
            setTimeout(() => {
                const inputId = configKey === 'geminiApiKey' ? 'settings-gemini-key' : `provider-key-${configKey}`;
                const inputEl = document.getElementById(inputId);
                if (inputEl) {
                    inputEl.focus();
                    inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        });
        actionsDiv.appendChild(openSettingsBtn);

        if (url) {
            const getKeyLink = document.createElement('button');
            getKeyLink.type = 'button';
            getKeyLink.className = 'api-key-notice-btn api-key-notice-secondary';
            getKeyLink.textContent = 'Get Free Key ↗';
            getKeyLink.addEventListener('click', () => {
                if (ipcBridge && typeof ipcBridge.openExternalUrl === 'function') {
                    ipcBridge.openExternalUrl(url);
                } else {
                    window.open(url, '_blank');
                }
            });
            actionsDiv.appendChild(getKeyLink);
        }

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'api-key-notice-btn api-key-notice-dismiss';
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', () => noticeDiv.remove());
        actionsDiv.appendChild(dismissBtn);

        bodyDiv.appendChild(titleH4);
        bodyDiv.appendChild(descP);
        bodyDiv.appendChild(actionsDiv);

        noticeDiv.appendChild(iconDiv);
        noticeDiv.appendChild(bodyDiv);

        return noticeDiv;
    }
}
