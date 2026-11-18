/**
 * ToggleComponent provides a reusable UI toggle switch DOM element.
 */
class ToggleComponent {
    /**
     * Creates a reusable switch container DOM element with checkbox and track, preventing label double-toggles.
     * Mutates input.checked and dispatches a synthetic change event when the slider track is clicked.
     * @param {object} options Configuration options.
     * @param {string} [options.id] Element ID for the input checkbox.
     * @param {string} [options.label] Display label text next to the toggle.
     * @param {boolean} [options.checked] Initial checked state.
     * @param {Function} [options.onChange] Callback invoked when toggle state changes.
     * @param {string} [options.title] Tooltip title attribute.
     * @returns {HTMLLabelElement} Switch container label element.
     */
    static create({ id, label = '', checked = false, onChange = null, title = '' } = {}) {
        const container = document.createElement('label');
        container.className = 'switch-container';
        if (title) {
            container.title = title;
        }

        const input = document.createElement('input');
        input.type = 'checkbox';
        if (id) {
            input.id = id;
        }
        input.checked = Boolean(checked);

        const track = document.createElement('span');
        track.className = 'slider-track';
        track.setAttribute('aria-checked', String(input.checked));

        container.appendChild(input);
        container.appendChild(track);

        if (label) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'switch-label';
            labelSpan.textContent = label;
            container.appendChild(labelSpan);
        }

        input.addEventListener('change', (e) => {
            track.setAttribute('aria-checked', String(input.checked));
            if (typeof onChange === 'function') {
                onChange(input.checked, e);
            }
        });

        track.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            input.checked = !input.checked;
            input.dispatchEvent(new Event('change'));
        });

        return container;
    }
}
