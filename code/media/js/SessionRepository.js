/**
 * SessionRepository provides a repository interface for loading, saving,
 * and deleting chat session histories with localStorage cache and IPC synchronization.
 */
class SessionRepository {
    /**
     * Initializes repository with reference to WebviewIPCBridge and auto-save timers.
     * @param {WebviewIPCBridge} [ipcBridge] IPC bridge instance.
     */
    constructor(ipcBridge = null) {
        this.ipcBridge = ipcBridge;
        this.storageKey = 'kai.savedFullSessions';
        this.legacyStorageKey = 'kai.savedChats';
        this._isDirty = false;
        this._pendingSession = null;
        this._debounceTimer = null;
        this._sessionsCache = null;
    }

    /**
     * Clears in-memory session cache.
     */
    invalidateCache() {
        this._sessionsCache = null;
    }

    /**
     * Retrieves all saved chat sessions from in-memory cache or localStorage.
     * @param {boolean} [forceRefresh=false] True to bypass in-memory cache.
     * @returns {Array<object>} List of saved session objects.
     */
    getAllSessions(forceRefresh = false) {
        if (!forceRefresh && this._sessionsCache !== null) {
            return this._sessionsCache;
        }
        try {
            const storedRaw = localStorage.getItem(this.storageKey);
            if (storedRaw !== null) {
                const stored = JSON.parse(storedRaw);
                this._sessionsCache = Array.isArray(stored) ? stored : [];
                return this._sessionsCache;
            }

            const legacy = JSON.parse(localStorage.getItem(this.legacyStorageKey) || '[]');
            const completeLegacy = Array.isArray(legacy)
                ? legacy.filter(session => session && session.id &&
                    (Array.isArray(session.messages) || Array.isArray(session.uiEvents)))
                : [];
            if (completeLegacy.length > 0) {
                localStorage.setItem(this.storageKey, JSON.stringify(completeLegacy));
            }
            this._sessionsCache = completeLegacy;
            return this._sessionsCache;
        } catch (e) {
            console.error('SessionRepository: failed to read saved chats', e);
            this._sessionsCache = [];
            return this._sessionsCache;
        }
    }

    /**
     * Finds a single session by its unique chat ID.
     * @param {string} chatId Unique session identifier.
     * @returns {object|null} Found session object or null.
     */
    getSessionById(chatId) {
        if (!chatId) return null;
        const all = this.getAllSessions();
        return all.find(c => c.id === chatId) || null;
    }

    /**
     * Alias for getSessionById to find a single session.
     * @param {string} chatId Unique session identifier.
     * @returns {object|null} Found session object or null.
     */
    getSession(chatId) {
        return this.getSessionById(chatId);
    }

    /**
     * Marks session as dirty and triggers a 500ms debounced save.
     * @param {object} session Current session state.
     */
    markDirty(session) {
        this._pendingSession = session;
        this._isDirty = true;
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            if (this._isDirty && this._pendingSession) {
                this.saveSession(this._pendingSession);
                this._isDirty = false;
                this._pendingSession = null;
            }
        }, 500);
    }

    /**
     * Saves or updates a session in localStorage and notifies backend.
     * @param {object} session Session object to persist.
     */
    saveSession(session) {
        if (!session || !session.id) return;
        const hasMessages = Array.isArray(session.messages);
        const hasUiEvents = Array.isArray(session.uiEvents);
        if (!hasMessages && !hasUiEvents) return;
        const all = this.getAllSessions();
        const index = all.findIndex(c => c.id === session.id);
        const previous = index >= 0 ? all[index] : {};
        const completeSession = {
            ...previous,
            ...session,
            messages: hasMessages ? session.messages : (previous.messages || []),
            uiEvents: hasUiEvents ? session.uiEvents : (previous.uiEvents || [])
        };
        if (index >= 0) {
            all[index] = completeSession;
        } else {
            all.unshift(completeSession);
        }
        this._sessionsCache = all;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(all));
        } catch (e) {
            console.error('SessionRepository: failed to save session', e);
        }

        if (this.ipcBridge && typeof this.ipcBridge.saveChat === 'function') {
            this.ipcBridge.saveChat(completeSession);
        }
    }

    /**
     * Deletes a session by ID from localStorage and backend.
     * @param {string} chatId Unique chat identifier to delete.
     */
    deleteSession(chatId) {
        if (!chatId) return;
        const all = this.getAllSessions();
        const filtered = all.filter(c => c.id !== chatId);
        this._sessionsCache = filtered;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(filtered));
        } catch (e) {
            console.error('SessionRepository: failed to delete session', e);
        }

        if (this.ipcBridge && typeof this.ipcBridge.deleteChat === 'function') {
            this.ipcBridge.deleteChat(chatId);
        }
    }
}
