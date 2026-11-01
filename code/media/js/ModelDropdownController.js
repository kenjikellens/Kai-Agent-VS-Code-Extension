/**
 * ModelDropdownController manages model status dots, provider accordions,
 * active model selection state, and integrated flyout settings submenus in the dropdown menu.
 * 
 * ARCHITECTURAL DESIGN:
 * - MODEL SELECTOR DROPDOWN: The primary dropdown menu (#dropdown-options-menu) where users
 *   choose which AI Provider and Model to interact with (LM Studio, Gemini, Mistral, etc.).
 * - THINKING / REASONING FLYOUT MENU: The integrated sub-dropdown (.thinking-flyout-menu) attached
 *   directly to capable models for configuring thinking toggle and reasoning effort levels without icons.
 */
class ModelDropdownController {
    /**
     * Initializes DOM references, initial dropdown values, and listeners.
     * @param {MarkdownFormatter} formatter Formatter instance.
     * @param {Function} onSelect Callback when a model selection changes in the Model Selector Dropdown.
     * @param {WebviewIPCBridge} [ipcBridge] Webview IPC bridge instance for triggering model loads.
     */
    constructor(formatter, onSelect, ipcBridge = null) {
        this.formatter = formatter;
        this.onSelect = onSelect;
        this.ipcBridge = ipcBridge;
        this.selectedModelValue = localStorage.getItem('kai.selectedModel') || 'local-model';
        this.accordionStates = {};
        this.freeProvidersConfig = [...KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS];
        this.lmStudioRawModels = [];
        this.activeFlyoutItem = null;
        this.flyoutCloseTimer = null;

        this.dropdownTriggerBtn = document.getElementById('dropdown-trigger-btn');
        this.dropdownOptionsMenu = document.getElementById('dropdown-options-menu');
        this.selectedModelText = document.getElementById('selected-model-text');
        this.statusDot = document.getElementById('status-dot');

        if (this.selectedModelText && this.selectedModelValue && this.selectedModelValue !== 'local-model') {
            ThinkingStateFormatter.renderTriggerLabel({
                modelId: this.selectedModelValue,
                container: this.selectedModelText,
                formatter: this.formatter
            });
        }

        this.initEventListeners();
        this.initDefaultDropdown();

        window.addEventListener('resize', () => this.updateTextOverflowMetrics());
        setTimeout(() => this.updateTextOverflowMetrics(), 50);
    }

    /**
     * Checks text overflow for all .model-text-container elements and calculates
     * the exact scroll distance and speed duration needed for the ping-pong hover loop.
     */
    updateTextOverflowMetrics() {
        const containers = document.querySelectorAll('.model-text-container');

        containers.forEach(container => {
            const innerSpan = container.querySelector('.model-text-inner');
            if (!innerSpan) return;

            innerSpan.style.flexShrink = '0';

            const containerWidth = container.clientWidth;
            const contentWidth = innerSpan.scrollWidth;
            const overflowAmount = contentWidth - containerWidth;

            if (overflowAmount > 2) {
                container.classList.add('has-overflow');
                const targetOffset = -(overflowAmount + 8);
                const basePauseTime = 1.2;
                const travelSpeed = 22;
                const travelTime = (2 * Math.abs(targetOffset)) / travelSpeed;
                const duration = Math.min(24, Math.max(4.5, basePauseTime + travelTime)).toFixed(2);

                container.style.setProperty('--scroll-offset', `${targetOffset}px`);
                container.style.setProperty('--scroll-duration', `${duration}s`);
            } else {
                container.classList.remove('has-overflow');
                container.style.removeProperty('--scroll-offset');
                container.style.removeProperty('--scroll-duration');
            }
        });
    }

    /**
     * Closes any currently open thinking flyout sub-menu immediately with 0ms delay.
     */
    closeActiveFlyoutImmediately() {
        if (this.flyoutCloseTimer) {
            clearTimeout(this.flyoutCloseTimer);
            this.flyoutCloseTimer = null;
        }
        if (this.activeFlyoutItem) {
            this.activeFlyoutItem.classList.remove('flyout-open');
            this.activeFlyoutItem = null;
        }
        const openFlyouts = document.querySelectorAll('.model-hover-item.flyout-open');
        openFlyouts.forEach(el => el.classList.remove('flyout-open'));
        if (document.activeElement && document.activeElement.closest('.thinking-flyout-menu')) {
            document.activeElement.blur();
        }
    }

