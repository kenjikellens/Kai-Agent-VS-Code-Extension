import * as vscode from 'vscode';
import { ALL_LOCALES } from './AllLocales';

/**
 * Interface defining translation keys for UI elements and messages.
 */
export interface Translations {
    newChat: string;
    previousChats: string;
    noPreviousChats: string;
    history: string;
    settings: string;
    manageApiKeys: string;
    showThinking: string;
    keepThinkingGenerating: string;
    keepThinkingFinished: string;
    thinkingToggle: string;
    thinkingProcess: string;
    thinkingText: string;
    messagePlaceholder: string;
    lmStudioHeader: string;
    checkingServer: string;
    connected: string;
    offline: string;
    cloudProvidersHeader: string;
    selectModel: string;
    noWorkspaceError: string;
    language: string;
    uploadFile: string;
    planningMode: string;
    planningModeDesc: string;
    generalSettings: string;
    thinkingSettings: string;
    apiKeysSettings: string;
    thinkingDisplayStyle: string;
    serverUrl: string;
    lmStudioDirectory: string;
    browse: string;
    checkingCache: string;
    cacheLoaded: string;
    cacheNotFound: string;
    geminiApiKey: string;
    manageFreeProviderKeys: string;
    externalProvidersHeader: string;
    externalProviderApiKeys: string;
    close: string;
    iconAndText: string;
    iconOnly: string;
    textOnly: string;
    welcomeTitle: string;
    welcomePromptHint: string;
    help: string;
    readme: string;
    serverUrlDesc?: string;
    lmStudioDirectoryDesc?: string;
    thinkingDisplayStyleDesc?: string;
    showThinkingDesc?: string;
    keepThinkingGeneratingDesc?: string;
    keepThinkingFinishedDesc?: string;
    apiKeysSettingsDesc?: string;
    testConnection?: string;
    noWorkspaceSelected?: string;
    placeholderChat?: string;
    placeholderAsk?: string;
    placeholderAgent?: string;
    placeholderPlanning?: string;
    theme?: string;
    themeDesc?: string;
    darkTheme?: string;
    lightTheme?: string;
    systemTheme?: string;
    uiScale?: string;
    uiScaleDesc?: string;
    thinkingMaxHeight?: string;
    thinkingMaxHeightDesc?: string;
    streamSettleDelay?: string;
    streamSettleDelayDesc?: string;
    speed?: string;
    askUserSkip?: string;
    askUserCustomPlaceholder?: string;
}

/**
 * Interface for language selector option metadata.
 */
export interface LanguageOption {
    value: string;
    label: string;
}

/**
 * Dictionary registry mapping language codes to unified ALL_LOCALES dictionary.
 */
const LOCALES: Record<string, Translations> = ALL_LOCALES;

/**
 * Manages active language resolution and translation lookup.
 */
export class I18nManager {
    /**
     * Returns supported language options for UI select controls.
     */
    public static getSupportedLanguages(): LanguageOption[] {
        return [
            { value: 'auto', label: 'Auto (VS Code)' },
            { value: 'en', label: 'English' },
            { value: 'nl', label: 'Nederlands' },
            { value: 'de', label: 'Deutsch' },
            { value: 'fr', label: 'Français' },
            { value: 'es', label: 'Español' },
            { value: 'zh', label: '中文 (简体)' },
            { value: 'zh-tw', label: '中文 (繁體)' },
            { value: 'pt', label: 'Português' },
            { value: 'ja', label: '日本語 (Japanese)' },
            { value: 'ko', label: '한국어 (Korean)' },
            { value: 'ru', label: 'Русский (Russian)' },
            { value: 'it', label: 'Italiano (Italian)' },
            { value: 'pl', label: 'Polski (Polish)' },
            { value: 'tr', label: 'Türkçe (Turkish)' },
            { value: 'cs', label: 'Čeština (Czech)' },
            { value: 'hu', label: 'Magyar (Hungarian)' },
            { value: 'ar', label: 'العربية (Arabic)' },
            { value: 'hi', label: 'हिन्दी (Hindi)' }
        ];
    }

    /**
     * Resolves the active language code based on setting or VS Code environment.
     */
    public static getActiveLanguage(): string {
        const config = vscode.workspace.getConfiguration('kai');
        const setting = config.get<string>('language') || 'auto';
        if (setting === 'auto') {
            const vscodeLang = vscode.env.language ? vscode.env.language.toLowerCase() : 'en';
            if (LOCALES[vscodeLang]) return vscodeLang;
            const baseLang = vscodeLang.slice(0, 2);
            if (LOCALES[baseLang]) return baseLang;
            return 'en';
        }
        return LOCALES[setting] ? setting : 'en';
    }

    /**
     * Retrieves the translation dictionary for the active language.
     */
    public static getTranslations(): Translations {
        const lang = this.getActiveLanguage();
        return LOCALES[lang] || LOCALES.en;
    }
}

