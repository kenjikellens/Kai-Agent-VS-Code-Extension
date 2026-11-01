/**
 * Interface representing a chat session record stored in persistence.
 */
export interface ChatSessionRecord {
    /** Unique session identifier. */
    id: string;
    /** Human-readable title of the chat session. */
    title: string;
    /** Array of stored message turn objects. */
    messages: any[];
    /** Active mode used in this session. */
    mode?: string;
    /** Active model used in this session. */
    model?: string;
    /** Whether model thinking/reasoning was enabled. */
    thinking?: boolean;
    /** Creation or last-modified epoch timestamp in milliseconds. */
    timestamp: number;
}

/**
 * Pluggable storage driver interface for persisting chat session records.
 * Decouples session management from VS Code Memento vs Node filesystem storage.
 */
export interface ISessionStorage {
    /**
     * Loads all session records from persistent storage into memory.
     * @returns Dictionary of chat sessions indexed by session ID.
     */
    load(): Promise<Record<string, ChatSessionRecord>> | Record<string, ChatSessionRecord>;

    /**
     * Saves all session records back to persistent storage.
     * @param sessions Dictionary of chat sessions indexed by session ID.
     */
    save(sessions: Record<string, ChatSessionRecord>): Promise<void> | void;
}

