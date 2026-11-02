/**
 * Abstract interface defining environment services provided by the host environment (VS Code IDE or Standalone Desktop App).
 * Decouples backend tools, agents, and providers from direct editor or platform-specific dependencies.
 */
export interface IHostServices {
    /**
     * Retrieves compiler and linter diagnostics for a given file or the entire workspace.
     * @param filePath Optional target file path relative to workspace or absolute.
     * @returns Formatted diagnostics summary string.
     */
    getDiagnostics(filePath?: string): Promise<string>;

    /**
     * Captures post-edit compiler and linter diagnostics with brief language server polling.
     * @param targetFilePath Modified file path.
     * @param workspacePath Workspace root path.
     * @param isNewFile Whether the file was newly created.
     * @returns Formatted diagnostics note or empty string.
     */
    getPostEditDiagnostics(targetFilePath: string, workspacePath: string, isNewFile?: boolean): Promise<string>;

    /**
     * Searches workspace AST symbols (classes, functions, methods, interfaces).
     * @param query Search keyword.
     * @param workspacePath Workspace root directory.
     * @returns Formatted list of symbol locations.
     */
    searchWorkspaceSymbols(query: string, workspacePath: string): Promise<string>;

    /**
     * Retrieves a configuration setting value from user or workspace settings.
     * @param section Configuration section name (e.g. 'kai').
     * @param key Setting property key name.
     * @param defaultValue Optional fallback value if setting is not defined.
     */
    getConfiguration<T>(section: string, key: string, defaultValue?: T): T;

    /**
     * Suspends agent execution to request human clarification or multiple-choice selection from the developer.
     * Dispatches an interactive prompt card to the UI and resolves with the chosen answer string.
     * @param question The clarification question or prompt for the user.
     * @param options Optional list of multiple-choice answers for the user to click.
     * @param allowCustom Whether the user can type a custom response (default true).
     * @returns The user's selected or typed answer string.
     */
    askUser(question: string, options?: string[], allowCustom?: boolean): Promise<string>;
}

