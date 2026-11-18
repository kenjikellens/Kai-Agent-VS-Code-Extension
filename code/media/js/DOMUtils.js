/**
 * DOMUtils provides reusable DOM creation and SVG helper utilities.
 */
class DOMUtils {
    /**
     * Creates an SVG element with attributes.
     * @param {string} tag SVG element tag name.
     * @param {object} attrs Key-value attribute map.
     * @returns {SVGElement} SVG element.
     */
    static createSvg(tag, attrs = {}) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const el = document.createElementNS(svgNS, tag);
        for (const [key, value] of Object.entries(attrs)) {
            el.setAttribute(key, value);
        }
        return el;
    }

    static _svgCache = {};

    /**
     * Preloads and caches SVG text from media/svg/.
     * @param {string} name Asset name without extension.
     * @returns {Promise<string>} Raw SVG markup string.
     */
    static async loadSvg(name) {
        if (DOMUtils._svgCache[name]) return DOMUtils._svgCache[name];
        try {
            const res = await fetch(`media/svg/${name}.svg`);
            if (res.ok) {
                const text = await res.text();
                DOMUtils._svgCache[name] = text;
                return text;
            }
        } catch (e) {}
        return '';
    }

    /**
     * Injects a standalone SVG into a container element dynamically.
     * @param {HTMLElement} container Parent DOM element.
     * @param {string} name SVG asset name.
     * @param {string} [className=''] Extra CSS class to attach.
     */
    static async injectSvg(container, name, className = '') {
        if (!container) return;
        const svgText = await DOMUtils.loadSvg(name);
        if (svgText) {
            container.innerHTML = svgText;
            const svgEl = container.querySelector('svg');
            if (svgEl && className) {
                svgEl.classList.add(...className.split(' ').filter(Boolean));
            }
        }
    }

    /**
     * Generates a standard chevron SVG element.
     * @param {string} className CSS class name.
     * @returns {SVGElement} Chevron SVG element.
     */
    static createChevronIcon(className = 'chevron-icon') {
        const svg = DOMUtils.createSvg('svg', {
            class: className,
            width: '8',
            height: '8',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '3',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        });
        const polyline = DOMUtils.createSvg('polyline', { points: '6 9 12 15 18 9' });
        svg.appendChild(polyline);
        return svg;
    }

    /**
     * Returns standalone SVG markup from window.KAI_SVGS with normalized dimensions and optional class/stroke overrides.
     * Central icon source for all webview controllers; reads window.KAI_SVGS without mutating the DOM.
     * @param {string} name Asset name in window.KAI_SVGS.
     * @param {number} [size=14] Pixel width and height to apply.
     * @param {{ className?: string, strokeWidth?: number, fallbackName?: string }} [opts={}] Optional rendering overrides.
     * @returns {string} SVG markup string or empty string if missing.
     */
    static icon(name, size = 14, opts = {}) {
        const svgs = (typeof window !== 'undefined' && window.KAI_SVGS) || {};
        const fallback = opts.fallbackName || 'default_tool';
        let raw = svgs[name] || svgs[fallback] || '';
        if (!raw) return '';
        if (size) {
            raw = raw.replace(/\swidth="[^"]*"/, ` width="${size}"`).replace(/\sheight="[^"]*"/, ` height="${size}"`);
        }
        if (opts.strokeWidth !== undefined) {
            raw = raw.replace(/\sstroke-width="[^"]*"/, ` stroke-width="${opts.strokeWidth}"`);
        }
        if (opts.className !== undefined) {
            if (/\sclass="[^"]*"/.test(raw)) {
                raw = raw.replace(/\sclass="[^"]*"/, opts.className ? ` class="${opts.className}"` : '');
            } else if (opts.className) {
                raw = raw.replace('<svg', `<svg class="${opts.className}"`);
            }
        }
        return raw;
    }

    /**
     * Returns chevron SVG markup string for inline HTML templates.
     * Delegates to DOMUtils.icon using the standalone chevron_down asset.
     * @param {string} className CSS class name.
     * @returns {string} SVG HTML string.
     */
    static getChevronSvgString(className = 'thinking-chevron') {
        return DOMUtils.icon('chevron_down', 8, { className, strokeWidth: 3 });
    }

    /**
     * Returns upwards chevron SVG markup string.
     * Delegates to DOMUtils.icon using the standalone chevron_up asset.
     * @param {string} className CSS class name.
     * @returns {string} SVG HTML string.
     */
    static getChevronUpSvgString(className = 'thinking-chevron') {
        return DOMUtils.icon('chevron_up', 8, { className, strokeWidth: 3 });
    }

    /**
     * Generates a standard checkmark SVG element.
     * @param {string} className CSS class name.
     * @returns {SVGElement} Checkmark SVG element.
     */
    static createCheckIcon(className = 'check-icon') {
        const svg = DOMUtils.createSvg('svg', {
            class: className,
            width: '12',
            height: '12',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2.5',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        });
        const polyline = DOMUtils.createSvg('polyline', { points: '20 6 9 17 4 12' });
        svg.appendChild(polyline);
        return svg;
    }

    /**
     * Creates a Lightbulb SVG element for Thinking state indicators.
     * Renders vibrant yellow when active, or muted gray with a diagonal slash when inactive.
     * @param {boolean} [isOn=true] Whether thinking is active.
     * @param {string} [className='thinking-lamp-icon'] Optional CSS class name.
     * @returns {SVGElement} The created SVG element.
     */
    static createLightbulbIcon(isOn = true, className = 'thinking-lamp-icon') {
        const stateClass = isOn ? 'lamp-on' : 'lamp-off';
        const fullClassName = className ? `${className} ${stateClass}` : stateClass;

        const svg = DOMUtils.createSvg('svg', {
            class: fullClassName,
            width: '14',
            height: '14',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        });

        const path = DOMUtils.createSvg('path', {
            d: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'
        });
        const line1 = DOMUtils.createSvg('path', { d: 'M9 18h6' });
        const line2 = DOMUtils.createSvg('path', { d: 'M10 22h4' });
        svg.appendChild(path);
        svg.appendChild(line1);
        svg.appendChild(line2);

        if (!isOn) {
            const slash = DOMUtils.createSvg('line', {
                x1: '3',
                y1: '3',
                x2: '21',
                y2: '21',
                stroke: 'currentColor',
                'stroke-width': '2',
                'stroke-linecap': 'round'
            });
            svg.appendChild(slash);
        }

        return svg;
    }

    /**
     * Deprecated battery icon generator stub that returns a lightbulb icon.
     * Maintained for backward-compatibility while migrating to lightbulb indicators.
     * @param {*} [level] Ignored level.
     * @param {string} [className] CSS class name.
     * @returns {SVGElement} Lightbulb SVG element.
     */
    static createBatteryIcon(level = true, className = 'thinking-lamp-icon') {
        const isOn = (typeof level === 'boolean') ? level : (level !== 'off' && level !== 'none' && level !== 0);
        return DOMUtils.createLightbulbIcon(isOn, className);
    }

    /**
     * Creates a standard Gauge / Sliders SVG element for Reasoning Effort controls.
     * @param {string} [className] Optional CSS class name.
     * @returns {SVGElement} The created SVG element.
     */
    static createGaugeIcon(className = '') {
        const svg = DOMUtils.createSvg('svg', {
            class: className,
            width: '13',
            height: '13',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        });
        const line1 = DOMUtils.createSvg('line', { x1: '4', y1: '21', x2: '4', y2: '14' });
        const line2 = DOMUtils.createSvg('line', { x1: '4', y1: '10', x2: '4', y2: '3' });
        const line3 = DOMUtils.createSvg('line', { x1: '12', y1: '21', x2: '12', y2: '12' });
        const line4 = DOMUtils.createSvg('line', { x1: '12', y1: '8', x2: '12', y2: '3' });
        const line5 = DOMUtils.createSvg('line', { x1: '20', y1: '21', x2: '20', y2: '16' });
        const line6 = DOMUtils.createSvg('line', { x1: '20', y1: '12', x2: '20', y2: '3' });
        const line7 = DOMUtils.createSvg('line', { x1: '1', y1: '14', x2: '7', y2: '14' });
        const line8 = DOMUtils.createSvg('line', { x1: '9', y1: '8', x2: '15', y2: '8' });
        const line9 = DOMUtils.createSvg('line', { x1: '17', y1: '16', x2: '23', y2: '16' });
        svg.appendChild(line1);
        svg.appendChild(line2);
        svg.appendChild(line3);
        svg.appendChild(line4);
        svg.appendChild(line5);
        svg.appendChild(line6);
        svg.appendChild(line7);
        svg.appendChild(line8);
        svg.appendChild(line9);
        return svg;
    }

    /**
     * Creates a debounced function that delays invocation until after wait milliseconds.
     * @param {Function} func The target function to debounce.
     * @param {number} wait Delay in milliseconds.
     * @returns {Function} Debounced function.
     */
    static debounce(func, wait = 250) {
        let timeout = null;
        return function (...args) {
            const context = this;
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                timeout = null;
                func.apply(context, args);
            }, wait);
        };
    }

    /**
     * Creates a throttled function that limits invocation to at most once per wait window.
     * @param {Function} func The target function to throttle.
     * @param {number} limit Window size in milliseconds.
     * @returns {Function} Throttled function.
     */
    static throttle(func, limit = 50) {
        let inThrottle = false;
        let lastArgs = null;
        let lastContext = null;
        return function (...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                    if (lastArgs) {
                        func.apply(lastContext, lastArgs);
                        lastArgs = null;
                        lastContext = null;
                    }
                }, limit);
            } else {
                lastArgs = args;
                lastContext = this;
            }
        };
    }

    /**
     * Batches execution of a callback using requestAnimationFrame to eliminate layout thrashing.
     * @param {Function} callback Function to execute on next animation frame.
     * @returns {Function} Wrapped batched trigger function.
     */
    static rafBatch(callback) {
        let rafId = null;
        return function (...args) {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                callback.apply(this, args);
            });
        };
    }

    /**
     * Escapes unsafe HTML characters in a string to prevent XSS vulnerabilities.
     * @param {string} text Raw string input.
     * @returns {string} Escaped safe HTML string.
     */
    static escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
