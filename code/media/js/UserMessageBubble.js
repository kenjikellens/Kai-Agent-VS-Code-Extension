/**
 * UserMessageBubble encapsulates rendering of user message rows, text content,
 * hover action bars (copy text, edit prompt), and attached file pills.
 */
class UserMessageBubble {
    /**
     * Renders a user message bubble DOM element.
     * @param {string} text Raw message text.
     * @param {object} [options] Bubble options and action callbacks.
     * @param {Function} [options.onEdit] Callback invoked when user clicks the edit button.
     * @param {Function} [options.onCopy] Callback invoked when user clicks copy button.
     * @returns {HTMLElement} The created user message DOM element.
     */
    static render(text, options = {}) {
        const row = document.createElement('div');
        const isMulti = text && (text.includes('\n') || text.length > 80);
        row.className = `message user-message${isMulti ? ' is-multiline' : ''}`;
        row.dataset.rawContent = text;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text;
        row.appendChild(contentDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions user-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'icon-btn copy-msg-btn';
        copyBtn.title = 'Copy prompt';
        copyBtn.setAttribute('aria-label', 'Copy prompt');
        copyBtn.innerHTML = DOMUtils.icon('copy_response', 14);
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(text);
            copyBtn.classList.add('copied');
            setTimeout(() => copyBtn.classList.remove('copied'), 1500);
        });
        actionsDiv.appendChild(copyBtn);

        if (typeof options.onEdit === 'function') {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'icon-btn edit-msg-btn';
            editBtn.title = 'Edit prompt';
            editBtn.setAttribute('aria-label', 'Edit prompt');
            editBtn.innerHTML = DOMUtils.icon('edit_file', 14);
            editBtn.addEventListener('click', () => options.onEdit(row, text));
            actionsDiv.appendChild(editBtn);
        }

        row.appendChild(actionsDiv);
        return row;
    }
}
