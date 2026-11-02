import * as vscode from 'vscode';

/**
 * Dedicated output channel logger for the KAI Agent VS Code Extension.
 * Directs informational, warning, and error diagnostics to VS Code's Output panel ('KAI Agent' channel)
 * and mirrors output to console for debug sessions.
 */
export class Logger {
    private static channel: vscode.OutputChannel | null = null;

    /**
     * Initializes the VS Code Output Channel.
     * @returns The active OutputChannel instance.
     */
    public static initialize(): vscode.OutputChannel {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel('KAI Agent');
        }
        return this.channel;
    }

    /**
     * Formats a timestamped log entry string.
     * @param level Severity level label.
     * @param message Text message to format.
     */
    private static format(level: string, message: string): string {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        return `[${now}] [${level}] ${message}`;
    }

    /**
     * Logs informational messages to the KAI Agent output channel.
     * @param message Informational log text.
     * @param args Optional supplementary metadata.
     */
    public static info(message: string, ...args: any[]): void {
        const formatted = this.format('INFO', message);
        console.log(formatted, ...args);
        if (this.channel) {
            const extra = args.length > 0 ? ' ' + JSON.stringify(args) : '';
            this.channel.appendLine(`${formatted}${extra}`);
        }
    }

    /**
     * Logs warning messages to the KAI Agent output channel.
     * @param message Warning log text.
     * @param args Optional supplementary metadata.
     */
    public static warn(message: string, ...args: any[]): void {
        const formatted = this.format('WARN', message);
        console.warn(formatted, ...args);
        if (this.channel) {
            const extra = args.length > 0 ? ' ' + JSON.stringify(args) : '';
            this.channel.appendLine(`${formatted}${extra}`);
        }
    }

    /**
     * Logs error diagnostics and stack traces to the KAI Agent output channel.
     * @param message Error description.
     * @param error Optional error object or cause.
     */
    public static error(message: string, error?: any): void {
        const formatted = this.format('ERROR', message);
        console.error(formatted, error || '');
        if (this.channel) {
            let errorDetails = '';
            if (error instanceof Error) {
                errorDetails = `\n  Stack: ${error.stack || error.message}`;
            } else if (error) {
                errorDetails = `\n  Details: ${typeof error === 'object' ? JSON.stringify(error) : error}`;
            }
            this.channel.appendLine(`${formatted}${errorDetails}`);
        }
    }

    /**
     * Brings the KAI Agent output channel into view in the VS Code panel.
     * @param preserveFocus If true, keeps focus on current active editor.
     */
    public static show(preserveFocus = true): void {
        if (this.channel) {
            this.channel.show(preserveFocus);
        }
    }

    /**
     * Disposes the active output channel on extension deactivation.
     */
    public static dispose(): void {
        if (this.channel) {
            this.channel.dispose();
            this.channel = null;
        }
    }
}

