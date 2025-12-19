/**
 * Command handlers for Copilot Chat Manager
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ChatHistory, ExportOptions } from '../models/chatHistory';
import { ChatStorageService } from '../services/chatStorageService';
import { ChatHistoryProvider, WorkspaceTreeProvider, RecentChatsProvider, ChatTreeItem } from '../providers/chatHistoryProvider';

export class CommandHandlers {
    private storageService: ChatStorageService;
    private historyProvider: ChatHistoryProvider;
    private workspaceProvider: WorkspaceTreeProvider;
    private recentProvider: RecentChatsProvider;

    constructor(
        context: vscode.ExtensionContext,
        historyProvider: ChatHistoryProvider,
        workspaceProvider: WorkspaceTreeProvider,
        recentProvider: RecentChatsProvider
    ) {
        this.storageService = ChatStorageService.getInstance(context);
        this.historyProvider = historyProvider;
        this.workspaceProvider = workspaceProvider;
        this.recentProvider = recentProvider;
    }

    /**
     * Open the chat manager dashboard in a webview
     */
    async openDashboard(): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'copilotChatManagerDashboard',
            'Copilot Chat Manager',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const chats = await this.storageService.scanAllChatHistories();
        panel.webview.html = this.getDashboardHtml(chats);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'openChat':
                    const chatToOpen = this.storageService.getChatById(message.chatId);
                    if (chatToOpen) {
                        await this.openChat(chatToOpen);
                    }
                    break;
                case 'exportChat':
                    const chatToExport = this.storageService.getChatById(message.chatId);
                    if (chatToExport) {
                        await this.exportChat(chatToExport);
                    }
                    break;
                case 'deleteChat':
                    const chatToDelete = this.storageService.getChatById(message.chatId);
                    if (chatToDelete) {
                        await this.deleteChat(chatToDelete);
                        panel.webview.html = this.getDashboardHtml(this.storageService.getAllChats());
                    }
                    break;
                case 'refresh':
                    await this.storageService.scanAllChatHistories();
                    panel.webview.html = this.getDashboardHtml(this.storageService.getAllChats());
                    this.refreshAll();
                    break;
                case 'openSettings':
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'copilotChatManager');
                    break;
                case 'exportAll':
                    await this.exportAllChats();
                    break;
                case 'importChats':
                    await this.importChats();
                    panel.webview.html = this.getDashboardHtml(this.storageService.getAllChats());
                    break;
                case 'deepSearch':
                    const searchTerms = message.terms as string[];
                    const mode = message.mode as 'any' | 'all' | 'exact';
                    const results = await this.storageService.deepSearch(searchTerms, mode);
                    panel.webview.postMessage({ 
                        command: 'deepSearchResults', 
                        results: results.map(r => ({
                            chatId: r.chat.id,
                            wordCounts: Object.fromEntries(r.wordCounts),
                            totalMatches: r.totalMatches,
                            filePath: r.filePath
                        }))
                    });
                    break;
            }
        });
    }

    /**
     * Open a specific chat in a webview with full message content
     */
    async openChat(chat: ChatHistory | ChatTreeItem): Promise<void> {
        const chatData = chat instanceof ChatTreeItem ? chat.chat : chat;
        
        const panel = vscode.window.createWebviewPanel(
            'copilotChatView',
            `Chat: ${chatData.workspaceName}`,
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        // Show loading state
        panel.webview.html = this.getLoadingHtml(chatData.workspaceName);

        // Load full chat content (lazy loading)
        const fullChat = await this.storageService.loadFullChat(chatData.id);
        
        if (fullChat && fullChat.messages.length > 0) {
            panel.webview.html = this.getChatViewHtml(fullChat);
        } else {
            panel.webview.html = this.getEmptyChatHtml(chatData);
        }
    }

    /**
     * Loading state HTML
     */
    private getLoadingHtml(workspaceName: string): string {
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 40px; text-align: center; color: var(--vscode-foreground); }
        .spinner { font-size: 24px; }
    </style>
</head>
<body>
    <h1>${workspaceName}</h1>
    <div class="spinner">⏳ Loading chat history...</div>
</body>
</html>`;
    }

    /**
     * Empty chat HTML
     */
    private getEmptyChatHtml(chat: ChatHistory): string {
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 40px; text-align: center; color: var(--vscode-foreground); }
        .info { color: var(--vscode-descriptionForeground); margin-top: 20px; }
    </style>
</head>
<body>
    <h1>${chat.workspaceName}</h1>
    <p class="info">No messages found in this chat session.</p>
    <p class="info">Created: ${chat.createdAt.toLocaleString()}</p>
</body>
</html>`;
    }

    /**
     * Export a single chat
     */
    async exportChat(chat: ChatHistory | ChatTreeItem): Promise<void> {
        const chatData = chat instanceof ChatTreeItem ? chat.chat : chat;
        
        const format = await vscode.window.showQuickPick(
            ['json', 'markdown', 'html'],
            { placeHolder: 'Select export format' }
        ) as 'json' | 'markdown' | 'html' | undefined;

        if (!format) {
            return;
        }

        const defaultPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const filename = `copilot-chat-${chatData.workspaceName}-${Date.now()}.${format === 'markdown' ? 'md' : format}`;
        
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(defaultPath, filename)),
            filters: {
                [format.toUpperCase()]: [format === 'markdown' ? 'md' : format]
            }
        });

        if (uri) {
            await this.storageService.exportChats([chatData], format, uri.fsPath);
            vscode.window.showInformationMessage(`Chat exported to ${uri.fsPath}`);
        }
    }

    /**
     * Export all chats
     */
    async exportAllChats(): Promise<void> {
        const chats = this.storageService.getAllChats();
        
        if (chats.length === 0) {
            vscode.window.showInformationMessage('No chats to export');
            return;
        }

        const format = await vscode.window.showQuickPick(
            ['json', 'markdown', 'html'],
            { placeHolder: 'Select export format' }
        ) as 'json' | 'markdown' | 'html' | undefined;

        if (!format) {
            return;
        }

        const defaultPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const filename = `copilot-chats-export-${Date.now()}.${format === 'markdown' ? 'md' : format}`;
        
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(defaultPath, filename)),
            filters: {
                [format.toUpperCase()]: [format === 'markdown' ? 'md' : format]
            }
        });

        if (uri) {
            await this.storageService.exportChats(chats, format, uri.fsPath);
            vscode.window.showInformationMessage(`${chats.length} chats exported to ${uri.fsPath}`);
        }
    }

    /**
     * Import chats from file
     */
    async importChats(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: {
                'JSON': ['json']
            },
            openLabel: 'Import'
        });

        if (!uris || uris.length === 0) {
            return;
        }

        const result = await this.storageService.importChats(uris[0].fsPath);

        if (result.success) {
            vscode.window.showInformationMessage(
                `Imported ${result.importedCount} chats (${result.skippedCount} skipped as duplicates)`
            );
            this.refreshAll();
        } else {
            vscode.window.showErrorMessage(`Import failed: ${result.errors.join(', ')}`);
        }
    }

    /**
     * Search chats
     */
    async searchChats(): Promise<void> {
        const query = await vscode.window.showInputBox({
            prompt: 'Search chats',
            placeHolder: 'Enter search text...'
        });

        if (!query) {
            return;
        }

        const results = this.storageService.searchChats(query);

        if (results.length === 0) {
            vscode.window.showInformationMessage('No matching chats found');
            return;
        }

        // Show results in a quick pick
        const items = results.map(chat => ({
            label: chat.workspaceName,
            description: chat.lastMessage,
            detail: `${chat.messageCount} messages • ${chat.updatedAt.toLocaleString()}`,
            chat: chat
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `${results.length} result${results.length === 1 ? '' : 's'} found`,
            matchOnDescription: true
        });

        if (selected) {
            await this.openChat(selected.chat);
        }
    }

    /**
     * Delete a chat
     */
    async deleteChat(chat: ChatHistory | ChatTreeItem): Promise<void> {
        const chatData = chat instanceof ChatTreeItem ? chat.chat : chat;
        
        const config = vscode.workspace.getConfiguration('copilotChatManager');
        const confirmDelete = config.get('confirmDelete', true);

        if (confirmDelete) {
            const confirm = await vscode.window.showWarningMessage(
                `Delete chat from "${chatData.workspaceName}"?`,
                { modal: true },
                'Delete'
            );

            if (confirm !== 'Delete') {
                return;
            }
        }

        this.storageService.deleteChat(chatData.id);
        vscode.window.showInformationMessage('Chat deleted');
        this.refreshAll();
    }

    /**
     * Attach chat to a project
     */
    async attachToProject(chat: ChatHistory | ChatTreeItem): Promise<void> {
        const chatData = chat instanceof ChatTreeItem ? chat.chat : chat;
        
        // Get workspace folders
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showInformationMessage('No workspace folders open');
            return;
        }

        const items = folders.map(folder => ({
            label: folder.name,
            description: folder.uri.fsPath,
            path: folder.uri.fsPath
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select project to attach chat to'
        });

        if (selected) {
            chatData.attachedProject = selected.path;
            vscode.window.showInformationMessage(`Chat attached to ${selected.label}`);
        }
    }

    /**
     * Refresh all tree views
     */
    async refreshHistory(): Promise<void> {
        await this.storageService.scanAllChatHistories();
        this.refreshAll();
        vscode.window.showInformationMessage('Chat history refreshed');
    }

    private refreshAll(): void {
        this.historyProvider.refresh();
        this.workspaceProvider.refresh();
        this.recentProvider.refresh();
    }

    /**
     * Generate dashboard HTML
     */
    private getDashboardHtml(chats: ChatHistory[]): string {
        const storagePath = this.storageService.getStoragePathDisplay();
        const scanStats = this.storageService.getScanStats();
        
        // Helper to format file size
        const formatSize = (bytes: number): string => {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        };
        
        const chatRows = chats.length > 0 ? chats.map(chat => {
            const filePath = this.storageService.getChatFilePath(chat.id) || '';
            const sourceFolder = filePath ? filePath.split(/[/\\]/).slice(-3, -1).join('/') : 'Unknown';
            return `
            <tr data-chatid="${chat.id}"
                data-workspace="${this.escapeHtml(chat.workspaceName)}" 
                data-date="${chat.updatedAt.toISOString().split('T')[0]}"
                data-messages="${chat.messageCount}"
                data-size="${chat.fileSize || 0}"
                data-filepath="${this.escapeHtml(filePath)}"
                data-searchtext="${this.escapeHtml((chat.workspaceName + ' ' + chat.firstMessage + ' ' + chat.lastMessage).toLowerCase())}">
                <td>${this.escapeHtml(chat.workspaceName)}</td>
                <td>${chat.messageCount}</td>
                <td>${formatSize(chat.fileSize || 0)}</td>
                <td>${chat.updatedAt.toLocaleString()}</td>
                <td class="source-cell" title="${this.escapeHtml(filePath)}">${this.escapeHtml(sourceFolder)}</td>
                <td class="message-cell" title="${this.escapeHtml(chat.firstMessage || '')}">${this.escapeHtml(chat.firstMessage || '-')}</td>
                <td class="word-counts-cell"></td>
                <td class="actions">
                    <button onclick="openChat('${chat.id}')">Open</button>
                    <button onclick="exportChat('${chat.id}')">Export</button>
                    <button onclick="deleteChat('${chat.id}')" class="danger">Delete</button>
                </td>
            </tr>`;
        }).join('') : `
            <tr>
                <td colspan="8" class="no-data">
                    <p>No chat histories found</p>
                    <p class="hint">Searched in: <code>${this.escapeHtml(storagePath)}</code></p>
                    <p class="hint">Looking for: <code>*/chatSessions/*.json</code></p>
                </td>
            </tr>
        `;

        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        h1 { color: var(--vscode-foreground); }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
        th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
        th { background: var(--vscode-editor-background); position: sticky; top: 0; }
        .message-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .actions { white-space: nowrap; }
        button { padding: 4px 8px; margin-right: 4px; cursor: pointer; font-size: 12px; }
        button.danger { background: var(--vscode-errorForeground); }
        .stats { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
        .stat { background: var(--vscode-editor-background); padding: 15px; border-radius: 8px; min-width: 100px; }
        .stat-value { font-size: 24px; font-weight: bold; }
        .stat-label { color: var(--vscode-descriptionForeground); }
        .storage-info { 
            background: var(--vscode-textBlockQuote-background); 
            padding: 12px 15px; 
            border-radius: 6px; 
            margin-bottom: 20px;
            border-left: 3px solid var(--vscode-textLink-foreground);
        }
        .storage-info code { 
            background: var(--vscode-textCodeBlock-background); 
            padding: 2px 6px; 
            border-radius: 3px;
            word-break: break-all;
        }
        .storage-info .label { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
        .storage-info .path { margin-top: 4px; }
        .scan-stats { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 8px; }
        .no-data { text-align: center; padding: 40px !important; color: var(--vscode-descriptionForeground); }
        .no-data p { margin: 8px 0; }
        .no-data .hint { font-size: 0.9em; }
        .no-data code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; }
        .actions-bar { margin-bottom: 15px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .actions-bar button { padding: 8px 16px; }
        .filter-bar { 
            background: var(--vscode-editor-background); 
            padding: 12px 15px; 
            border-radius: 6px; 
            margin-bottom: 15px;
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }
        .filter-group { display: flex; align-items: center; gap: 8px; }
        .filter-group label { color: var(--vscode-descriptionForeground); font-size: 13px; }
        .filter-group input, .filter-group select { 
            padding: 6px 10px; 
            border: 1px solid var(--vscode-input-border); 
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 13px;
        }
        .filter-group input[type="text"] { width: 200px; }
        .filter-group input[type="date"] { width: 140px; }
        .filter-results { font-size: 12px; color: var(--vscode-descriptionForeground); margin-left: auto; }
        .word-count-bar {
            background: var(--vscode-editor-background);
            padding: 12px 15px;
            border-radius: 6px;
            margin-bottom: 15px;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            align-items: center;
        }
        .word-count-item {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
        }
        .word-count-item .word { font-weight: bold; }
        .word-count-item .count { opacity: 0.8; margin-left: 4px; }
        .word-count-label { color: var(--vscode-descriptionForeground); font-size: 13px; }
        .word-count-badge {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 11px;
            margin-right: 4px;
        }
        .source-cell { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--vscode-descriptionForeground); }
        .word-counts-cell { min-width: 100px; }
    </style>
</head>
<body>
    <h1>Copilot Chat Manager</h1>
    
    <div class="storage-info">
        <div class="label">📁 Storage Location</div>
        <div class="path"><code>${this.escapeHtml(storagePath)}</code></div>
        <div class="scan-stats">
            Scanned ${scanStats.foldersScanned} workspace folders • 
            Found ${scanStats.chatsFound} chats
            ${(scanStats as any).skippedCached > 0 ? ` • ${(scanStats as any).skippedCached} from cache` : ''}
            ${(scanStats as any).skippedLarge > 0 ? ` • ${(scanStats as any).skippedLarge} skipped (too large)` : ''}
            ${scanStats.errors > 0 ? ` • ${scanStats.errors} errors` : ''}
        </div>
    </div>

    <div class="actions-bar">
        <button onclick="refresh()">🔄 Refresh</button>
        <button onclick="openSettings()">⚙️ Settings</button>
        <button onclick="exportAll()">📤 Export All</button>
        <button onclick="importChats()">📥 Import</button>
    </div>

    <div class="filter-bar">
        <div class="filter-group">
            <label>🔍 Search:</label>
            <input type="text" id="searchFilter" placeholder="minecraft shader xbox..." oninput="applyFilters()">
            <select id="searchMode" onchange="applyFilters()">
                <option value="any">Any word</option>
                <option value="all">All words</option>
                <option value="exact">Exact phrase</option>
            </select>
        </div>
        <div class="filter-group">
            <label>📅 From:</label>
            <input type="date" id="dateFrom" onchange="applyFilters()">
        </div>
        <div class="filter-group">
            <label>To:</label>
            <input type="date" id="dateTo" onchange="applyFilters()">
        </div>
        <div class="filter-group">
            <label>Workspace:</label>
            <select id="workspaceFilter" onchange="applyFilters()">
                <option value="">All Workspaces</option>
                ${[...new Set(chats.map(c => c.workspaceName))].sort().map(w => 
                    `<option value="${this.escapeHtml(w)}">${this.escapeHtml(w)}</option>`
                ).join('')}
            </select>
        </div>
        <button onclick="clearFilters()" style="padding: 6px 12px;">Clear</button>
        <div class="filter-results" id="filterResults">Showing ${chats.length} chats</div>
    </div>
    
    <div id="wordCountResults" class="word-count-bar" style="display:none;"></div>
    
    <div class="stats">
        <div class="stat">
            <div class="stat-value" id="statChats">${chats.length}</div>
            <div class="stat-label">Total Chats</div>
        </div>
        <div class="stat">
            <div class="stat-value" id="statMessages">${chats.reduce((sum, c) => sum + c.messageCount, 0)}</div>
            <div class="stat-label">Total Messages</div>
        </div>
        <div class="stat">
            <div class="stat-value" id="statWorkspaces">${new Set(chats.map(c => c.workspaceName)).size}</div>
            <div class="stat-label">Workspaces</div>
        </div>
        <div class="stat">
            <div class="stat-value" id="statSize">${formatSize(chats.reduce((sum, c) => sum + (c.fileSize || 0), 0))}</div>
            <div class="stat-label">Total Size</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Workspace</th>
                <th>Messages</th>
                <th>Size</th>
                <th>Last Updated</th>
                <th>Source</th>
                <th>First Message</th>
                <th>Word Counts</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody id="chatTableBody">
            ${chatRows}
        </tbody>
    </table>

    <script>
        const vscode = acquireVsCodeApi();
        let deepSearchResults = {};
        
        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'deepSearchResults') {
                deepSearchResults = {};
                message.results.forEach(r => {
                    deepSearchResults[r.chatId] = r;
                });
                updateWordCountsDisplay();
                applyFilters();
            }
        });
        
        function updateWordCountsDisplay() {
            const rows = document.querySelectorAll('#chatTableBody tr[data-chatid]');
            rows.forEach(row => {
                const chatId = row.getAttribute('data-chatid');
                const wordCountsCell = row.querySelector('.word-counts-cell');
                const result = deepSearchResults[chatId];
                
                if (result && result.wordCounts) {
                    const counts = Object.entries(result.wordCounts)
                        .filter(([word, count]) => count > 0)
                        .map(([word, count]) => '<span class="word-count-badge">' + word + ': ' + count + '</span>')
                        .join(' ');
                    wordCountsCell.innerHTML = counts || '-';
                    row.setAttribute('data-totalmatches', result.totalMatches);
                } else {
                    wordCountsCell.textContent = '-';
                    row.setAttribute('data-totalmatches', '0');
                }
            });
            
            // Sort table by total matches if we have search results
            if (Object.keys(deepSearchResults).length > 0) {
                sortTableByMatches();
            }
        }
        
        function sortTableByMatches() {
            const tbody = document.getElementById('chatTableBody');
            const rows = Array.from(tbody.querySelectorAll('tr[data-chatid]'));
            rows.sort((a, b) => {
                const aMatches = parseInt(a.getAttribute('data-totalmatches') || '0');
                const bMatches = parseInt(b.getAttribute('data-totalmatches') || '0');
                return bMatches - aMatches;
            });
            rows.forEach(row => tbody.appendChild(row));
        }
        
        function openChat(id) {
            vscode.postMessage({ command: 'openChat', chatId: id });
        }
        
        function exportChat(id) {
            vscode.postMessage({ command: 'exportChat', chatId: id });
        }
        
        function deleteChat(id) {
            vscode.postMessage({ command: 'deleteChat', chatId: id });
        }
        
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
        
        function openSettings() {
            vscode.postMessage({ command: 'openSettings' });
        }

        function exportAll() {
            vscode.postMessage({ command: 'exportAll' });
        }

        function importChats() {
            vscode.postMessage({ command: 'importChats' });
        }

        let searchTimeout = null;
        
        function applyFilters() {
            const searchText = document.getElementById('searchFilter').value.trim();
            const searchMode = document.getElementById('searchMode').value;
            const dateFrom = document.getElementById('dateFrom').value;
            const dateTo = document.getElementById('dateTo').value;
            const workspace = document.getElementById('workspaceFilter').value;
            
            // If there's search text, trigger deep search with debounce
            if (searchText.length >= 2) {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const terms = searchMode === 'exact' ? [searchText] : searchText.split(/\\s+/).filter(t => t.length > 0);
                    document.getElementById('wordCountResults').style.display = 'flex';
                    document.getElementById('wordCountResults').innerHTML = '<span class="word-count-label">🔍 Deep searching...</span>';
                    vscode.postMessage({ command: 'deepSearch', terms: terms, mode: searchMode });
                }, 500);
            } else {
                document.getElementById('wordCountResults').style.display = 'none';
                deepSearchResults = {};
                // Clear word counts
                document.querySelectorAll('.word-counts-cell').forEach(cell => cell.textContent = '-');
            }
            
            const rows = document.querySelectorAll('#chatTableBody tr[data-chatid]');
            let visibleCount = 0;
            let totalMessages = 0;
            let totalSize = 0;
            const workspaces = new Set();
            
            rows.forEach(row => {
                const rowWorkspace = row.getAttribute('data-workspace');
                const rowDate = row.getAttribute('data-date');
                const rowSearchText = row.getAttribute('data-searchtext');
                const rowMessages = parseInt(row.getAttribute('data-messages') || '0');
                const rowSize = parseInt(row.getAttribute('data-size') || '0');
                const chatId = row.getAttribute('data-chatid');
                
                let show = true;
                
                // If deep search is active, use those results
                if (searchText.length >= 2 && Object.keys(deepSearchResults).length > 0) {
                    show = !!deepSearchResults[chatId];
                } else if (searchText) {
                    // Fall back to basic search
                    show = rowSearchText.toLowerCase().includes(searchText.toLowerCase());
                }
                
                // Date from filter
                if (dateFrom && rowDate < dateFrom) {
                    show = false;
                }
                
                // Date to filter
                if (dateTo && rowDate > dateTo) {
                    show = false;
                }
                
                // Workspace filter
                if (workspace && rowWorkspace !== workspace) {
                    show = false;
                }
                
                row.style.display = show ? '' : 'none';
                
                if (show) {
                    visibleCount++;
                    totalMessages += rowMessages;
                    totalSize += rowSize;
                    workspaces.add(rowWorkspace);
                }
            });
            
            // Update word count summary bar
            if (Object.keys(deepSearchResults).length > 0) {
                const totalWordCounts = {};
                Object.values(deepSearchResults).forEach(r => {
                    Object.entries(r.wordCounts).forEach(([word, count]) => {
                        totalWordCounts[word] = (totalWordCounts[word] || 0) + count;
                    });
                });
                const summaryHtml = '<span class="word-count-label">📊 Total word counts:</span> ' + 
                    Object.entries(totalWordCounts)
                        .map(([word, count]) => '<span class="word-count-item"><span class="word">' + word + '</span><span class="count">×' + count + '</span></span>')
                        .join(' ');
                document.getElementById('wordCountResults').innerHTML = summaryHtml;
            }
            
            // Update stats
            document.getElementById('filterResults').textContent = 'Showing ' + visibleCount + ' of ${chats.length} chats';
            document.getElementById('statChats').textContent = visibleCount;
            document.getElementById('statMessages').textContent = totalMessages;
            document.getElementById('statWorkspaces').textContent = workspaces.size;
            document.getElementById('statSize').textContent = formatSizeJS(totalSize);
        }
        
        function clearFilters() {
            document.getElementById('searchFilter').value = '';
            document.getElementById('searchMode').value = 'any';
            document.getElementById('dateFrom').value = '';
            document.getElementById('dateTo').value = '';
            document.getElementById('workspaceFilter').value = '';
            document.getElementById('wordCountResults').style.display = 'none';
            deepSearchResults = {};
            document.querySelectorAll('.word-counts-cell').forEach(cell => cell.textContent = '-');
            applyFilters();
        }
        
        function formatSizeJS(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }
    </script>
