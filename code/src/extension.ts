import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { InlineEditHandler } from './InlineEditHandler';
import { Logger } from './services/Logger';

/**
 * Entry point activation hook for the extension.
 * VS Code runs this method when the extension is activated (i.e. view is loaded).
 * @param context VS Code extension context providing subscription storage and files path.
 */
export function activate(context: vscode.ExtensionContext) {
    const channel = Logger.initialize();
    context.subscriptions.push(channel);
    Logger.info('KAI Agent extension activated successfully.');
    // Instantiate our custom WebviewView sidebar provider with the extension context
    const sidebarProvider = new SidebarProvider(context);

    // Register our custom ViewProvider with VS Code matching the views ID in package.json
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SidebarProvider.viewType,
            sidebarProvider
        )
    );

    // Register the command to send selected text to the chat pane
    context.subscriptions.push(
        vscode.commands.registerCommand('kai.sendSelection', () => {
            sidebarProvider.sendSelectionToChat();
        })
    );

    // Register command to programmatically focus and show the LM Studio Chat View
    context.subscriptions.push(
        vscode.commands.registerCommand('kai.focusChat', () => {
            vscode.commands.executeCommand('kai-chat-sidebar.focus');
        })
    );

    // Register command to run inline code editing
    context.subscriptions.push(
        vscode.commands.registerCommand('kai.inlineEdit', () => {
            InlineEditHandler.run();
        })
    );

    // Create a new Status Bar Item positioned on the right side (alignment priority 100)
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'kai.focusChat';
    statusBarItem.text = '$(hubot) Kai';
    statusBarItem.tooltip = 'Open Kai Agent Chat';
    statusBarItem.show();

    // Ensure resources are cleaned up on extension deactivation
    context.subscriptions.push(statusBarItem);
}

/**
 * Entry point deactivation hook for the extension.
 * Executed when the extension is shut down or disabled by the IDE.
 */
export function deactivate() {
    Logger.dispose();
}
