/**
 * FileUploadController manages file attachments, file preview chips,
 * file validation, and IPC triggers for the Plus (+) upload button.
 */
class FileUploadController {
    /**
     * Initializes FileUploadController.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     * @param {AppState} appState Global application state instance.
     */
    constructor(ipcBridge, appState) {
        this.ipcBridge = ipcBridge;
        this.appState = appState;

        this.attachFileBtn = document.getElementById('attach-file-btn');
        this.attachedFilesBar = document.getElementById('attached-files-bar');

        this.initEventListeners();
        this.initIPCListeners();
    }

    /**
     * Binds DOM event listeners for the attach file button.
     */
    initEventListeners() {
        if (this.attachFileBtn) {
            this.attachFileBtn.addEventListener('click', () => {
                this.ipcBridge.openFilePicker();
            });
        }
    }

    /**
     * Binds IPC event listeners for incoming filesSelected messages.
     */
    initIPCListeners() {
        this.ipcBridge.on('filesSelected', (message) => {
            if (message.files && Array.isArray(message.files)) {
                this.addFiles(message.files);
            }
        });
    }

    /**
     * Appends new file objects to state and refreshes the preview chips bar.
     * @param {Array<object>} files File objects array.
     */
    addFiles(files) {
        for (const file of files) {
            if (!this.appState.attachedFiles.some(f => f.filePath === file.filePath)) {
                this.appState.attachedFiles.push(file);
            }
        }
        this.render();
    }

    /**
     * Removes an attached file by index and re-renders the preview bar.
     * @param {number} index Array index to remove.
     */
    removeFile(index) {
        if (index >= 0 && index < this.appState.attachedFiles.length) {
            this.appState.attachedFiles.splice(index, 1);
            this.render();
        }
    }

    /**
     * Clears all attached files and hides the preview bar.
     */
    clear() {
        this.appState.attachedFiles = [];
        this.render();
    }

    /**
     * Retrieves a copy of the attached files for prompt context sending.
     * @returns {Array<object>} Attached file objects.
     */
    getAttachedFiles() {
        return [...this.appState.attachedFiles];
    }

    /**
     * Renders attached file preview chips into the DOM container.
     */
    render() {
        if (!this.attachedFilesBar) return;

        const files = this.appState.attachedFiles || [];
        if (files.length === 0) {
            this.attachedFilesBar.classList.add('hidden');
            this.attachedFilesBar.innerHTML = '';
            return;
        }

        this.attachedFilesBar.classList.remove('hidden');
        this.attachedFilesBar.innerHTML = '';

        files.forEach((file, index) => {
            const chip = document.createElement('div');
            chip.className = 'attached-file-chip';
            chip.title = file.filePath;

            const isImg = /\.(png|jpe?g|webp|gif)$/i.test(file.fileName);
            const iconSpan = document.createElement('span');
            iconSpan.innerHTML = DOMUtils.icon(isImg ? 'diagram' : 'file', 12);

            const textSpan = document.createElement('span');
            textSpan.className = 'chip-name';
            textSpan.textContent = file.fileName;

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'chip-remove-btn';
            deleteBtn.innerHTML = DOMUtils.icon('close', 11);
            deleteBtn.title = 'Remove attached file';
            deleteBtn.setAttribute('aria-label', 'Remove attached file');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeFile(index);
            });

            chip.appendChild(iconSpan);
            chip.appendChild(textSpan);
            chip.appendChild(deleteBtn);
            this.attachedFilesBar.appendChild(chip);
        });
    }
}
