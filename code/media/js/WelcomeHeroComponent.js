/**
 * WelcomeHeroComponent encapsulates rendering of the welcome hero greeting
 * and quick-action prompt starter pills for empty chat sessions.
 */
class WelcomeHeroComponent {
    /**
     * Renders welcome hero element into the target container.
     * @param {HTMLElement} container Parent chat container.
     * @param {object} [options] Customization options and click callbacks.
     * @param {boolean} [options.isExtension] Whether rendering in VS Code extension context.
     * @param {Function} [options.onPromptClick] Callback when a starter prompt pill is clicked.
     * @param {Function} [options.onHelpClick] Callback when help shortcut is clicked.
     * @returns {HTMLElement} The created welcome hero DOM element.
     */
    static render(container, options = {}) {
        if (!container) return null;

        const oldHero = container.querySelector('.welcome-hero');
        if (oldHero) oldHero.remove();

        const hero = document.createElement('div');
        hero.className = 'welcome-hero';

        const i18n = (typeof window !== 'undefined' && window.KAI_I18N) || {};
        const title = i18n.welcomeTitle || 'How can Kai help you today?';
        const subtitle = options.isExtension
            ? (i18n.welcomeSubtitleExt || 'Ask questions about your codebase, edit code, or generate plans.')
            : (i18n.welcomeSubtitleApp || 'Chat freely, calculate, convert, search the web, or manage project tasks.');

        /**
         * Renders the welcome hero banner with standalone SVG avatar and prompt starter pills.
         * Appends the hero node into the chat container and binds starter click callbacks.
         */
        hero.innerHTML = `
            <div class="welcome-hero-header">
                <div class="welcome-hero-avatar">
                    ${DOMUtils.icon('get_time', 28)}
                </div>
                <h2 class="welcome-hero-title">${title}</h2>
                <p class="welcome-hero-subtitle">${subtitle}</p>
            </div>
            <div class="welcome-hero-starters">
                ${options.isExtension ? `
                    <button type="button" class="starter-pill" data-prompt="Explain this workspace architecture and main entry points.">Explain Architecture</button>
                    <button type="button" class="starter-pill" data-prompt="Find potential bugs or optimizations in this codebase.">Find Optimizations</button>
                    <button type="button" class="starter-pill" data-prompt="Create an implementation plan for adding a new feature.">Create Plan</button>
                ` : `
                    <button type="button" class="starter-pill" data-prompt="What can you do? Show me your capabilities.">Explore Capabilities</button>
                    <button type="button" class="starter-pill" data-prompt="Calculate 25% tip on a $120 dinner bill.">Fast Calculation</button>
                    <button type="button" class="starter-pill" data-prompt="Search the web for the latest TypeScript 5.5 release highlights.">Web Search</button>
                `}
            </div>
        `;

        if (typeof options.onPromptClick === 'function') {
            hero.querySelectorAll('.starter-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    options.onPromptClick(btn.dataset.prompt);
                });
            });
        }

        container.appendChild(hero);
        return hero;
    }

    /**
     * Removes the welcome hero from the container if present.
     * @param {HTMLElement} container Parent container.
     */
    static remove(container) {
        if (!container) return;
        const hero = container.querySelector('.welcome-hero');
        if (hero) hero.remove();
    }
}
