/**
 * MermaidRenderer manages offline Mermaid diagram parsing, asynchronous rendering,
 * error boundaries, interactive tab switching (Diagram/Code), and SVG export actions.
 */
class MermaidRenderer {
    /**
     * Initializes the MermaidRenderer and configures the global Mermaid instance.
     */
    constructor() {
        this._isInitialized = false;
        this._initMermaid();
    }

    /**
     * Initializes Mermaid configuration with theme-aware defaults.
     * @private
     */
    _initMermaid() {
        if (typeof window.mermaid !== 'undefined' && !this._isInitialized) {
            try {
                const isLight = document.body.classList.contains('vscode-light') || 
                                document.body.classList.contains('vscode-high-contrast-light');
                window.mermaid.initialize({
                    startOnLoad: false,
                    theme: isLight ? 'default' : 'dark',
                    securityLevel: 'strict',
                    fontFamily: 'var(--app-font, sans-serif)',
                    themeVariables: {
                        darkMode: !isLight,
                        background: isLight ? '#ffffff' : '#1e1e1e',
                        primaryColor: '#007acc',
                        primaryTextColor: isLight ? '#24292e' : '#cccccc',
                        primaryBorderColor: isLight ? '#e1e4e8' : 'rgba(255, 255, 255, 0.12)',
                        lineColor: '#007acc',
                        secondaryColor: isLight ? '#f6f8fa' : '#252526',
                        tertiaryColor: isLight ? '#f0f2f5' : '#1b1b1b'
                    }
                });
                this._isInitialized = true;
            } catch (err) {
                console.error('[MermaidRenderer] Initialization error:', err);
            }
        }
    }

    /**
     * Decodes HTML-escaped characters back to raw text for Mermaid diagram parser.
     * @param {string} str Encoded HTML string.
     * @returns {string} Decoded plain text string.
     */
    decodeHtmlEntities(str) {
        if (!str) return '';
        const txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
    }

