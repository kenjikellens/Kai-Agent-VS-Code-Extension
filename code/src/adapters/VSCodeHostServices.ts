import * as path from 'path';
import * as vscode from 'vscode';
import { IHostServices } from '../core/IHostServices';
import { ISessionStorage, ChatSessionRecord } from '../core/ISessionStorage';

/**
 * VS Code host services adapter implementing IHostServices.
 * Bridges backend tools and engine components to VS Code editor APIs, language server providers, and settings.
 */
export class VSCodeHostServices implements IHostServices {
    /**
     * Retrieves compiler and linter diagnostics for a given file or the entire workspace.
     * @param filePath Optional target file path to filter diagnostics.
     * @returns Formatted diagnostics summary string.
     */
    public async getDiagnostics(filePath?: string): Promise<string> {
        try {
            if (filePath) {
                const targetUri = vscode.Uri.file(filePath);
                const diags = vscode.languages.getDiagnostics(targetUri) || [];
                return this.formatDiagnosticsList(diags, filePath);
            }

            const allDiags = vscode.languages.getDiagnostics();
            if (!allDiags || allDiags.length === 0) {
                return 'No diagnostics found in workspace.';
            }

            const lines: string[] = [];
            for (const [uri, diags] of allDiags) {
                if (diags.length > 0) {
                    lines.push(this.formatDiagnosticsList(diags, uri.fsPath));
                }
            }

            return lines.length > 0 ? lines.join('\n') : 'No diagnostics found in workspace.';
        } catch (error: any) {
            return `Failed to retrieve VS Code diagnostics: ${error?.message || error}`;
        }
    }

    /**
     * Captures post-edit compiler and linter diagnostics with brief language server polling.
     * @param targetFilePath Modified file path.
     * @param workspacePath Active workspace root directory.
     * @param isNewFile Whether the file was newly created.
     * @returns Formatted diagnostics note or empty string.
     */
    public async getPostEditDiagnostics(
        targetFilePath: string,
        workspacePath: string,
        isNewFile: boolean = false
    ): Promise<string> {
        try {
            const absolutePath = path.isAbsolute(targetFilePath)
                ? targetFilePath
                : path.join(workspacePath, targetFilePath);

            const fileUri = vscode.Uri.file(absolutePath);

            if (isNewFile) {
                try {
                    await vscode.workspace.openTextDocument(fileUri);
                } catch {
                    // Ignore document opening errors
                }
            }

            const maxWaitMs = 1500;
            const pollIntervalMs = 150;
            const startTime = Date.now();

            let targetDiagnostics: vscode.Diagnostic[] = [];

            while (Date.now() - startTime < maxWaitMs) {
                targetDiagnostics = vscode.languages.getDiagnostics(fileUri) || [];
                if (targetDiagnostics.length > 0 || (Date.now() - startTime >= 300)) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            }

            const uriSet = new Set<string>();
            uriSet.add(fileUri.toString());

            const openDocs = vscode.workspace.textDocuments || [];
            for (const doc of openDocs) {
                if (doc.uri.scheme === 'file' && doc.uri.fsPath.startsWith(workspacePath)) {
                    uriSet.add(doc.uri.toString());
                }
            }

            const errorEntries: string[] = [];
            const warningEntries: string[] = [];

            for (const uriStr of uriSet) {
                const currentUri = vscode.Uri.parse(uriStr);
                const diags = vscode.languages.getDiagnostics(currentUri) || [];
                const relPath = path.relative(workspacePath, currentUri.fsPath).replace(/\\/g, '/');

                for (const diag of diags) {
                    const line = diag.range.start.line + 1;
                    const cleanMessage = diag.message.replace(/\r?\n/g, ' ').trim();

                    if (diag.severity === vscode.DiagnosticSeverity.Error) {
                        errorEntries.push(`${relPath} L${line}: ${cleanMessage}`);
                    } else if (diag.severity === vscode.DiagnosticSeverity.Warning) {
                        warningEntries.push(`${relPath} L${line}: ${cleanMessage}`);
                    }
                }
            }

            return this.formatDiagnosticsNote(errorEntries, warningEntries);
        } catch {
            return '';
        }
    }