</body>
</html>`;
    }

    /**
     * Escape HTML to prevent XSS
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Generate chat view HTML
     */
    private getChatViewHtml(chat: ChatHistory): string {
        const messages = chat.messages.map(msg => `
            <div class="message ${msg.role}">
                <div class="role">${msg.role === 'user' ? '👤 You' : '🤖 Copilot'}</div>
                <div class="content">${msg.content.replace(/\n/g, '<br>').replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')}</div>
                <div class="time">${new Date(msg.timestamp).toLocaleString()}</div>
            </div>
        `).join('');

        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; max-width: 800px; margin: 0 auto; }
        h1 { color: var(--vscode-foreground); }
        .meta { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
        .message { margin: 15px 0; padding: 15px; border-radius: 8px; }
        .message.user { background: var(--vscode-inputOption-activeBackground); }
        .message.assistant { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); }
        .role { font-weight: bold; margin-bottom: 8px; }
        .content { line-height: 1.6; }
        .time { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 8px; }
        pre { background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 4px; overflow-x: auto; }
        code { font-family: var(--vscode-editor-font-family); }
    </style>
</head>
<body>
    <h1>${chat.workspaceName}</h1>
    <div class="meta">
        Created: ${chat.createdAt.toLocaleString()} • 
        ${chat.messageCount} messages
    </div>
    ${messages}
</body>
</html>`;
    }
}
