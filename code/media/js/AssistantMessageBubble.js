/**
 * AssistantMessageBubble encapsulates rendering of assistant response rows,
 * formatted markdown content, and bottom action bars (copy text, retry turn).
 */
class AssistantMessageBubble {
    /**
     * Renders an assistant message container DOM element.
     * @param {string} formattedHtml Formatted HTML string.
     * @param {string} rawText Raw assistant response text.
     * @param {object} [options] Bubble options and callbacks.
     * @param {Function} [options.onRetry] Callback when user clicks retry turn.
     * @returns {HTMLElement} The created assistant message DOM element.
     */
    static render(formattedHtml, rawText, options = {}) {
        const row = document.createElement('div');
        row.className = 'message assistant-message';
        row.dataset.rawContent = rawText || '';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = formattedHtml;
        row.appendChild(contentDiv);

        AssistantMessageBubble.attachActionBar(row, rawText, options.onRetry);
        return row;
    }

    /**
     * Attaches or updates the action bar at the bottom of an assistant message.
     * @param {HTMLElement} assistantRow The .message.assistant-message element.
     * @param {string} rawText Raw text of the assistant response.
     * @param {Function} [onRetry] Callback when retry is clicked.
     */
    static attachActionBar(assistantRow, rawText, onRetry = null) {
        if (!assistantRow) return;

        const existingActions = assistantRow.querySelector('.message-actions');
        if (existingActions) existingActions.remove();

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions assistant-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'icon-btn copy-msg-btn';
        copyBtn.title = 'Copy response';
        copyBtn.setAttribute('aria-label', 'Copy response');
        copyBtn.innerHTML = DOMUtils.icon('copy_response', 14);
        copyBtn.addEventListener('click', () => {
            const textToCopy = rawText || assistantRow.dataset.rawContent || assistantRow.innerText;
            navigator.clipboard.writeText(textToCopy);
            copyBtn.classList.add('copied');
            setTimeout(() => copyBtn.classList.remove('copied'), 1500);
        });
        actionsDiv.appendChild(copyBtn);

        if (typeof onRetry === 'function') {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'icon-btn retry-msg-btn';
            retryBtn.title = 'Retry turn';
            retryBtn.setAttribute('aria-label', 'Retry turn');
            retryBtn.innerHTML = DOMUtils.icon('retry', 14);
            retryBtn.addEventListener('click', () => onRetry(assistantRow));
            actionsDiv.appendChild(retryBtn);
        }

        assistantRow.appendChild(actionsDiv);
    }
}
