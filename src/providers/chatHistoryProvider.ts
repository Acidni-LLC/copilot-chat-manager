/**
 * Chat History Tree Provider
 * Provides the tree view for chat histories in the sidebar
 */

import * as vscode from 'vscode';
import { ChatHistory } from '../models/chatHistory';
import { ChatStorageService } from '../services/chatStorageService';

export class ChatHistoryProvider implements vscode.TreeDataProvider<ChatTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ChatTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<ChatTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ChatTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private storageService: ChatStorageService;

    constructor(storageService: ChatStorageService) {
        this.storageService = storageService;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ChatTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ChatTreeItem): Promise<ChatTreeItem[]> {
        if (element) {
            // No children for chat items
            return [];
        }

        // Root level - get all chats
        const chats = await this.storageService.scanAllChatHistories();
        
        // Sort by most recent first
        chats.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

        return chats.map(chat => new ChatTreeItem(chat));
    }
}

export class ChatTreeItem extends vscode.TreeItem {
    constructor(
        public readonly chat: ChatHistory
    ) {
        super(chat.workspaceName, vscode.TreeItemCollapsibleState.None);
        
        this.description = this.formatDate(chat.updatedAt);
        this.tooltip = this.buildTooltip();
        this.contextValue = 'chatItem';
        
        // Use message bubble icon
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        
        // Make it clickable to open the chat
        this.command = {
            command: 'copilotChatManager.openChat',
            title: 'Open Chat',
            arguments: [this.chat]
        };
    }

    private formatDate(date: Date): string {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) {
            return 'Just now';
        } else if (minutes < 60) {
            return `${minutes}m ago`;
        } else if (hours < 24) {
            return `${hours}h ago`;
        } else if (days < 7) {
            return `${days}d ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${this.chat.workspaceName}**\n\n`);
        md.appendMarkdown(`📅 Created: ${this.chat.createdAt.toLocaleString()}\n\n`);
        md.appendMarkdown(`🔄 Updated: ${this.chat.updatedAt.toLocaleString()}\n\n`);
        md.appendMarkdown(`💬 Messages: ${this.chat.messageCount}\n\n`);
        md.appendMarkdown(`---\n\n`);
        md.appendMarkdown(`**Last message:**\n\n${this.chat.lastMessage}`);
        return md;
    }
}

/**
 * Tree provider for workspace-grouped view
 */
export class WorkspaceTreeProvider implements vscode.TreeDataProvider<WorkspaceTreeItem | ChatTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceTreeItem | ChatTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<WorkspaceTreeItem | ChatTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkspaceTreeItem | ChatTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private storageService: ChatStorageService;

    constructor(storageService: ChatStorageService) {
        this.storageService = storageService;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkspaceTreeItem | ChatTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WorkspaceTreeItem | ChatTreeItem): Promise<(WorkspaceTreeItem | ChatTreeItem)[]> {
        if (element instanceof ChatTreeItem) {
            return [];
        }

        if (element instanceof WorkspaceTreeItem) {
            // Return chats for this workspace
            return element.chats.map(chat => new ChatTreeItem(chat));
        }

        // Root level - get workspaces
        await this.storageService.scanAllChatHistories();
        const grouped = this.storageService.getChatsByWorkspace();
        
        const workspaces: WorkspaceTreeItem[] = [];
        grouped.forEach((chats, workspaceName) => {
            workspaces.push(new WorkspaceTreeItem(workspaceName, chats));
        });

        // Sort by workspace name
        workspaces.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));

        return workspaces;
    }
}

export class WorkspaceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly workspaceName: string,
        public readonly chats: ChatHistory[]
    ) {
        super(workspaceName, vscode.TreeItemCollapsibleState.Collapsed);
        
        this.description = `${chats.length} chat${chats.length === 1 ? '' : 's'}`;
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'workspaceItem';
    }
}

/**
 * Tree provider for recent chats
 */
export class RecentChatsProvider implements vscode.TreeDataProvider<ChatTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ChatTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<ChatTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ChatTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private storageService: ChatStorageService;
    private maxRecent: number;

    constructor(storageService: ChatStorageService) {
        this.storageService = storageService;
        this.maxRecent = vscode.workspace.getConfiguration('copilotChatManager').get('maxRecentChats', 50);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ChatTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<ChatTreeItem[]> {
        const chats = this.storageService.getAllChats();
        
        // Sort by most recent and limit
        const recent = chats
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .slice(0, this.maxRecent);

        return recent.map(chat => new ChatTreeItem(chat));
    }
}
