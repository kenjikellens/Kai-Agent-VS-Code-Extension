import { ISessionStorage, ChatSessionRecord } from './core/ISessionStorage';

export { ChatSessionRecord };

/**
 * SessionStore encapsulates reading, writing, and deleting persistent chat history records.
 * Uses a pluggable ISessionStorage driver (e.g. Memento in VS Code, JSON file in Standalone Desktop).
 */
export class SessionStore {
    private cache: Record<string, ChatSessionRecord> = {};

    /**
     * Initializes a new instance of SessionStore.
     * @param storage Pluggable storage driver implementing ISessionStorage.
     */
    constructor(private readonly storage?: ISessionStorage) {
        if (this.storage) {
            const loaded = this.storage.load();
            if (loaded instanceof Promise) {
                loaded.then(data => { this.cache = data || {}; });
            } else {
                this.cache = loaded || {};
            }
        }
    }

    /**
     * Retrieves the sorted array of all saved chat session records.
     * @returns Array of chat sessions sorted by timestamp descending.
     */
    public getHistoryList(): ChatSessionRecord[] {
        return Object.values(this.cache).sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Retrieves a single chat session by its unique ID.
     * @param chatId The session ID to look up.
     * @returns The ChatSessionRecord if found, or undefined.
     */
    public getChat(chatId: string): ChatSessionRecord | undefined {
        return this.cache[chatId];
    }

    /**
     * Saves or updates a chat session record in storage.
     * @param chat The session record to persist.
     */
    public async saveChat(chat: ChatSessionRecord): Promise<void> {
        if (!chat || !chat.id) {
            return;
        }
        const previous = this.cache[chat.id];
        this.cache[chat.id] = {
            id: chat.id,
            title: chat.title || 'New Chat',
            messages: Array.isArray(chat.messages) ? chat.messages : (previous?.messages || []),
            mode: chat.mode || previous?.mode || 'agent',
            model: chat.model || previous?.model || 'default',
            thinking: chat.thinking !== false,
            timestamp: chat.timestamp || Date.now()
        };
        if (this.storage) {
            await this.storage.save(this.cache);
        }
    }

    /**
     * Deletes a chat session from storage by ID.
     * @param chatId The session ID to delete.
     * @returns Updated list of remaining sessions.
     */
    public async deleteChat(chatId: string): Promise<ChatSessionRecord[]> {
        if (!chatId) {
            return this.getHistoryList();
        }
        if (this.cache[chatId]) {
            delete this.cache[chatId];
            if (this.storage) {
                await this.storage.save(this.cache);
            }
        }
        return this.getHistoryList();
    }
}
