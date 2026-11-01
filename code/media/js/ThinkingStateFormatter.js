/**
 * ThinkingStateFormatter provides an OOP service for inspecting model reasoning states
 * and rendering clean text labels without icons.
 * Dynamically utilizes LM Studio ModelCapabilities manifest definitions.
 */
class ThinkingStateFormatter {
    static lmStudioCapabilities = (() => {
        try {
            const cached = localStorage.getItem('kai.lmStudioCapabilitiesCache');
            return cached ? JSON.parse(cached) : {};
        } catch {
            return {};
        }
    })();

    /**
     * Updates the active LM Studio model capabilities map and caches it locally.
     * @param {Record<string, object>} capabilities Map of model identifiers to ModelCapabilities.
     */
    /**
     * Updates the active LM Studio model capabilities map and caches it locally.
     * Synchronizes global window.KAI_LMSTUDIO_CAPABILITIES for provider payload builders.
     * @param {Record<string, object>} capabilities Map of model identifiers to ModelCapabilities.
     */
    static setLMStudioCapabilities(capabilities) {
        if (capabilities && typeof capabilities === 'object' && Object.keys(capabilities).length > 0) {
            ThinkingStateFormatter.lmStudioCapabilities = capabilities;
            if (typeof window !== 'undefined') {
                window.KAI_LMSTUDIO_CAPABILITIES = capabilities;
            }
            try {
                localStorage.setItem('kai.lmStudioCapabilitiesCache', JSON.stringify(capabilities));
            } catch {}
        }
    }

    /**
     * Exact verified reasoning metadata for curated OpenRouter models from live API.
     */
    static openRouterReasoningMap = {
        'stealth/ox-alpha': { mandatory: true, supportedEfforts: ['max', 'high', 'low'], defaultEffort: 'max' },
        'google/gemma-4-31b-it:free': { mandatory: false, supportedEfforts: null, defaultEffort: 'none' },
        'google/gemma-4-26b-a4b-it:free': { mandatory: false, supportedEfforts: null, defaultEffort: 'none' },
        'cohere/north-mini-code:free': { mandatory: false, supportedEfforts: null, defaultEffort: 'none' },
        'z-ai/glm-5.2:free': { mandatory: false, supportedEfforts: ['xhigh', 'high'], defaultEffort: 'high' },
        'nvidia/nemotron-3.5-lightning:free': { mandatory: false, supportedEfforts: null, defaultEffort: 'none' },
        'nvidia/nemotron-3-super-120b-a12b:free': { mandatory: false, supportedEfforts: ['medium', 'low'], defaultEffort: 'medium' },
        'nvidia/nemotron-3-ultra-550b-a55b:free': { mandatory: false, supportedEfforts: ['high', 'medium'], defaultEffort: 'high' },
        'poolside/laguna-s-2.1:free': { mandatory: false, supportedEfforts: null, defaultEffort: 'none' },
        'thinkingmachines/inkling:free': { mandatory: false, supportedEfforts: ['max', 'high', 'medium', 'low', 'minimal', 'none'], defaultEffort: 'high' },
        'liquid/lfm-2.5-2.6b:free': { mandatory: true, supportedEfforts: null, defaultEffort: 'none' }
    };

    /**
     * Formats an OpenRouter effort code into a clean, human-readable UI label.
     * @param {string} effort Effort code (e.g. 'max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none').
     * @returns {string} Capitalized label text.
     */
    static formatEffortLabel(effort) {
        if (!effort) return '';
        const map = {
            'xhigh': 'X-High',
            'max': 'Max',
            'high': 'High',
            'medium': 'Medium',
            'low': 'Low',
            'minimal': 'Minimal',
            'none': 'Off'
        };
        return map[effort.toLowerCase()] || (effort.charAt(0).toUpperCase() + effort.slice(1));
    }

