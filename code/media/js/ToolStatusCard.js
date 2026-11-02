/**
 * ToolStatusCard encapsulates rendering of tool execution progress badges
 * and collapsible CLI output / diagnostics dropdowns.
 */
class ToolStatusCard {
    /**
     * Renders a tool status row element.
     * @param {object} options Tool execution status descriptor.
     * @param {string} options.toolId Unique tool execution ID.
     * @param {string} options.tool Tool name key.
     * @param {string} [options.fileName] Target file name or query text.
     * @param {'in-progress'|'success'|'error'} [options.state] Execution state.
     * @param {string} [options.output] CLI execution output string.
     * @param {MarkdownFormatter} [options.formatter] Formatter instance.
     * @returns {HTMLElement} The created tool status row DOM element.
     */
    static render({ toolId, tool, fileName, state = 'in-progress', output, formatter }) {
        const rowDiv = document.createElement('div');
        if (toolId) rowDiv.id = toolId;
        rowDiv.className = `tool-status-row ${state === 'error' ? 'errored' : (state === 'success' ? 'completed' : 'in-progress')}`;

        const desc = ToolStatusCard.getToolDescription(tool, fileName, state === 'error' ? 'error' : (state === 'success' ? 'success' : 'running'));
        rowDiv.innerHTML = desc;

        if (output) {
            const dropdownDiv = document.createElement('div');
            dropdownDiv.className = 'tool-result-dropdown hidden';
            const safeOutput = formatter ? formatter.escapeHtml(output) : (typeof DOMUtils !== 'undefined' ? DOMUtils.escapeHtml(output) : output);
            dropdownDiv.innerHTML = `<pre><code>${safeOutput}</code></pre>`;
            rowDiv.appendChild(dropdownDiv);
        }

        return rowDiv;
    }

    /**
     * Generates standard localized tool description markup with icons.
     * @param {string} tool Tool identifier.
     * @param {string} [fileName] Target file or argument.
     * @param {'running'|'success'|'error'} [state] Tool state.
     * @returns {string} Tool description HTML markup.
     */
    static getToolDescription(tool, fileName, state = 'running') {
        const i18n = (typeof window !== 'undefined' && window.KAI_I18N) || {};
        const svgs = (typeof window !== 'undefined' && window.KAI_SVGS) || {};
        const toolSvg = svgs[tool] || svgs['default_tool'] || '';

        let badge = svgs['spinner'] || '<span class="thinking-spinner"></span>';
        if (state === 'success') badge = svgs['success'] || '✓';
        if (state === 'error') badge = svgs['error'] || '✗';

        let name = tool;
        if (tool === 'read_file') name = i18n.toolReading || 'Reading';
        else if (tool === 'write_file') name = i18n.toolWriting || 'Writing';
        else if (tool === 'replace_file_content' || tool === 'edit_file') name = i18n.toolEditing || 'Editing';
        else if (tool === 'list_dir') name = i18n.toolListing || 'Listing';
        else if (tool === 'run_command') name = i18n.toolExecuting || 'Executing';
        else if (tool === 'web_search' || tool === 'search_web') name = i18n.toolSearchingWeb || 'Searching web';
        else if (tool === 'ask_user') name = i18n.toolAskingUser || (state === 'running' ? 'Asking a question...' : 'Question answered');

        const safeFile = fileName ? (typeof DOMUtils !== 'undefined' ? DOMUtils.escapeHtml(fileName) : fileName) : '';
        return `
            <div class="tool-status-header">
                <span class="tool-status-icon">${toolSvg}</span>
                <span class="tool-status-text">${name} ${safeFile ? `<code>${safeFile}</code>` : ''}</span>
                <span class="tool-status-badge">${badge}</span>
            </div>
        `;
    }
}