    /**
     * Searches workspace AST symbols (classes, functions, methods, interfaces) using VS Code Language Providers.
     * @param query Search keyword.
     * @param workspacePath Workspace root directory.
     * @returns Formatted list of symbol locations.
     */
    public async searchWorkspaceSymbols(query: string, workspacePath: string): Promise<string> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                query
            );

            if (!symbols || symbols.length === 0) {
                return `No symbols found matching query: "${query}"`;
            }

            const symbolKindMap: Record<number, string> = {
                [vscode.SymbolKind.Class]: 'Class',
                [vscode.SymbolKind.Method]: 'Method',
                [vscode.SymbolKind.Function]: 'Function',
                [vscode.SymbolKind.Interface]: 'Interface',
                [vscode.SymbolKind.Variable]: 'Variable',
                [vscode.SymbolKind.Property]: 'Property',
                [vscode.SymbolKind.Constant]: 'Constant',
                [vscode.SymbolKind.Enum]: 'Enum'
            };

            const formatted = symbols.map(s => {
                const relPath = path.relative(workspacePath, s.location.uri.fsPath).replace(/\\/g, '/');
                const kind = symbolKindMap[s.kind] || 'Symbol';
                const line = s.location.range.start.line + 1;
                const container = s.containerName ? ` (in ${s.containerName})` : '';
                return `[${kind}] ${s.name}${container} -> ${relPath}:${line}`;
            });

            return formatted.join('\n');
        } catch (error: any) {
            return `Failed to execute VS Code workspace symbol search: ${error?.message || error}`;
        }
    }

    /**
     * Retrieves configuration setting from active VS Code workspace settings.
     * @param section Configuration section name.
     * @param key Setting property key.
     * @param defaultValue Default fallback if unset.
     */
    public getConfiguration<T>(section: string, key: string, defaultValue?: T): T {
        try {
            const config = vscode.workspace.getConfiguration(section);
            const val = config.get<T>(key);
            return val !== undefined && val !== null ? val : (defaultValue as T);
        } catch {
            return defaultValue as T;
        }
    }

    /**
     * Formats an array of VS Code diagnostics into human-readable text lines.
     */
    private formatDiagnosticsList(diags: vscode.Diagnostic[], filePath: string): string {
        return diags.map(d => {
            const severity = d.severity === vscode.DiagnosticSeverity.Error ? '[ERROR]' :
                             d.severity === vscode.DiagnosticSeverity.Warning ? '[WARN]' : '[INFO]';
            const line = d.range.start.line + 1;
            return `${severity} ${filePath}:${line} - ${d.message}`;
        }).join('\n');
    }

    /**
     * Formats error and warning arrays into a concise diagnostic note.
     */
    private formatDiagnosticsNote(errors: string[], warnings: string[]): string {
        if (errors.length === 0 && warnings.length === 0) {
            return '';
        }

        const parts: string[] = [];
        if (errors.length > 0) {
            const errorList = errors.slice(0, 5).join(', ');
            const errorSuffix = errors.length > 5 ? ` (+${errors.length - 5} more)` : '';
            parts.push(`errors: [${errorList}${errorSuffix}]`);
        }
        if (warnings.length > 0) {
            const warningList = warnings.slice(0, 3).join(', ');
            const warningSuffix = warnings.length > 3 ? ` (+${warnings.length - 3} more)` : '';
            parts.push(`warnings: [${warningList}${warningSuffix}]`);
        }

        return `\n[Diagnostics note]: ${parts.join(', ')}`;
    }

    private static pendingRequests: Map<string, { resolve: (val: string) => void; timer: NodeJS.Timeout }> = new Map();
    private static activeWebview?: vscode.Webview;

    /**
     * Registers the active webview instance to receive interactive clarification requests.
     * @param webview The active webview panel or sidebar.
     */
    public static setActiveWebview(webview: vscode.Webview): void {
        this.activeWebview = webview;
    }

    /**
     * Resolves a pending ask_user prompt with the developer's selected choice or typed text.
     * @param requestId The correlation ID of the pending prompt.
     * @param answer The developer's response string.
     * @returns True if request was found and resolved.
     */
    public static resolveAskUser(requestId: string, answer: string): boolean {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(requestId);
            pending.resolve(answer);
            return true;
        }
        return false;
    }

    /**
     * Suspends agent execution to request human clarification or multiple-choice selection from the developer.
     * Dispatches an interactive prompt card to the UI and resolves with the chosen answer string.
     * @param question The clarification question or prompt for the user.
     * @param options Optional list of multiple-choice answers for the user to click.
     * @param allowCustom Whether the user can type a custom response (default true).
     * @returns The user's selected or typed answer string.
     */
    public askUser(question: string, options?: string[], allowCustom?: boolean): Promise<string> {
        return new Promise<string>((resolve) => {
            const requestId = `ask-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const timer = setTimeout(() => {
                VSCodeHostServices.pendingRequests.delete(requestId);
                resolve('[ask_user: Timed out waiting for developer response]');
            }, 300000);

            VSCodeHostServices.pendingRequests.set(requestId, { resolve, timer });

            if (VSCodeHostServices.activeWebview) {
                VSCodeHostServices.activeWebview.postMessage({
                    type: 'ask_user_request',
                    requestId,
                    question,
                    options: Array.isArray(options) ? options : [],
                    allowCustom: allowCustom !== false
                });
            } else {
                clearTimeout(timer);
                VSCodeHostServices.pendingRequests.delete(requestId);
                resolve(`[ask_user: Webview UI is not available. Question was: ${question}]`);
            }
        });
    }
}

/**
 * VS Code Memento storage driver implementing ISessionStorage.
 * Persists chat sessions directly into VS Code workspaceState or globalState.
 */
export class MementoSessionStorage implements ISessionStorage {
    private static readonly STORAGE_KEY = 'kai.chats';

    /**
     * Initializes a new instance of MementoSessionStorage.
     * @param memento The active VS Code Memento storage instance.
     */
    constructor(private readonly memento: vscode.Memento) {}

    /**
     * Loads all chat sessions from VS Code Memento storage.
     * @returns Dictionary of chat sessions.
     */
    public load(): Record<string, ChatSessionRecord> {
        return this.memento.get<Record<string, ChatSessionRecord>>(MementoSessionStorage.STORAGE_KEY) || {};
    }

    /**
     * Saves chat sessions into VS Code Memento storage.
     * @param sessions Dictionary of chat sessions.
     */
    public async save(sessions: Record<string, ChatSessionRecord>): Promise<void> {
        await this.memento.update(MementoSessionStorage.STORAGE_KEY, sessions);
    }
}