    /**
     * Inspects dynamic manifest and settings to return detailed capability state.
     * @param {string} modelId Active or raw model ID string.
     * @returns {object} Full capability state object.
     */
    static getCapabilitiesState(modelId) {
        console.log('[KAI ThinkingState] getCapabilitiesState called:', modelId);
        if (!modelId) {
            return {
                rawModel: '',
                hasThinkingToggle: false,
                isThinkingOn: false,
                hasReasoningEffort: false,
                reasoningLevel: 'off',
                effortOptions: [],
                effortDisplayName: 'Reasoning Effort'
            };
        }

        const lower = String(modelId).toLowerCase();
        const isThinkingSuffix = lower.endsWith(' (thinking)');
        const rawModel = isThinkingSuffix ? modelId.slice(0, -11) : modelId;
        const lowerRaw = rawModel.toLowerCase();

        // 1. Check dynamic LM Studio manifest capabilities first with robust alias resolution
        const capsMap = ThinkingStateFormatter.lmStudioCapabilities || {};
        const strippedSlash = rawModel.includes('/') ? rawModel.split('/').pop() : '';
        const strippedAt = rawModel.includes('@') ? rawModel.split('@')[0] : '';
        const strippedGguf = rawModel.replace(/\.gguf$/i, '');
        const bareBase = (strippedSlash || rawModel).split('@')[0].replace(/\.gguf$/i, '');

        const candidateKeys = [
            rawModel,
            lowerRaw,
            modelId,
            lower,
            strippedSlash,
            strippedSlash ? strippedSlash.toLowerCase() : '',
            strippedAt,
            strippedAt ? strippedAt.toLowerCase() : '',
            strippedGguf,
            strippedGguf ? strippedGguf.toLowerCase() : '',
            bareBase,
            bareBase ? bareBase.toLowerCase() : ''
        ].filter(Boolean);

        let cap = null;
        for (const key of candidateKeys) {
            if (capsMap[key]) {
                cap = capsMap[key];
                break;
            }
        }

        if (cap && Array.isArray(cap.fields) && cap.fields.length > 0) {
            const booleanField = cap.fields.find(f => f.type === 'boolean');
            const selectField = cap.fields.find(f => f.type === 'select');

            let hasThinkingToggle = !!booleanField;
            let isThinkingOn = true;
            if (hasThinkingToggle) {
                const stored = localStorage.getItem(`kai.lmStudioThinking.${rawModel}`) ??
                    localStorage.getItem(`kai.lmStudioThinking.${lowerRaw}`) ??
                    localStorage.getItem(`kai.lmStudioThinking.${modelId}`);
                isThinkingOn = stored !== 'false';
            }

            let hasReasoningEffort = !!selectField;
            let reasoningLevel = 'xhigh';
            let effortOptions = [];
            let effortDisplayName = 'Reasoning Effort';

            if (hasReasoningEffort) {
                effortDisplayName = selectField.displayName || 'Reasoning Effort';
                effortOptions = (selectField.options || []).map(o => ({
                    label: o.label || o.value,
                    value: o.value || o.label
                }));
                const defaultVal = selectField.defaultValue || (effortOptions[0]?.value) || 'xhigh';
                const storedEffort = localStorage.getItem(`kai.lmStudioReasoningLevel.${rawModel}`) ??
                    localStorage.getItem(`kai.lmStudioReasoningLevel.${lowerRaw}`) ??
                    localStorage.getItem(`kai.lmStudioReasoningLevel.${modelId}`);
                reasoningLevel = storedEffort || defaultVal;
            }

            const lmState = {
                rawModel: rawModel,
                hasThinkingToggle: hasThinkingToggle,
                isThinkingOn: isThinkingOn,
                hasReasoningEffort: hasReasoningEffort,
                reasoningLevel: reasoningLevel,
                effortOptions: effortOptions,
                effortDisplayName: effortDisplayName
            };
            console.log('[KAI ThinkingState] LM Studio manifest capabilities:', lmState);
            return lmState;
        }

        // 2. Google Gemini cloud models
        if (lowerRaw.includes('gemini')) {
            const level = localStorage.getItem(`kai.geminiThinkingLevel.${modelId}`) ||
                localStorage.getItem(`kai.geminiThinkingLevel.${rawModel}`) ||
                localStorage.getItem('kai.geminiThinkingLevel') || 'high';
            const geminiState = {
                rawModel: rawModel,
                hasThinkingToggle: false,
                isThinkingOn: level !== 'off' && level !== 'minimal',
                hasReasoningEffort: true,
                reasoningLevel: level,
                effortOptions: [
                    { label: 'High', value: 'high' },
                    { label: 'Medium', value: 'medium' },
                    { label: 'Low', value: 'low' },
                    { label: 'Minimal', value: 'minimal' }
                ],
                effortDisplayName: 'Thinking Level'
            };
            console.log('[KAI ThinkingState] Gemini capabilities:', geminiState);
            return geminiState;
        }

        // 3. OpenRouter cloud reasoning models (100% per-model dictionary from live API)
        if (lowerRaw.startsWith('openrouter/')) {
            const bareModel = rawModel.replace(/^openrouter\//i, '');
            const lowerBare = bareModel.toLowerCase();
            const cap = ThinkingStateFormatter.openRouterReasoningMap[bareModel] ||
                ThinkingStateFormatter.openRouterReasoningMap[lowerBare];

            if (cap) {
                const storedThinking = localStorage.getItem(`kai.openrouterThinking.${rawModel}`) ??
                    localStorage.getItem(`kai.openrouterThinking.${bareModel}`);
                const isThinkingOn = cap.mandatory ? true : (storedThinking !== 'false');

                const hasReasoningEffort = Array.isArray(cap.supportedEfforts) && cap.supportedEfforts.length > 0;
                let effortOptions = [];
                let selectedEffort = 'none';

                if (hasReasoningEffort) {
                    effortOptions = cap.supportedEfforts.map(eff => ({
                        label: ThinkingStateFormatter.formatEffortLabel(eff),
                        value: eff
                    }));
                    const storedEffort = localStorage.getItem(`kai.openrouterReasoningEffort.${rawModel}`) ??
                        localStorage.getItem(`kai.openrouterReasoningEffort.${bareModel}`);
                    selectedEffort = storedEffort || cap.defaultEffort || effortOptions[0].value;
                }

                const orState = {
                    rawModel: rawModel,
                    hasThinkingToggle: !cap.mandatory,
                    isThinkingOn: isThinkingOn,
                    hasReasoningEffort: hasReasoningEffort,
                    reasoningLevel: selectedEffort,
                    effortOptions: effortOptions,
                    effortDisplayName: 'Reasoning Effort'
                };
                console.log('[KAI ThinkingState] OpenRouter lookup:', bareModel, '→ cap:', cap, '→ state:', orState);
                return orState;
            }
        }

        // 4. Mistral cloud reasoning models
        const isMistralReasoning = lowerRaw.includes('magistral') || lowerRaw.includes('codestral');
        if (isMistralReasoning) {
            const stored = localStorage.getItem(`kai.mistralThinking.${rawModel}`);
            const isOn = stored !== 'false';
            const mistralState = {
                rawModel: rawModel,
                hasThinkingToggle: true,
                isThinkingOn: isOn,
                hasReasoningEffort: false,
                reasoningLevel: 'off',
                effortOptions: [],
                effortDisplayName: 'Reasoning Effort'
            };
            console.log('[KAI ThinkingState] Mistral reasoning capabilities:', mistralState);
            return mistralState;
        }

        // 5. Tier 3: Local pattern recognition vangnet for thinking/reasoning models
        const isReasoningPattern = /(ornith|qwen|deepseek|r1|qwq|gemma-4|gemma_4|nemotron|bonsai|lfm|thinking|reasoning)/i.test(lowerRaw);
        if (isReasoningPattern) {
            const stored = localStorage.getItem(`kai.lmStudioThinking.${rawModel}`) ??
                localStorage.getItem(`kai.lmStudioThinking.${lowerRaw}`) ??
                localStorage.getItem(`kai.lmStudioThinking.${modelId}`);
            const isThinkingOn = stored !== 'false';
            const patternState = {
                rawModel: rawModel,
                hasThinkingToggle: true,
                isThinkingOn: isThinkingOn,
                hasReasoningEffort: false,
                reasoningLevel: 'xhigh',
                effortOptions: [],
                effortDisplayName: 'Reasoning Effort'
            };
            console.log('[KAI ThinkingState] Tier 3 pattern matched reasoning model:', patternState);
            return patternState;
        }

        // 6. Standard non-thinking models (100% manifest-driven, no hardcoded fallbacks)
        console.log('[KAI ThinkingState] No reasoning capabilities for:', rawModel);
        return {
            rawModel: rawModel,
            hasThinkingToggle: false,
            isThinkingOn: false,
            hasReasoningEffort: false,
            reasoningLevel: 'off',
            effortOptions: [],
            effortDisplayName: 'Reasoning Effort'
        };
    }

    /**
     * Inspects capabilities and localStorage to return a unified reasoning state object.
     * @param {string} modelId Active or raw model ID string.
     * @returns {object} Reasoning state metadata object.
     */
    static getThinkingState(modelId) {
        const caps = ThinkingStateFormatter.getCapabilitiesState(modelId);
        const isCapable = caps.hasThinkingToggle || caps.hasReasoningEffort;

        let labelText = '';
        if (caps.hasReasoningEffort && caps.reasoningLevel !== 'off' && caps.reasoningLevel !== 'minimal') {
            labelText = caps.reasoningLevel;
        } else if (caps.hasThinkingToggle && caps.isThinkingOn) {
            labelText = 'thinking';
        }

        return {
            isThinkingCapable: isCapable,
            isMultiLevel: caps.hasReasoningEffort,
            level: caps.reasoningLevel,
            isOn: caps.isThinkingOn,
            labelText: labelText,
            dropdownText: labelText,
            hasReasoning: caps.hasReasoningEffort,
            reasoningLevel: caps.reasoningLevel,
            rawModel: caps.rawModel
        };
    }

    /**
     * Resolves info metadata for the Help/Info modal with separated Thinking and Reasoning rows.
     * @param {string} modelId Model ID string.
     * @returns {{ thinking: string|null, reasoning: string|null }} Info status object.
     */
    static getInfoState(modelId) {
        const state = ThinkingStateFormatter.getThinkingState(modelId);
        if (!state.isThinkingCapable) {
            return { thinking: null, reasoning: null };
        }

        return {
            thinking: state.isOn ? 'on' : 'off',
            reasoning: state.hasReasoning ? (state.isOn ? state.level : 'off') : null
        };
    }

    /**
     * Renders clean base model display text into the model selector trigger button.
     * Appends clean text reasoning suffix when active without any icons.
     * @param {object} params Rendering parameters.
     * @param {string} params.modelId Active model ID.
     * @param {HTMLElement} params.container Target DOM container element.
     * @param {object} params.formatter Formatter instance for base model name formatting.
     */
    static renderTriggerLabel({ modelId, container, formatter }) {
        if (!container) return;
        const state = ThinkingStateFormatter.getThinkingState(modelId);
        const formattedBaseName = formatter ? formatter.formatModelName(state.rawModel) : state.rawModel;

        container.innerHTML = '';

        const baseSpan = document.createElement('span');
        if (state.labelText) {
            baseSpan.textContent = `${formattedBaseName} (${state.labelText})`;
        } else {
            baseSpan.textContent = formattedBaseName;
        }
        container.appendChild(baseSpan);
    }

    /**
     * Renders clean label text inside flyout option elements.
     * @param {HTMLElement} element Target container element.
     * @param {string} labelText Display label text.
     */
    static renderFlyoutOptionContent(element, labelText) {
        if (!element) return;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = labelText;
        element.appendChild(labelSpan);
    }
}
