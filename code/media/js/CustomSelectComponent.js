/**
 * CustomSelectComponent provides a customizable, accessible dropdown UI component
 * matching the visual style, hover effects, and checkmark indicators of Kai-Agent dropdowns.
 */
class CustomSelectComponent {
    /**
     * Initializes the custom select component instance.
     * @param {object} config Configuration options.
     * @param {HTMLElement|string} config.container Parent element or selector string to append to.
     * @param {string} [config.id] Identifier attribute for the component element.
     * @param {Array<{value: string, label: string}>} [config.options=[]] Selectable option items.
     * @param {string} [config.value] Initially selected value.
     * @param {Function} [config.onChange] Callback executed when selection changes.
     */
    constructor({ container, id = '', options = [], value = '', onChange = null } = {}) {
        this.container = typeof container === 'string' ? document.querySelector(container) : container;
        this.id = id;
        this.options = options;
        this.value = value || (options[0] ? options[0].value : '');
        this.onChange = onChange;
        this.isOpen = false;

        this.element = null;
        this.triggerBtn = null;
        this.labelSpan = null;
        this.menuEl = null;

        this.handleOutsideClick = this.handleOutsideClick.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.render();
    }

    /**
     * Updates fixed popup menu positioning based on trigger button bounding rectangle.
     * Positions popup aligned with trigger button while respecting viewport boundaries.
     */
    updatePosition() {
        if (!this.isOpen || !this.triggerBtn || !this.menuEl) return;
        const rect = this.triggerBtn.getBoundingClientRect();
        this.menuEl.style.position = 'fixed';
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < 180 && rect.top > 180) {
            this.menuEl.style.top = 'auto';
            this.menuEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        } else {
            this.menuEl.style.top = `${rect.bottom + 4}px`;
            this.menuEl.style.bottom = 'auto';
        }
        this.menuEl.style.left = `${rect.left}px`;
        this.menuEl.style.width = `${rect.width}px`;
        this.menuEl.style.zIndex = '99999';
    }

    /**
     * Opens the dropdown options popup menu.
     */
    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.element.classList.add('open');
        this.updatePosition();
        this.menuEl.classList.remove('hidden');
        this.triggerBtn.setAttribute('aria-expanded', 'true');
        this.triggerBtn.classList.add('active');
        window.addEventListener('scroll', this.handleScroll, true);
        window.addEventListener('resize', this.handleScroll, true);
    }

    /**
     * Closes the dropdown options popup menu.
     */
    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.element.classList.remove('open');
        this.menuEl.classList.add('hidden');
        this.triggerBtn.setAttribute('aria-expanded', 'false');
        this.triggerBtn.classList.remove('active');
        window.removeEventListener('scroll', this.handleScroll, true);
        window.removeEventListener('resize', this.handleScroll, true);
    }

    /**
     * Scroll event handler to close popup on outer container scroll,
     * while allowing scrolling inside the dropdown menu itself.
     * @param {Event} [e] Scroll event.
     */
    handleScroll(e) {
        if (this.isOpen) {
            if (e && e.target && this.menuEl && (this.menuEl === e.target || this.menuEl.contains(e.target))) {
                return;
            }
            this.close();
        }
    }

    /**
     * Renders the custom select DOM structure and attaches event listeners.
     */
    render() {
        if (!this.container) return;

        this.element = document.createElement('div');
        this.element.className = 'custom-select-container';
        if (this.id) {
            this.element.id = this.id;
        }

        // Trigger Button
        this.triggerBtn = document.createElement('button');
        this.triggerBtn.type = 'button';
        this.triggerBtn.className = 'custom-select-trigger';
        this.triggerBtn.setAttribute('aria-expanded', 'false');
        this.triggerBtn.setAttribute('aria-haspopup', 'listbox');

        this.labelSpan = document.createElement('span');
        this.labelSpan.className = 'custom-select-label';
        this.triggerBtn.appendChild(this.labelSpan);

        const chevronIcon = DOMUtils.createChevronIcon('custom-select-chevron');
        this.triggerBtn.appendChild(chevronIcon);

        // Menu Popup Container
        this.menuEl = document.createElement('div');
        this.menuEl.className = 'custom-select-menu hidden';
        this.menuEl.setAttribute('role', 'listbox');

        this.updateOptionsList();
        this.updateTriggerText();

        this.triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        this.triggerBtn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.open();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });

        this.element.appendChild(this.triggerBtn);
        this.element.appendChild(this.menuEl);

        this.container.innerHTML = '';
        this.container.appendChild(this.element);

        document.addEventListener('click', this.handleOutsideClick);
    }

    /**
     * Updates option item elements inside the popup menu.
     */
    updateOptionsList() {
        if (!this.menuEl) return;
        this.menuEl.innerHTML = '';

        this.options.forEach((opt) => {
            const isSelected = opt.value === this.value;
            const itemBtn = document.createElement('button');
            itemBtn.type = 'button';
            itemBtn.className = `dropdown-item custom-select-option ${isSelected ? 'selected' : ''}`;
            itemBtn.setAttribute('role', 'option');
            itemBtn.setAttribute('aria-selected', isSelected ? 'true' : 'false');

            const itemLabel = document.createElement('span');
            itemLabel.textContent = opt.label;
            itemBtn.appendChild(itemLabel);

            if (isSelected) {
                const checkIcon = DOMUtils.createCheckIcon('check-icon');
                itemBtn.appendChild(checkIcon);
            }

            itemBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setValue(opt.value);
                this.close();
            });

            this.menuEl.appendChild(itemBtn);
        });
    }

    /**
     * Updates label text of trigger button to match selected value.
     */
    updateTriggerText() {
        const selectedOpt = this.options.find((o) => o.value === this.value);
        if (this.labelSpan) {
            this.labelSpan.textContent = selectedOpt ? selectedOpt.label : this.value;
        }
    }

    /**
     * Toggles open/closed state of the dropdown menu.
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Sets the active selected value and notifies listener callback if value changed.
     * @param {string} val New selected value string.
     */
    setValue(val) {
        if (this.value === val) return;
        this.value = val;
        this.updateTriggerText();
        this.updateOptionsList();
        if (typeof this.onChange === 'function') {
            this.onChange(this.value);
        }
    }

    /**
     * Updates the options list and re-renders the options menu and trigger label.
     * @param {Array<{value: string, label: string}>} newOptions Updated options array.
     */
    setOptions(newOptions) {
        if (!Array.isArray(newOptions)) return;
        this.options = newOptions;
        this.updateTriggerText();
        this.updateOptionsList();
    }

    /**
     * Retrieves current selected value string.
     * @returns {string} Selected option value.
     */
    getValue() {
        return this.value;
    }

    /**
     * Outside click event handler to close open dropdown popup.
     * @param {MouseEvent} e Mouse click event.
     */
    handleOutsideClick(e) {
        if (this.isOpen && this.element && !this.element.contains(e.target) && !this.menuEl.contains(e.target)) {
            this.close();
        }
    }

    /**
     * Cleans up event listeners when component is destroyed.
     */
    destroy() {
        document.removeEventListener('click', this.handleOutsideClick);
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}