    /**
     * Registers dropdown trigger and global click-outside listeners for the Model Selector Dropdown.
     * Manages mutual exclusion and dismissal of open menus and flyouts.
     */
    initEventListeners() {
        if (this.dropdownTriggerBtn) {
            this.dropdownTriggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeActiveFlyoutImmediately();
                if (this.dropdownOptionsMenu) {
                    this.dropdownOptionsMenu.classList.toggle('hidden');
                }
            });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#model-dropdown-container') && this.dropdownOptionsMenu) {
                this.closeActiveFlyoutImmediately();
                this.dropdownOptionsMenu.classList.add('hidden');
            }
        });

        // Global mouseover delegation listener to calculate overflow & trigger ping-pong scroll instantly on hover
        document.addEventListener('mouseover', (e) => {
            const targetContainer = e.target.closest('.model-text-container') || e.target.closest('.dropdown-trigger') || e.target.closest('.dropdown-item');
            if (!targetContainer) return;

            const container = targetContainer.classList.contains('model-text-container') ? targetContainer : targetContainer.querySelector('.model-text-container');
            if (!container) return;

            const innerSpan = container.querySelector('.model-text-inner');
            if (!innerSpan) return;

            innerSpan.style.flexShrink = '0';
            const containerWidth = container.clientWidth;
            const contentWidth = innerSpan.scrollWidth;
            const overflowAmount = contentWidth - containerWidth;

            if (overflowAmount > 2) {
                container.classList.add('has-overflow');
                const targetOffset = -(overflowAmount + 8);
                const basePauseTime = 1.2;
                const travelSpeed = 22;
                const travelTime = (2 * Math.abs(targetOffset)) / travelSpeed;
                const duration = Math.min(24, Math.max(4.5, basePauseTime + travelTime)).toFixed(2);

                container.style.setProperty('--scroll-offset', `${targetOffset}px`);
                container.style.setProperty('--scroll-duration', `${duration}s`);
            } else {
                container.classList.remove('has-overflow');
            }
        }, true);
    }

    /**
     * Creates and appends an accordion category group to the Model Selector Dropdown menu.
     * Each model option is rendered as an interactive button element with a status dot.
     * 
     * @param {string} title Category title string.
     * @param {Array<string>} modelsList List of model IDs under this category.
     * @param {boolean} isInitiallyExpanded Initial expansion state.
     * @param {Function|null} isModelConnectedFn Optional model connection check callback.
     * @param {boolean} isLMStudioCategory Whether this is the local LM Studio model category.
     */
    createAccordionGroup(title, modelsList, isInitiallyExpanded, isModelConnectedFn = null, isLMStudioCategory = false) {
        if (!this.dropdownOptionsMenu) return;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'dropdown-category';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'category-header-btn dropdown-category-header';
        headerDiv.setAttribute('role', 'button');
        headerDiv.setAttribute('tabindex', '0');
        headerDiv.setAttribute('aria-label', `Toggle category ${title}`);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'category-title';
        titleSpan.textContent = title;
        headerDiv.appendChild(titleSpan);

        const chevronSvg = DOMUtils.createChevronIcon('category-chevron chevron-icon');
        headerDiv.appendChild(chevronSvg);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'dropdown-category-content';

        let isExpanded = this.accordionStates[title];
        if (isExpanded === undefined || isExpanded === null) {
            isExpanded = isInitiallyExpanded !== undefined ? isInitiallyExpanded : true;
            this.accordionStates[title] = isExpanded;
        }

        if (!isExpanded) {
            contentDiv.classList.add('collapsed');
            chevronSvg.style.transform = 'rotate(-90deg)';
        } else {
            contentDiv.classList.remove('collapsed');
            chevronSvg.style.transform = 'rotate(0deg)';
        }

        const toggleAccordion = (e) => {
            e.stopPropagation();
            this.closeActiveFlyoutImmediately();
            const isCollapsed = contentDiv.classList.toggle('collapsed');
            chevronSvg.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
            this.accordionStates[title] = !isCollapsed;
        };

        headerDiv.addEventListener('click', toggleAccordion);
        headerDiv.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAccordion(e);
            }
        });

        if (modelsList.length === 0) {
            const i18n = window.KAI_I18N || {};
            const placeholder = document.createElement('div');
            placeholder.className = 'dropdown-item-placeholder';
            placeholder.textContent = title.includes('LM Studio') ? (i18n.lmStudioOffline || 'LM Studio is offline') : (title.includes('Gemini') ? 'Add API key in settings' : 'No Models Available');
            contentDiv.appendChild(placeholder);
        } else {
            const displayItems = [];
            modelsList.forEach(m => {
                let cleanVal = m;
                if (cleanVal.endsWith(' (thinking)')) {
                    cleanVal = cleanVal.slice(0, -11);
                }
                if (!displayItems.some(i => i.value === cleanVal)) {
                    displayItems.push({ value: cleanVal, label: this.formatter.formatModelName(cleanVal), rawModel: cleanVal, thinking: false });
                }
            });

            if (isLMStudioCategory) {
                let currentSortKey = localStorage.getItem('kai.lmStudioSortKey') || 'recent';
                let currentSortDir = localStorage.getItem('kai.lmStudioSortDir') || (currentSortKey === 'name' ? 'asc' : 'desc');

                const sortBarDiv = document.createElement('div');
                sortBarDiv.className = 'lmstudio-sort-bar';

                const itemsContainer = document.createElement('div');
                itemsContainer.className = 'lmstudio-items-container';

                const renderLMStudioItems = () => {
                    sortBarDiv.innerHTML = '';
                    itemsContainer.innerHTML = '';

                    // 1. Recent Chip (Always newest first)
                    const btnRecent = document.createElement('button');
                    btnRecent.type = 'button';
                    btnRecent.className = `btn btn--sort ${currentSortKey === 'recent' ? 'active' : ''}`;
                    btnRecent.textContent = 'Recent';
                    btnRecent.title = 'Sorteer op nieuwste download';
                    btnRecent.addEventListener('click', (e) => {
                        e.stopPropagation();
                        currentSortKey = 'recent';
                        currentSortDir = 'desc';
                        localStorage.setItem('kai.lmStudioSortKey', 'recent');
                        localStorage.setItem('kai.lmStudioSortDir', 'desc');
                        renderLMStudioItems();
                    });
                    sortBarDiv.appendChild(btnRecent);

                    // 2. Name Chip (Toggle Asc/Desc)
                    const btnName = document.createElement('button');
                    btnName.type = 'button';
                    btnName.className = `btn btn--sort ${currentSortKey === 'name' ? 'active' : ''}`;
                    const nameArrow = currentSortKey === 'name' ? (currentSortDir === 'asc' ? ' ↑' : ' ↓') : '';
                    btnName.textContent = `Naam${nameArrow}`;
                    btnName.title = 'Sorteer alfabetisch op naam';
                    btnName.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (currentSortKey === 'name') {
                            currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
                        } else {
                            currentSortKey = 'name';
                            currentSortDir = 'asc';
                        }
                        localStorage.setItem('kai.lmStudioSortKey', 'name');
                        localStorage.setItem('kai.lmStudioSortDir', currentSortDir);
                        renderLMStudioItems();
                    });
                    sortBarDiv.appendChild(btnName);

                    // 3. Size Chip (Toggle Asc/Desc)
                    const btnSize = document.createElement('button');
                    btnSize.type = 'button';
                    btnSize.className = `btn btn--sort ${currentSortKey === 'size' ? 'active' : ''}`;
                    const sizeArrow = currentSortKey === 'size' ? (currentSortDir === 'desc' ? ' ↓' : ' ↑') : '';
                    btnSize.textContent = `Grootte${sizeArrow}`;
                    btnSize.title = 'Sorteer op bestandsgrootte';
                    btnSize.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (currentSortKey === 'size') {
                            currentSortDir = currentSortDir === 'desc' ? 'asc' : 'desc';
                        } else {
                            currentSortKey = 'size';
                            currentSortDir = 'desc';
                        }
                        localStorage.setItem('kai.lmStudioSortKey', 'size');
                        localStorage.setItem('kai.lmStudioSortDir', currentSortDir);
                        renderLMStudioItems();
                    });
                    sortBarDiv.appendChild(btnSize);

                    // Sort items dynamically using native manifest metadata from cache
                    const capsMap = ThinkingStateFormatter.lmStudioCapabilities || {};
                    const sorted = [...displayItems].sort((a, b) => {
                        const lowA = String(a.rawModel || '').toLowerCase();
                        const baseA = lowA.split('/').pop() || '';
                        const capA = capsMap[a.rawModel] || capsMap[lowA] || capsMap[baseA] || {};

                        const lowB = String(b.rawModel || '').toLowerCase();
                        const baseB = lowB.split('/').pop() || '';
                        const capB = capsMap[b.rawModel] || capsMap[lowB] || capsMap[baseB] || {};

                        if (currentSortKey === 'recent') {
                            const timeA = capA.mtime || 0;
                            const timeB = capB.mtime || 0;
                            return timeB - timeA;
                        } else if (currentSortKey === 'name') {
                            const comp = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
                            return currentSortDir === 'asc' ? comp : -comp;
                        } else if (currentSortKey === 'size') {
                            const sizeA = capA.sizeBytes || 0;
                            const sizeB = capB.sizeBytes || 0;
                            return currentSortDir === 'desc' ? sizeB - sizeA : sizeA - sizeB;
                        }
                        return 0;
                    });

                    sorted.forEach(itemData => {
                        this.renderModelItem(itemData, isModelConnectedFn, itemsContainer, true);
                    });

                    this.updateTextOverflowMetrics();
                };

                contentDiv.appendChild(sortBarDiv);
                contentDiv.appendChild(itemsContainer);
                renderLMStudioItems();
            } else {
                displayItems.forEach(itemData => {
                    this.renderModelItem(itemData, isModelConnectedFn, contentDiv, false);
                });
            }
        }

        groupDiv.appendChild(headerDiv);
        groupDiv.appendChild(contentDiv);
        this.dropdownOptionsMenu.appendChild(groupDiv);

        this.updateTextOverflowMetrics();
    }

    /**
     * Renders an individual model option button and its optional integrated flyout submenu.
     * @param {object} itemData Object containing value, label, rawModel, and thinking.
     * @param {Function|null} isModelConnectedFn Model connection check callback.
     * @param {HTMLElement} targetContainer Parent container to append the model item into.
     * @param {boolean} isLMStudio Whether this model belongs to LM Studio.
     */
    renderModelItem(itemData, isModelConnectedFn, targetContainer, isLMStudio = false) {
        const caps = ThinkingStateFormatter.getCapabilitiesState(itemData.rawModel);
        const hasFlyout = caps.hasThinkingToggle || (caps.hasReasoningEffort && Array.isArray(caps.effortOptions) && caps.effortOptions.length > 0);
        console.log('[KAI Dropdown] renderModelItem:', itemData.rawModel, '→ hasFlyout:', hasFlyout, 'caps:', caps);

        const item = document.createElement('div');
        item.className = 'dropdown-item';
        if (hasFlyout) {
            item.classList.add('model-hover-item');
        }
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', `Select model ${itemData.label}`);

        if (itemData.value === this.selectedModelValue) {
            item.classList.add('selected');
        }
        item.dataset.value = itemData.value;
        const isLoaded = isModelConnectedFn ? isModelConnectedFn(itemData.rawModel) : false;
        const dotClass = isLoaded ? 'status-connected' : 'status-disconnected';

        const statusDotSpan = document.createElement('span');
        statusDotSpan.className = `status-dot ${dotClass}`;
        const capsMap = ThinkingStateFormatter.lmStudioCapabilities || {};
        const low = String(itemData.rawModel || '').toLowerCase();
        const base = low.split('/').pop() || '';
        const rawCap = capsMap[itemData.rawModel] || capsMap[low] || capsMap[base] || {};
        if (rawCap.sizeBytes && rawCap.sizeBytes > 0) {
            const sizeGb = (rawCap.sizeBytes / (1024 * 1024 * 1024)).toFixed(1);
            item.title = `${itemData.label} (${sizeGb} GB)`;
        }

        const textContainer = document.createElement('div');
        textContainer.className = 'model-text-container';

        const textSpan = document.createElement('span');
        textSpan.className = 'model-text-inner dropdown-item-text';
        textSpan.textContent = itemData.label;

        textContainer.appendChild(textSpan);
        item.appendChild(statusDotSpan);
        item.appendChild(textContainer);

        if (hasFlyout) {
            const flyoutChevron = document.createElement('span');
            flyoutChevron.className = 'model-flyout-chevron';
            flyoutChevron.textContent = '›';
            item.appendChild(flyoutChevron);

            // Build integrated flyout submenu (no icons)
            const flyoutMenu = document.createElement('div');
            flyoutMenu.className = 'thinking-flyout-menu';

            const flyoutInner = document.createElement('div');
            flyoutInner.className = 'thinking-flyout-menu-inner';

            const rawModel = itemData.rawModel;

            // 1. Thinking Toggle Switch (Boolean soft-coded)
            if (caps.hasThinkingToggle) {
                const toggleRow = document.createElement('div');
                toggleRow.className = 'toggle-switch-row';
                toggleRow.setAttribute('role', 'button');
                toggleRow.setAttribute('tabindex', '0');
                toggleRow.setAttribute('aria-label', `Toggle thinking ${caps.isThinkingOn ? 'off' : 'on'}`);

                const toggleLabel = document.createElement('span');
                toggleLabel.className = 'toggle-label';
                toggleLabel.textContent = 'Thinking';
                toggleRow.appendChild(toggleLabel);

                const switchPill = document.createElement('div');
                switchPill.className = `switch-pill ${caps.isThinkingOn ? 'active' : ''}`;
                const switchHandle = document.createElement('div');
                switchHandle.className = 'switch-handle';
                switchPill.appendChild(switchHandle);
                toggleRow.appendChild(switchPill);

                const handleToggleClick = (e) => {
                    e.stopPropagation();
                    const newState = !switchPill.classList.contains('active');
                    console.log('[KAI Dropdown] Toggle thinking:', rawModel, '→', newState);
                    if (newState) {
                        switchPill.classList.add('active');
                    } else {
                        switchPill.classList.remove('active');
                    }

                    localStorage.setItem(`kai.lmStudioThinking.${rawModel}`, newState ? 'true' : 'false');
                    localStorage.setItem(`kai.mistralThinking.${rawModel}`, newState ? 'true' : 'false');
                    localStorage.setItem(`kai.openrouterThinking.${rawModel}`, newState ? 'true' : 'false');
                    if (rawModel.includes('/')) {
                        const short = rawModel.split('/').pop();
                        localStorage.setItem(`kai.lmStudioThinking.${short}`, newState ? 'true' : 'false');
                    }
                    caps.isThinkingOn = newState;

                    this.selectedModelValue = itemData.value;
                    localStorage.setItem('kai.selectedModel', itemData.value);
                    this.setSelectedModel(itemData.value);

                    if (this.statusDot) {
                        this.statusDot.className = (isModelConnectedFn && isModelConnectedFn(itemData.rawModel)) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                    }

                    if (this.onSelect) {
                        this.onSelect(itemData.value);
                    }
                };

                toggleRow.addEventListener('click', handleToggleClick);
                toggleRow.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggleClick(e);
                    }
                });

                flyoutInner.appendChild(toggleRow);
            }

            // 2. Reasoning Effort Radio Options (Select soft-coded)
            if (caps.hasReasoningEffort && Array.isArray(caps.effortOptions) && caps.effortOptions.length > 0) {
                caps.effortOptions.forEach(opt => {
                    const isSelected = caps.reasoningLevel === opt.value;
                    const optItem = document.createElement('div');
                    optItem.className = `flyout-option ${isSelected ? 'selected' : ''}`;
                    optItem.setAttribute('role', 'radio');
                    optItem.setAttribute('aria-checked', isSelected ? 'true' : 'false');
                    optItem.setAttribute('tabindex', '0');

                    const optLabel = document.createElement('span');
                    optLabel.textContent = opt.label;
                    optItem.appendChild(optLabel);

                    const checkmark = document.createElement('span');
                    checkmark.className = 'check-icon';
                    checkmark.textContent = isSelected ? '✓' : '';
                    optItem.appendChild(checkmark);

                    const handleEffortSelect = (e) => {
                        e.stopPropagation();
                        console.log('[KAI Dropdown] Effort selected:', rawModel, '→', opt.value);
                        localStorage.setItem(`kai.lmStudioReasoningEffort.${rawModel}`, opt.value);
                        localStorage.setItem(`kai.mistralReasoningEffort.${rawModel}`, opt.value);
                        localStorage.setItem(`kai.openrouterReasoningEffort.${rawModel}`, opt.value);
                        localStorage.setItem(`kai.geminiThinkingLevel.${rawModel}`, opt.value);
                        if (rawModel.includes('/')) {
                            const short = rawModel.split('/').pop();
                            localStorage.setItem(`kai.lmStudioReasoningEffort.${short}`, opt.value);
                            localStorage.setItem(`kai.openrouterReasoningEffort.${short}`, opt.value);
                        }
                        caps.reasoningLevel = opt.value;

                        flyoutInner.querySelectorAll('.flyout-option').forEach(el => {
                            el.classList.remove('selected');
                            el.setAttribute('aria-checked', 'false');
                            const chk = el.querySelector('.check-icon');
                            if (chk) chk.textContent = '';
                        });

                        optItem.classList.add('selected');
                        optItem.setAttribute('aria-checked', 'true');
                        checkmark.textContent = '✓';

                        this.selectedModelValue = itemData.value;
                        localStorage.setItem('kai.selectedModel', itemData.value);
                        this.setSelectedModel(itemData.value);

                        if (this.statusDot) {
                            this.statusDot.className = (isModelConnectedFn && isModelConnectedFn(itemData.rawModel)) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                        }

                        if (this.onSelect) {
                            this.onSelect(itemData.value);
                        }
                    };

                    optItem.addEventListener('click', handleEffortSelect);
                    optItem.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleEffortSelect(e);
                        }
                    });

                    flyoutInner.appendChild(optItem);
                });
            }

            flyoutMenu.appendChild(flyoutInner);
            item.appendChild(flyoutMenu);

            // Dynamic positioning and hover handlers
            const openFlyout = () => {
                if (this.flyoutCloseTimer) {
                    clearTimeout(this.flyoutCloseTimer);
                    this.flyoutCloseTimer = null;
                }
                if (this.activeFlyoutItem && this.activeFlyoutItem !== item) {
                    this.activeFlyoutItem.classList.remove('flyout-open');
                }
                item.classList.add('flyout-open');
                this.activeFlyoutItem = item;

                const rect = item.getBoundingClientRect();
                flyoutMenu.style.position = 'fixed';
                flyoutMenu.style.top = `${rect.top}px`;

                const flyoutWidth = flyoutMenu.offsetWidth || 160;
                let leftPos = rect.right + 4;
                if (leftPos + flyoutWidth > window.innerWidth - 6) {
                    const leftCandidate = rect.left - flyoutWidth - 4;
                    if (leftCandidate >= 6) {
                        leftPos = leftCandidate;
                    } else {
                        leftPos = Math.max(6, window.innerWidth - flyoutWidth - 6);
                    }
                }
                flyoutMenu.style.left = `${leftPos}px`;
            };

            const scheduleCloseFlyout = () => {
                this.flyoutCloseTimer = setTimeout(() => {
                    if (this.activeFlyoutItem === item) {
                        item.classList.remove('flyout-open');
                        this.activeFlyoutItem = null;
                    }
                }, 150);
            };

            item.addEventListener('mouseenter', openFlyout);
            item.addEventListener('mouseleave', scheduleCloseFlyout);
            flyoutMenu.addEventListener('mouseenter', () => {
                if (this.flyoutCloseTimer) {
                    clearTimeout(this.flyoutCloseTimer);
                    this.flyoutCloseTimer = null;
                }
            });
            flyoutMenu.addEventListener('mouseleave', scheduleCloseFlyout);
        }

        // Base Model Item Click
        const handleItemClick = (e) => {
            if (e.target.closest('.thinking-flyout-menu')) return;
            e.stopPropagation();
            this.selectedModelValue = itemData.value;
            localStorage.setItem('kai.selectedModel', itemData.value);

            this.setSelectedModel(itemData.value);

            if (this.statusDot) {
                this.statusDot.className = (isModelConnectedFn && isModelConnectedFn(itemData.rawModel)) ? 'status-dot status-connected' : 'status-dot status-disconnected';
            }
            this.closeActiveFlyoutImmediately();
            this.dropdownOptionsMenu.classList.add('hidden');

            if (this.onSelect) {
                this.onSelect(itemData.value);
            }
        };

        item.addEventListener('click', handleItemClick);
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleItemClick(e);
            }
        });

        targetContainer.appendChild(item);
    }

    /**
     * Populates all providers and models with status dots indicating configuration / load state.
     */
    initDefaultDropdown() {
        if (!this.dropdownOptionsMenu) return;
        this.dropdownOptionsMenu.innerHTML = '';

        const defaultGemini = KAI_CONSTANTS.DEFAULT_GEMINI_MODELS || [];
        const defaultProviders = KAI_CONSTANTS.DEFAULT_PROVIDERS_WITH_MODELS || [];
        const freeProviders = KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS || [];

        const isModelConnected = (m) => {
            if (!m) return false;
            const bare = m.endsWith(' (thinking)') ? m.slice(0, -11) : m;
            const lowerM = bare.toLowerCase();
            if (lowerM.startsWith('gemini')) {
                const key = (localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '').trim();
                return !!key;
            }
            for (const provider of freeProviders) {
                const providerModels = Array.isArray(provider.models) ? provider.models : [];
                const matchedGroup = defaultProviders.find(group => group.name && group.name.includes(provider.name));
                const allGroupModels = matchedGroup && Array.isArray(matchedGroup.models) ? matchedGroup.models : providerModels;
                if (allGroupModels.includes(bare) || providerModels.includes(bare)) {
                    const key = (localStorage.getItem(`kai.${provider.configKey}`) || '').trim();
                    return !!key;
                }
            }
            // LM Studio offline until live connection check
            return false;
        };

        const i18n = window.KAI_I18N || {};

        // 1. LM Studio (Offline initially)
        const headerTitle = i18n.lmStudioHeader || 'LM Studio';
        const offlineLabel = i18n.disconnected || 'Offline';
        const lmTitle = `${headerTitle} (${offlineLabel})`;
        this.createAccordionGroup(lmTitle, [], false, isModelConnected, true);

        // 2. Google Gemini
        const showGeminiExpanded = this.selectedModelValue && this.selectedModelValue.toLowerCase().startsWith('gemini');
        this.createAccordionGroup('Gemini', defaultGemini, showGeminiExpanded, isModelConnected);

        // 3. All Cloud & Free Providers
        defaultProviders.forEach(dp => {
            const cleanName = dp.name.replace(/\s*\([^)]*\)/g, '').trim();
            const isExpanded = this.selectedModelValue && Array.isArray(dp.models) && dp.models.includes(this.selectedModelValue);
            this.createAccordionGroup(cleanName, dp.models, isExpanded, isModelConnected);
        });

        // 4. Update trigger button state & status dot
        if (this.selectedModelValue && this.selectedModelValue !== 'local-model' && this.selectedModelValue !== 'No Models Loaded') {
            ThinkingStateFormatter.renderTriggerLabel({
                modelId: this.selectedModelValue,
                container: this.selectedModelText,
                formatter: this.formatter
            });
            if (this.statusDot) {
                this.statusDot.className = isModelConnected(this.selectedModelValue) ? 'status-dot status-connected' : 'status-dot status-disconnected';
            }
        } else {
            this.selectedModelValue = 'local-model';
            if (this.selectedModelText) this.selectedModelText.textContent = 'local-model';
            if (this.statusDot) {
                this.statusDot.className = 'status-dot status-disconnected';
            }
        }
    }

    /**
     * Updates model dropdown options and connection dots when extension connectionStatus event arrives.
     * Renders all providers with dynamic green/red status dots.
     * @param {object} message Connection status payload from extension host.
     */
    updateConnectionStatus(message) {
        if (!this.dropdownOptionsMenu || !message) return;
        console.log('[KAI Dropdown] updateConnectionStatus:', message.lmStudioModels?.length, 'LM models, connected:', message.connected);

        if (message.lmStudioCapabilities) {
            window.KAI_LMSTUDIO_CAPABILITIES = message.lmStudioCapabilities;
            ThinkingStateFormatter.setLMStudioCapabilities(message.lmStudioCapabilities);
        }

        const defaultProviders = KAI_CONSTANTS.DEFAULT_PROVIDERS_WITH_MODELS || [];
        const freeProviders = message.freeProviders || KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS || [];
        this.freeProvidersConfig = freeProviders;

        const isModelConnected = (m) => {
            if (!m) return false;
            const bare = m.endsWith(' (thinking)') ? m.slice(0, -11) : m;
            const lowerM = bare.toLowerCase();
            if (lowerM.startsWith('gemini')) {
                const key = (localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '').trim();
                return !!(message.apiKey || key);
            }
            for (const provider of freeProviders) {
                const providerModels = Array.isArray(provider.models) ? provider.models : [];
                const matchedGroup = defaultProviders.find(group => group.name && group.name.includes(provider.name));
                const allGroupModels = matchedGroup && Array.isArray(matchedGroup.models) ? matchedGroup.models : providerModels;
                if (allGroupModels.includes(bare) || providerModels.includes(bare)) {
                    const key = (localStorage.getItem(`kai.${provider.configKey}`) || '').trim();
                    return !!(provider.apiKey || key);
                }
            }
            // For LM Studio: green only if server is online and model is in loadedModels
            return Boolean(message.connected && message.loadedModels && message.loadedModels.some(lm => lm.toLowerCase() === bare.toLowerCase()));
        };

        const lmStudioModels = message.lmStudioModels || [];
        this.lmStudioRawModels = lmStudioModels;
        const geminiModels = message.geminiModels || [];

        this.dropdownOptionsMenu.innerHTML = '';

        const i18n = window.KAI_I18N || {};

        // 1. LM Studio local models
        const isServerOnline = Boolean(message.connected && lmStudioModels && lmStudioModels.length > 0);
        const lmStudioStatus = isServerOnline ? (i18n.connected || 'Connected') : (i18n.disconnected || 'Offline');
        const headerTitle = i18n.lmStudioHeader || 'LM Studio';
        const lmTitle = `${headerTitle} (${lmStudioStatus})`;
        const isLMExpanded = this.selectedModelValue && !this.selectedModelValue.toLowerCase().startsWith('gemini') && !defaultProviders.some(dp => Array.isArray(dp.models) && dp.models.includes(this.selectedModelValue));
        this.createAccordionGroup(lmTitle, isServerOnline ? lmStudioModels : [], isLMExpanded, isModelConnected, true);

        // 2. Google Gemini
        const geminiTitle = 'Gemini';
        const showGeminiExpanded = this.selectedModelValue && this.selectedModelValue.toLowerCase().startsWith('gemini');
        this.createAccordionGroup(geminiTitle, geminiModels.length > 0 ? geminiModels : KAI_CONSTANTS.DEFAULT_GEMINI_MODELS, showGeminiExpanded, isModelConnected);

        // 3. All Free & Cloud Providers
        defaultProviders.forEach(dp => {
            const cleanName = dp.name.replace(/\s*\([^)]*\)/g, '').trim();
            const isExpanded = this.selectedModelValue && Array.isArray(dp.models) && dp.models.includes(this.selectedModelValue);
            this.createAccordionGroup(cleanName, dp.models, isExpanded, isModelConnected);
        });

        // 4. Update trigger button state & status dot
        if (this.selectedModelValue && this.selectedModelValue !== 'local-model' && this.selectedModelValue !== 'No Models Loaded') {
            ThinkingStateFormatter.renderTriggerLabel({
                modelId: this.selectedModelValue,
                container: this.selectedModelText,
                formatter: this.formatter
            });
            if (this.statusDot) {
                this.statusDot.className = isModelConnected(this.selectedModelValue) ? 'status-dot status-connected' : 'status-dot status-disconnected';
            }
        } else {
            this.selectedModelValue = 'local-model';
            if (this.selectedModelText) this.selectedModelText.textContent = 'local-model';
            if (this.statusDot) {
                this.statusDot.className = isModelConnected('local-model') ? 'status-dot status-connected' : 'status-dot status-disconnected';
            }
        }

        this.updateGeminiThinkingVisibility();
    }

    /**
     * Determines provider requirements and key status for a given model ID.
     * @param {string} modelId Model identifier string.
     * @returns {object|null} Provider descriptor object or null if local.
     */
    getProviderInfo(modelId) {
        if (!modelId) return null;
        const bare = modelId.endsWith(' (thinking)') ? modelId.slice(0, -11) : modelId;
        const lower = bare.toLowerCase();
        if (lower.startsWith('gemini') || lower.includes('gemini')) {
            const key = (localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '').trim();
            return {
                providerName: 'Google Gemini',
                configKey: 'geminiApiKey',
                keyHint: 'Get free key at aistudio.google.com/app/apikey',
                url: 'https://aistudio.google.com/app/apikey',
                hasKey: !!key,
                modelName: this.formatter ? this.formatter.formatModelName(bare) : bare
            };
        }
        const freeProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS) || [];
        for (const p of freeProviders) {
            const pKey = p.name.toLowerCase().split(' ')[0];
            if (lower.startsWith(pKey) || lower.includes(pKey)) {
                const key = (localStorage.getItem(`kai.${p.configKey}`) || '').trim();
                let url = '';
                if (p.configKey === 'mistralApiKey') url = 'https://console.mistral.ai';
                else if (p.configKey === 'cohereApiKey') url = 'https://dashboard.cohere.com';
                else if (p.configKey === 'cerebrasApiKey') url = 'https://cloud.cerebras.ai';
                else if (p.configKey === 'zhipuApiKey') url = 'https://open.bigmodel.cn';
                else if (p.configKey === 'openrouterApiKey') url = 'https://openrouter.ai/keys';
                return {
                    providerName: p.name,
                    configKey: p.configKey,
                    keyHint: p.keyHint,
                    url: url,
                    hasKey: !!key,
                    modelName: this.formatter ? this.formatter.formatModelName(bare) : bare
                };
            }
        }
        return null;
    }

    /**
     * Resolves currently selected model details including bare model ID, thinking toggle flag, and reasoning effort.
     * @param {string} [modelId] Optional target model ID to inspect.
     * @returns {object} Object containing model ID string, boolean thinking flag, and reasoning effort.
     */
    getSelectedModelDetails(modelId = null) {
        const targetModel = modelId || this.selectedModelValue || 'local-model';
        const raw = targetModel.endsWith(' (thinking)') ? targetModel.slice(0, -11) : targetModel;
        const caps = ThinkingStateFormatter.getCapabilitiesState(raw);

        return {
            model: raw,
            thinking: caps.isThinkingOn,
            isThinkingCapable: caps.hasThinkingToggle || caps.hasReasoningEffort,
            reasoningEffort: caps.hasReasoningEffort ? caps.reasoningLevel : (caps.isThinkingOn ? 'xhigh' : 'none')
        };
    }

    /**
     * Gets currently selected model ID string.
     * @returns {string} Selected model ID.
     */
    getSelectedModel() {
        return this.selectedModelValue;
    }

    /**
     * Sets active model ID and updates UI elements, dropdown list highlights, and connection status indicators.
     * @param {string} modelId Model ID.
     */
    setSelectedModel(modelId) {
        this.selectedModelValue = modelId;
        ThinkingStateFormatter.renderTriggerLabel({
            modelId: modelId,
            container: this.selectedModelText,
            formatter: this.formatter
        });

        const info = this.getProviderInfo(modelId);
        let isConnected = true;
        if (info) {
            isConnected = info.hasKey;
        } else if (this.isModelConnectedFn) {
            isConnected = this.isModelConnectedFn(modelId);
        }

        if (this.statusDot) {
            this.statusDot.className = isConnected ? 'status-dot status-connected' : 'status-dot status-disconnected';
        }

        if (this.dropdownOptionsMenu) {
            const items = this.dropdownOptionsMenu.querySelectorAll('.dropdown-item');
            items.forEach(item => {
                if (item.dataset.value === modelId) {
                    item.classList.add('selected');
                } else {
                    item.classList.remove('selected');
                }
            });
        }
        this.updateGeminiThinkingVisibility();
    }

    /**
     * Cleans up any deprecated icon elements from dropdown list items.
     */
    updateModelDropdownItemBatteries() {
        if (!this.dropdownOptionsMenu) return;
        const oldIcons = this.dropdownOptionsMenu.querySelectorAll('.item-battery-icon, .thinking-lamp-icon, .flyout-battery-icon');
        oldIcons.forEach(el => el.remove());
    }

    /**
     * Updates visibility of reasoning sub-settings in settings panel if present.
     */
    updateGeminiThinkingVisibility() {
        const container = document.getElementById('gemini-thinking-level-container');
        if (container) {
            const isGemini = this.selectedModelValue && this.selectedModelValue.toLowerCase().startsWith('gemini');
            if (isGemini) {
                container.style.display = 'block';
            } else {
                container.style.display = 'none';
            }
        }
    }
}
