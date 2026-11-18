/**
 * HistoryManager manages rendering the chat history list overlay,
 * single-line item layouts, history item click events, and session deletion.
 */
class HistoryManager {
    /**
     * Initializes history DOM references and button click handlers.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     * @param {Function} onViewSwitch Callback to switch active content view.
     */
    constructor(ipcBridge, onViewSwitch) {
        this.ipcBridge = ipcBridge;
        this.onViewSwitch = onViewSwitch;

        this.historyContainer = document.getElementById('history-container');
        this.historyList = document.getElementById('history-list');
        this.historyBtn = document.getElementById('history-btn');
        this.closeHistoryBtn = document.getElementById('close-history-btn');

        this.initEventListeners();
    }

    /**
     * Registers top bar history button and close button click events.
     */
    initEventListeners() {
        if (this.historyBtn) {
            this.historyBtn.addEventListener('click', () => {
                this.ipcBridge.loadChatHistory();
                if (this.onViewSwitch) {
                    this.onViewSwitch('history');
                }
            });
        }

        if (this.closeHistoryBtn) {
            this.closeHistoryBtn.addEventListener('click', () => {
                if (this.onViewSwitch) {
                    this.onViewSwitch('chat');
                }
            });
        }
    }

    /**
     * Formats timestamp into a concise single-line string (e.g., "14:32" or "23 Jul").
     * @param {number} timestamp Date timestamp.
     * @returns {string} Formatted compact time string.
     */
    formatHistoryTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    /**
     * Renders the list of previous chat sessions in the history overlay panel using a single-line layout.
     * @param {Array<object>} chats List of saved chat session records.
     * @param {boolean} isWaitingForResponse Active generation status.
     */
    renderHistoryList(chats, isWaitingForResponse) {
        if (!this.historyList) return;
        this.historyList.innerHTML = '';

        if (!chats || chats.length === 0) {
            const i18n = window.KAI_I18N || {};
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'history-empty-state';
            emptyDiv.textContent = i18n.noPreviousChats || 'No previous chats found.';
            this.historyList.appendChild(emptyDiv);
            return;
        }

        const chatSvg = `<svg class="history-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

        chats.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.title = chat.title || 'New Chat';
            
            const content = document.createElement('div');
            content.className = 'history-item-content';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'history-item-icon-wrapper';
            iconSpan.innerHTML = chatSvg;

            const title = document.createElement('span');
            title.className = 'history-item-title';
            title.textContent = chat.title || 'New Chat';

            const time = document.createElement('span');
            time.className = 'history-item-time';
            time.textContent = this.formatHistoryTime(chat.timestamp);

            content.appendChild(iconSpan);
            content.appendChild(title);
            content.appendChild(time);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'icon-btn icon-btn--delete';
            deleteBtn.title = 'Delete Chat';
            deleteBtn.innerHTML = window.KAI_SVGS['delete'] || '✕';
            
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const chatIdToDelete = chat.id;
                const wasActive = (this.activeChatId === chatIdToDelete);

                try {
                    let localSaved = JSON.parse(localStorage.getItem('kai.savedChatsSummary') || '[]');
                    localSaved = localSaved.filter(c => c.id !== chatIdToDelete);
                    localStorage.setItem('kai.savedChatsSummary', JSON.stringify(localSaved));
                    this.renderHistoryList(localSaved.map(c => ({
                        id: c.id,
                        title: c.title || 'New Chat',
                        timestamp: c.timestamp || Date.now()
                    })));
                } catch (err) {}

                this.ipcBridge.deleteChat(chatIdToDelete);

                if (wasActive && typeof this.onDeleteActiveChat === 'function') {
                    this.onDeleteActiveChat(chatIdToDelete);
                }
            });
            
            item.addEventListener('click', (e) => {
                if (e.target && e.target.closest && e.target.closest('.icon-btn--delete')) {
                    return;
                }
                if (isWaitingForResponse) {
                    this.ipcBridge.abort();
                }
                this.ipcBridge.loadChat(chat.id);
                if (this.onViewSwitch) {
                    this.onViewSwitch('chat');
                }
            });

            item.appendChild(content);
            item.appendChild(deleteBtn);
            this.historyList.appendChild(item);
        });
    }
}
