/**
 * Constants.js provides global configuration constants for Kai Agent UI.
 */
const KAI_CONSTANTS = {
    DEFAULT_GEMINI_MODELS: [
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3-flash-preview',
        'gemini-3.1-pro-preview',
        'gemini-3.1-flash-lite',
    ],
    DEFAULT_FREE_PROVIDERS: [
        { name: 'Google Gemini', configKey: 'geminiApiKey', keyHint: 'Get free key at aistudio.google.com', docUrl: 'https://aistudio.google.com/app/apikey' },
        { name: 'Mistral AI', configKey: 'mistralApiKey', keyHint: 'Get free key at console.mistral.ai', docUrl: 'https://console.mistral.ai/api-keys/' },
        { name: 'Cohere', configKey: 'cohereApiKey', keyHint: 'Get free key at dashboard.cohere.com', docUrl: 'https://dashboard.cohere.com/api-keys' },
        { name: 'Cerebras', configKey: 'cerebrasApiKey', keyHint: 'Get free key at cloud.cerebras.ai', docUrl: 'https://cloud.cerebras.ai/' },
        { name: 'Zhipu AI', configKey: 'zhipuApiKey', keyHint: 'Get free key at open.bigmodel.cn', docUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
        { name: 'OmniRoute Gateway', configKey: 'omnirouteApiKey', keyHint: 'Run OmniRoute via npm: npx omniroute', docUrl: 'https://github.com/omniroute/omniroute' },
        { name: 'OpenRouter', configKey: 'openrouterApiKey', keyHint: 'Get API key at openrouter.ai/keys', docUrl: 'https://openrouter.ai/keys' }
    ],
    DEFAULT_PROVIDERS_WITH_MODELS: [
        { name: 'OmniRoute Gateway', models: ['omniroute/auto'] },
        { name: 'OpenRouter', models: ['openrouter/stealth/ox-alpha', 'openrouter/google/gemma-4-31b-it:free', 'openrouter/google/gemma-4-26b-a4b-it:free', 'openrouter/cohere/north-mini-code:free', 'openrouter/z-ai/glm-5.2:free', 'openrouter/nvidia/nemotron-3.5-lightning:free', 'openrouter/nvidia/nemotron-3-super-120b-a12b:free', 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/poolside/laguna-s-2.1:free', 'openrouter/thinkingmachines/inkling:free', 'openrouter/liquid/lfm-2.5-2.6b:free'] },
        { name: 'Mistral AI', models: ['mistral/magistral-small-latest', 'mistral/magistral-medium-latest', 'mistral/mistral-small-latest', 'mistral/mistral-medium-3-5', 'mistral/codestral-latest', 'mistral/open-mixtral-8x22b'] },
        { name: 'Cohere', models: ['cohere/command-r-plus', 'cohere/command-r'] },
        { name: 'Cerebras', models: ['cerebras/llama-3.3-70b', 'cerebras/llama-3.1-8b'] },
        { name: 'Zhipu AI', models: ['zhipu/glm-4-flash', 'zhipu/glm-4-plus'] }
    ],
    TOOL_ICON_ALIASES: {
        'replace_file_content': 'edit_file',
        'multi_replace_file_content': 'edit_file',
        'search_web': 'web_search',
        'history': 'get_time',
        'new_chat': 'plus'
    },
    DEFAULT_SVGS: {
        'spinner': '<span class="thinking-spinner"></span>'
    }
};

/**
 * Populates alias keys on window.KAI_SVGS from standalone SVG assets loaded by SidebarProvider.
 * Preserves existing tool icon lookups without duplicating inline SVG markup in Constants.js.
 */
if (typeof window !== 'undefined') {
    window.KAI_SVGS = Object.assign({}, KAI_CONSTANTS.DEFAULT_SVGS, window.KAI_SVGS || {});
    for (const [alias, target] of Object.entries(KAI_CONSTANTS.TOOL_ICON_ALIASES)) {
        if (!window.KAI_SVGS[alias] && window.KAI_SVGS[target]) {
            window.KAI_SVGS[alias] = window.KAI_SVGS[target];
        }
    }
}
