/**
 * GitHub Copilot Chat Manager Extension
 * 
 * Main entry point for the VS Code extension that manages
 * GitHub Copilot chat histories across workspaces.
 */

import * as vscode from 'vscode';
import { ChatStorageService } from './services/chatStorageService';
import { ChatHistoryProvider, WorkspaceTreeProvider, RecentChatsProvider, ChatTreeItem } from './providers/chatHistoryProvider';
import { CommandHandlers } from './commands/commandHandlers';

/**
 * Extension activation
 * Called when the extension is activated (on first command or when view is visible)
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Copilot Chat Manager is now active');

    // Initialize the storage service
    const storageService = ChatStorageService.getInstance(context);
    
    // Scan for existing chats on startup
    await storageService.scanAllChatHistories();

    // Initialize tree view providers
    const historyProvider = new ChatHistoryProvider(storageService);
    const workspaceProvider = new WorkspaceTreeProvider(storageService);
    const recentProvider = new RecentChatsProvider(storageService);

    // Register tree views
    const historyTree = vscode.window.createTreeView('copilotChatManager.chatHistory', {
        treeDataProvider: historyProvider,
        showCollapseAll: true
    });

    const workspaceTree = vscode.window.createTreeView('copilotChatManager.workspaces', {
        treeDataProvider: workspaceProvider,
        showCollapseAll: true
    });

    const recentTree = vscode.window.createTreeView('copilotChatManager.recent', {
        treeDataProvider: recentProvider,
        showCollapseAll: false
    });

    // Initialize command handlers
    const handlers = new CommandHandlers(context, historyProvider, workspaceProvider, recentProvider);

    // Register all commands
    const commands: Array<[string, (...args: any[]) => Promise<void>]> = [
        ['copilotChatManager.openDashboard', () => handlers.openDashboard()],
        ['copilotChatManager.exportChat', (item: ChatTreeItem) => handlers.exportChat(item)],
        ['copilotChatManager.exportAllChats', () => handlers.exportAllChats()],
        ['copilotChatManager.importChats', () => handlers.importChats()],
        ['copilotChatManager.searchChats', () => handlers.searchChats()],
        ['copilotChatManager.deleteChat', (item: ChatTreeItem) => handlers.deleteChat(item)],
        ['copilotChatManager.attachToProject', (item: ChatTreeItem) => handlers.attachToProject(item)],
        ['copilotChatManager.refreshHistory', () => handlers.refreshHistory()],
        ['copilotChatManager.openChat', (item: ChatTreeItem) => handlers.openChat(item)]
    ];

    for (const [commandId, handler] of commands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, handler)
        );
    }

    // Register tree views as disposables
    context.subscriptions.push(historyTree, workspaceTree, recentTree);

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('copilotChatManager')) {
                // Refresh providers when settings change
                historyProvider.refresh();
                workspaceProvider.refresh();
                recentProvider.refresh();
            }
        })
    );

    // Set up file system watcher for Copilot chat storage
    const storagePath = storageService.getCopilotChatStoragePath();
    if (storagePath) {
        const pattern = new vscode.RelativePattern(storagePath, '**/*');
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        watcher.onDidCreate(() => {
            storageService.scanAllChatHistories().then(() => {
                historyProvider.refresh();
                workspaceProvider.refresh();
                recentProvider.refresh();
            });
        });

        watcher.onDidChange(() => {
            storageService.scanAllChatHistories().then(() => {
                historyProvider.refresh();
                workspaceProvider.refresh();
                recentProvider.refresh();
            });
        });

        watcher.onDidDelete(() => {
            storageService.scanAllChatHistories().then(() => {
                historyProvider.refresh();
                workspaceProvider.refresh();
                recentProvider.refresh();
            });
        });

        context.subscriptions.push(watcher);
    }

    // Show welcome message on first activation
    const hasShownWelcome = context.globalState.get('hasShownWelcome', false);
    if (!hasShownWelcome) {
        const result = await vscode.window.showInformationMessage(
            'Copilot Chat Manager is ready! View your chat histories in the sidebar.',
            'Open Dashboard',
            'Dismiss'
        );

        if (result === 'Open Dashboard') {
            handlers.openDashboard();
        }

        context.globalState.update('hasShownWelcome', true);
    }

    console.log(`Copilot Chat Manager: Found ${storageService.getAllChats().length} chats`);
}

/**
 * Extension deactivation
 * Called when the extension is deactivated
 */
export function deactivate(): void {
    console.log('Copilot Chat Manager deactivated');
}