    /**
     * Scans the provided container for unrendered Mermaid diagram cards and compiles them into SVGs.
     * @param {HTMLElement} [rootElement] Root DOM element to search within (defaults to document).
     * @returns {Promise<void>} Resolves when all diagrams in the container have finished rendering.
     */
    async renderDiagrams(rootElement = document) {
        if (typeof window.mermaid === 'undefined') {
            this._initMermaid();
            if (typeof window.mermaid === 'undefined') {
                return;
            }
        }

        const unrenderedCards = rootElement.querySelectorAll('.mermaid-diagram-card:not([data-mermaid-processed="true"])');
        if (!unrenderedCards || unrenderedCards.length === 0) return;

        for (const card of Array.from(unrenderedCards)) {
            card.setAttribute('data-mermaid-processed', 'true');
            const previewViewport = card.querySelector('.mermaid-diagram-viewport');
            const svgContainer = card.querySelector('.mermaid-svg-container');
            const errorContainer = card.querySelector('.mermaid-error-notice');
            const encodedCode = card.dataset.rawMermaid || (svgContainer ? svgContainer.dataset.rawCode : '');

            if (!encodedCode || !svgContainer) continue;

            const rawCode = this.decodeHtmlEntities(encodedCode).trim();
            const uniqueId = `mermaid_diag_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

            try {
                // Render Mermaid diagram SVG asynchronously
                const { svg } = await window.mermaid.render(uniqueId, rawCode);
                svgContainer.innerHTML = this._sanitizeSvg(svg);
                svgContainer.classList.remove('hidden');
                if (errorContainer) errorContainer.classList.add('hidden');
            } catch (renderError) {
                console.warn('[MermaidRenderer] Diagram render error:', renderError);
                // Clean up any failed temporary mermaid element left in body
                const strayEl = document.getElementById(uniqueId) || document.getElementById(`d${uniqueId}`);
                if (strayEl) strayEl.remove();

                // Display graceful error state and switch to code view fallback
                if (errorContainer) {
                    errorContainer.textContent = `Diagram syntax error: ${renderError.message || 'Malformed Mermaid definition'}`;
                    errorContainer.classList.remove('hidden');
                }
                if (svgContainer) {
                    svgContainer.classList.add('hidden');
                }

                // Automatically activate the raw code tab so user can see source
                this.setActiveTab(card, 'code');
            }
        }
    }

    /**
     * Strips dangerous script elements, event handlers, and javascript: URIs from rendered SVG markup.
     * @param {string} svgMarkup Raw SVG string.
     * @returns {string} Sanitized SVG markup.
     */
    _sanitizeSvg(svgMarkup) {
        if (!svgMarkup || typeof DOMParser === 'undefined') return '';
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
        if (doc.querySelector('parsererror')) return '';
        doc.querySelectorAll('script').forEach(el => el.remove());
        doc.querySelectorAll('*').forEach(el => {
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                const val = attr.value.trim().toLowerCase();
                if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && val.startsWith('javascript:'))) {
                    el.removeAttribute(attr.name);
                }
            }
        });
        return new XMLSerializer().serializeToString(doc.documentElement);
    }

    /**
     * Sets the active tab for a given Mermaid diagram card (Diagram vs Code view).
     * @param {HTMLElement} card The .mermaid-diagram-card element.
     * @param {'diagram'|'code'} tabName The tab to activate.
     */
    setActiveTab(card, tabName) {
        if (!card) return;
        const tabs = card.querySelectorAll('.mermaid-tab-btn');
        const diagramViewport = card.querySelector('.mermaid-diagram-viewport');
        const sourceCodeViewport = card.querySelector('.mermaid-source-viewport');

        tabs.forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        if (tabName === 'code') {
            if (diagramViewport) diagramViewport.classList.add('hidden');
            if (sourceCodeViewport) sourceCodeViewport.classList.remove('hidden');
        } else {
            if (diagramViewport) diagramViewport.classList.remove('hidden');
            if (sourceCodeViewport) sourceCodeViewport.classList.add('hidden');
        }
    }

    /**
     * Copies raw Mermaid code to user clipboard.
     * @param {HTMLElement} card The .mermaid-diagram-card element.
     * @param {HTMLElement} btn The clicked button element.
     */
    async copyMermaidCode(card, btn) {
        if (!card) return;
        const encodedCode = card.dataset.rawMermaid || '';
        const rawCode = this.decodeHtmlEntities(encodedCode).trim();
        if (!rawCode) return;

        try {
            await navigator.clipboard.writeText(rawCode);
            this._flashButtonSuccess(btn);
        } catch (err) {
            console.error('[MermaidRenderer] Failed to copy code:', err);
        }
    }

    /**
     * Copies rendered SVG markup to user clipboard.
     * @param {HTMLElement} card The .mermaid-diagram-card element.
     * @param {HTMLElement} btn The clicked button element.
     */
    async copyMermaidSvg(card, btn) {
        if (!card) return;
        const svgContainer = card.querySelector('.mermaid-svg-container');
        const svgEl = svgContainer ? svgContainer.querySelector('svg') : null;
        if (!svgEl) return;

        try {
            const svgText = svgEl.outerHTML;
            await navigator.clipboard.writeText(svgText);
            this._flashButtonSuccess(btn);
        } catch (err) {
            console.error('[MermaidRenderer] Failed to copy SVG:', err);
        }
    }

    /**
     * Downloads the rendered SVG as a local .svg file.
     * @param {HTMLElement} card The .mermaid-diagram-card element.
     */
    downloadMermaidSvg(card) {
        if (!card) return;
        const svgContainer = card.querySelector('.mermaid-svg-container');
        const svgEl = svgContainer ? svgContainer.querySelector('svg') : null;
        if (!svgEl) return;

        try {
            const svgData = svgEl.outerHTML;
            const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mermaid_diagram_${Date.now()}.svg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[MermaidRenderer] Failed to download SVG:', err);
        }
    }

    /**
     * Temporarily flashes a success checkmark on a button.
     * @private
     * @param {HTMLElement} btn Target button.
     */
    _flashButtonSuccess(btn) {
        if (!btn) return;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('copied');
        }, 1600);
    }
}
