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
                case 'getTopics':
                    const chatId = message.chatId as string;
                    const topics = await this.storageService.getTopTopics(chatId, 20);
                    panel.webview.postMessage({ 
                        command: 'topicsResult', 
                        chatId,
                        topics 
                    });
                    break;
                case 'getWordCloud':
                    // If chatIds provided, filter to those chats only
                    const wordCloud = await this.storageService.getGlobalWordCloud(50, message.chatIds);
                    panel.webview.postMessage({ 
                        command: 'wordCloudResult', 
                        wordCloud 
                    });
                    break;
                case 'expandWordCloud':
                    this.openExpandedWordCloud(message.data);
                    break;
            }
        });
    }

    /**
     * Open expanded word cloud view
     */
    private async openExpandedWordCloud(wordCloudData?: { word: string; count: number }[]): Promise<void> {
        // If no data passed, fetch fresh data
        const topics = wordCloudData || await this.storageService.getGlobalWordCloud(100);
        
        const panel = vscode.window.createWebviewPanel(
            'wordCloudExpanded',
            '🔥 Word Cloud - All Topics',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        
        panel.webview.html = this.getExpandedWordCloudHtml(topics);
    }

    /**
     * Generate expanded word cloud HTML
     */
    private getExpandedWordCloudHtml(topics: { word: string; count: number }[]): string {
        const topicsJson = JSON.stringify(topics);
        
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { 
            font-family: var(--vscode-font-family); 
            padding: 20px; 
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            margin: 0;
        }
        h1 { margin-bottom: 10px; }
        .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
        #wordCloudContainer {
            width: 100%;
            height: calc(100vh - 150px);
            min-height: 400px;
            background: var(--vscode-input-background);
            border-radius: 12px;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        #wordCloudContainer svg text {
            cursor: pointer;
            transition: opacity 0.2s;
        }
        #wordCloudContainer svg text:hover {
            opacity: 0.7;
        }
        .controls {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            align-items: center;
        }
        .controls button {
            padding: 6px 12px;
            cursor: pointer;
        }
        .controls label {
            color: var(--vscode-descriptionForeground);
        }
        .stats-bar {
            display: flex;
            gap: 20px;
            margin-bottom: 15px;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <h1>🔥 Word Cloud - Hot Topics</h1>
    <div class="subtitle">Click any word to copy it to clipboard</div>
    
    <div class="stats-bar">
        <span>📊 ${topics.length} unique topics</span>
        <span>🔝 Top word: <strong>${topics[0]?.word || 'N/A'}</strong> (${topics[0]?.count || 0} mentions)</span>
    </div>
    
    <div class="controls">
        <label>Max words:</label>
        <select id="maxWords" onchange="renderCloud()">
            <option value="30">30</option>
            <option value="50" selected>50</option>
            <option value="75">75</option>
            <option value="100">100</option>
        </select>
        <button onclick="renderCloud()">🔄 Refresh Layout</button>
    </div>
    
    <div id="wordCloudContainer">Loading...</div>
    
    <script>
        const allTopics = ${topicsJson};
        const vscode = acquireVsCodeApi();
        
        // Green color palette
        const colors = ['#00D084', '#00A86B', '#006B3C', '#228B22', '#32CD32', '#3CB371', '#2E8B57', '#00FA9A', '#7CFC00', '#ADFF2F'];
        
        function renderCloud() {
            const container = document.getElementById('wordCloudContainer');
            const maxWords = parseInt(document.getElementById('maxWords').value);
            const topics = allTopics.slice(0, maxWords);
            
            if (!topics || topics.length === 0) {
                container.innerHTML = '<span style="color: var(--vscode-descriptionForeground);">No topics found.</span>';
                return;
            }
            
            container.innerHTML = '';
            
            const width = container.clientWidth || 800;
            const height = container.clientHeight || 500;
            
            const maxCount = Math.max(...topics.map(t => t.count));
            const minCount = Math.min(...topics.map(t => t.count));
            const range = maxCount - minCount || 1;
            
            // Create SVG
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', width);
            svg.setAttribute('height', height);
            
            // Create words with calculated sizes
            const words = topics.map((topic, i) => {
                const normalizedCount = (topic.count - minCount) / range;
                const fontSize = Math.round(14 + normalizedCount * 50); // 14-64px range
                return {
                    text: topic.word,
                    count: topic.count,
                    size: fontSize,
                    color: colors[i % colors.length]
                };
            });
            
            // Sort by size descending for better layout
            words.sort((a, b) => b.size - a.size);
            
            // Spiral layout
            const centerX = width / 2;
            const centerY = height / 2;
            let angle = 0;
            let radius = 0;
            const placed = [];
            
            words.forEach((word, i) => {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('font-size', word.size);
                text.setAttribute('font-weight', word.size > 35 ? 'bold' : 'normal');
                text.setAttribute('fill', word.color);
                text.setAttribute('font-family', 'Arial Black, Arial, sans-serif');
                text.textContent = word.text;
                text.style.cursor = 'pointer';
                
                // Estimate dimensions
                const estWidth = word.text.length * word.size * 0.55;
                const estHeight = word.size;
                
                // Find position using spiral
                let x, y;
                let attempts = 0;
                let foundSpot = false;
                
                while (!foundSpot && attempts < 500) {
                    x = centerX + radius * Math.cos(angle) - estWidth / 2;
                    y = centerY + radius * Math.sin(angle) + estHeight / 3;
                    
                    // Check collision with placed words
                    let collision = false;
                    for (const p of placed) {
                        if (x < p.x + p.w + 5 && x + estWidth + 5 > p.x &&
                            y - estHeight < p.y && y > p.y - p.h) {
                            collision = true;
                            break;
                        }
                    }
                    
                    // Check bounds
                    if (x < 5 || x + estWidth > width - 5 || y - estHeight < 5 || y > height - 5) {
                        collision = true;
                    }
                    
                    if (!collision) {
                        foundSpot = true;
                        placed.push({ x, y, w: estWidth, h: estHeight });
                    } else {
                        angle += 0.5;
                        radius += 1.5;
                        attempts++;
                    }
                }
                
                if (foundSpot) {
                    text.setAttribute('x', x);
                    text.setAttribute('y', y);
                    
                    // Add tooltip
                    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                    title.textContent = word.text + ' (' + word.count + ' mentions)';
                    text.appendChild(title);
                    
                    text.onclick = () => {
                        navigator.clipboard.writeText(word.text);
                        vscode.postMessage({ command: 'showMessage', text: 'Copied: ' + word.text });
                    };
                    
                    svg.appendChild(text);
                }
            });
            
            container.appendChild(svg);
        }
        
        // Initial render after a brief delay for container to size
        setTimeout(renderCloud, 100);
        window.addEventListener('resize', renderCloud);
    </script>
</body>
</html>`;
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
            
            // Handle messages from the chat view
            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'exportChat':
                        await this.exportChatDirect(fullChat, message.format);
                        break;
                    case 'reloadChat':
                        // Reload the chat from disk
                        const reloadedChat = await this.storageService.reloadChatFromDisk(message.chatId);
                        if (reloadedChat) {
                            Object.assign(fullChat, reloadedChat);
                            panel.webview.html = this.getChatViewHtml(reloadedChat);
                            vscode.window.showInformationMessage('Chat reloaded from disk');
                        }
                        break;
                    case 'getTopics':
                        const topics = await this.storageService.getTopTopics(message.chatId, 10);
                        panel.webview.postMessage({ 
                            command: 'topicsResult', 
                            chatId: message.chatId,
                            topics 
                        });
                        break;
                    case 'showMessage':
                        vscode.window.showInformationMessage(message.text);
                        break;
                }
            });
        } else {
            panel.webview.html = this.getEmptyChatHtml(chatData);
        }
    }

    /**
     * Export chat directly with specified format (no prompt)
     */
    private async exportChatDirect(chat: ChatHistory, format: 'json' | 'markdown' | 'html' | 'vscode'): Promise<void> {
        const defaultPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const ext = format === 'markdown' ? 'md' : format === 'vscode' ? 'json' : format;
        const filename = `copilot-chat-${chat.workspaceName}-${Date.now()}.${ext}`;
        
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(defaultPath, filename)),
            filters: {
                [format === 'vscode' ? 'VS Code Chat JSON' : format.toUpperCase()]: [ext]
            }
        });

        if (uri) {
            await this.storageService.exportChats([chat], format, uri.fsPath);
            
            // Ask if user wants to open the exported file
            const message = format === 'vscode' 
                ? `Chat exported in VS Code format. Use "Chat: Import File" to import it.`
                : `Chat exported to ${uri.fsPath}`;
            const action = await vscode.window.showInformationMessage(
                message,
                'Open File',
                'Show in Explorer'
            );
            
            if (action === 'Open File') {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            } else if (action === 'Show in Explorer') {
                await vscode.commands.executeCommand('revealFileInOS', uri);
            }
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
            
            // Ask if user wants to open the exported file
            const action = await vscode.window.showInformationMessage(
                `Chat exported to ${uri.fsPath}`,
                'Open File',
                'Show in Explorer'
            );
            
            if (action === 'Open File') {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            } else if (action === 'Show in Explorer') {
                await vscode.commands.executeCommand('revealFileInOS', uri);
            }
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
            
            // Ask if user wants to open the exported file
            const action = await vscode.window.showInformationMessage(
                `${chats.length} chats exported to ${uri.fsPath}`,
                'Open File',
                'Show in Explorer'
            );
            
            if (action === 'Open File') {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            } else if (action === 'Show in Explorer') {
                await vscode.commands.executeCommand('revealFileInOS', uri);
            }
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
                <td class="topics-cell" data-chatid-topics="${chat.id}"><span class="topic-pill">...</span></td>
                <td class="word-counts-cell"></td>
                <td class="actions">
                    <button onclick="openChat('${chat.id}')">Open</button>
                    <button onclick="exportChat('${chat.id}')">Export</button>
                    <button onclick="deleteChat('${chat.id}')" class="danger">Delete</button>
                </td>
            </tr>`;
        }).join('') : `
            <tr>
                <td colspan="9" class="no-data">
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
        th { background: var(--vscode-editor-background); position: sticky; top: 0; cursor: pointer; user-select: none; }
        th:hover { background: var(--vscode-list-hoverBackground); }
        th .sort-indicator { margin-left: 4px; opacity: 0.5; }
        th.sorted .sort-indicator { opacity: 1; }
        th:last-child { cursor: default; }
        th:last-child:hover { background: var(--vscode-editor-background); }
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
        .word-cloud-section {
            background: var(--vscode-editor-background);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
        }
        .word-cloud-section h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: var(--vscode-foreground);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .word-cloud-section h3 button {
            font-size: 11px;
            padding: 3px 8px;
            cursor: pointer;
        }
        .word-cloud {
            width: 100%;
            height: 180px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 40px;
        }
        .word-tag {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            cursor: pointer;
            transition: transform 0.2s, opacity 0.2s;
        }
        .word-tag:hover {
            transform: scale(1.05);
            opacity: 0.9;
        }
        .word-tag.size-1 { font-size: 11px; opacity: 0.7; }
        .word-tag.size-2 { font-size: 12px; opacity: 0.8; }
        .word-tag.size-3 { font-size: 13px; opacity: 0.85; }
        .word-tag.size-4 { font-size: 14px; font-weight: 500; }
        .word-tag.size-5 { font-size: 16px; font-weight: bold; }
        .word-tag .count { margin-left: 4px; font-size: 10px; opacity: 0.7; }
        .topics-cell { display: flex; gap: 4px; flex-wrap: wrap; }
        .topic-pill {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 10px;
            white-space: nowrap;
        }
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
        <button onclick="exportAll()" title="Export all chats as JSON (can be re-imported)">📤 Export All (JSON)</button>
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

    <div class="word-cloud-section">
        <h3>🔥 Hot Topics Across All Chats <button onclick="expandWordCloud()">🔍 Expand</button></h3>
        <div id="globalWordCloud" class="word-cloud">Loading word cloud...</div>
    </div>

    <table>
        <thead>
            <tr>
                <th onclick="sortTable('workspace')" data-sort="workspace">Workspace <span class="sort-indicator">⇅</span></th>
                <th onclick="sortTable('messages')" data-sort="messages">Messages <span class="sort-indicator">⇅</span></th>
                <th onclick="sortTable('size')" data-sort="size">Size <span class="sort-indicator">⇅</span></th>
                <th onclick="sortTable('date')" data-sort="date">Last Updated <span class="sort-indicator">⇅</span></th>
                <th onclick="sortTable('source')" data-sort="source">Source <span class="sort-indicator">⇅</span></th>
                <th onclick="sortTable('firstmsg')" data-sort="firstmsg">First Message <span class="sort-indicator">⇅</span></th>
                <th>Topics</th>
                <th onclick="sortTable('matches')" data-sort="matches">Word Counts <span class="sort-indicator">⇅</span></th>
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
        
        // Single message listener for all events
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('Received message:', message.command);
            
            switch (message.command) {
                case 'deepSearchResults':
                    deepSearchResults = {};
                    message.results.forEach(r => {
                        deepSearchResults[r.chatId] = r;
                    });
                    updateWordCountsDisplay();
                    applyFilters();
                    break;
                case 'wordCloudResult':
                    renderWordCloud(message.wordCloud);
                    break;
                case 'topicsResult':
                    renderTopicsForChat(message.chatId, message.topics);
                    break;
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
            
            // Refresh word cloud with filtered results
            refreshWordCloudForFiltered();
        }
        
        function refreshWordCloudForFiltered() {
            const rows = document.querySelectorAll('#chatTableBody tr[data-chatid]');
            const visibleChatIds = [];
            rows.forEach(row => {
                if (row.style.display !== 'none') {
                    visibleChatIds.push(row.getAttribute('data-chatid'));
                }
            });
            // Request word cloud for visible chats only
            vscode.postMessage({ command: 'getWordCloud', chatIds: visibleChatIds });
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
        
        // Column sorting
        let currentSort = { column: 'date', direction: 'desc' };
        
        function sortTable(column) {
            const tbody = document.getElementById('chatTableBody');
            const rows = Array.from(tbody.querySelectorAll('tr[data-chatid]'));
            
            // Toggle direction if same column
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = column === 'date' ? 'desc' : 'asc';
            }
            
            // Update header indicators
            document.querySelectorAll('th').forEach(th => {
                th.classList.remove('sorted');
                const indicator = th.querySelector('.sort-indicator');
                if (indicator) indicator.textContent = '⇅';
            });
            const th = document.querySelector('th[data-sort="' + column + '"]');
            if (th) {
                th.classList.add('sorted');
                const indicator = th.querySelector('.sort-indicator');
                if (indicator) indicator.textContent = currentSort.direction === 'asc' ? '↑' : '↓';
            }
            
            rows.sort((a, b) => {
                let aVal, bVal;
                switch (column) {
                    case 'workspace':
                        aVal = a.getAttribute('data-workspace').toLowerCase();
                        bVal = b.getAttribute('data-workspace').toLowerCase();
                        break;
                    case 'messages':
                        aVal = parseInt(a.getAttribute('data-messages') || '0');
                        bVal = parseInt(b.getAttribute('data-messages') || '0');
                        break;
                    case 'size':
                        aVal = parseInt(a.getAttribute('data-size') || '0');
                        bVal = parseInt(b.getAttribute('data-size') || '0');
                        break;
                    case 'date':
                        aVal = a.getAttribute('data-date');
                        bVal = b.getAttribute('data-date');
                        break;
                    case 'source':
                        aVal = a.querySelector('.source-cell')?.textContent.toLowerCase() || '';
                        bVal = b.querySelector('.source-cell')?.textContent.toLowerCase() || '';
                        break;
                    case 'firstmsg':
                        aVal = a.querySelector('.message-cell')?.textContent.toLowerCase() || '';
                        bVal = b.querySelector('.message-cell')?.textContent.toLowerCase() || '';
                        break;
                    case 'matches':
                        aVal = parseInt(a.getAttribute('data-totalmatches') || '0');
                        bVal = parseInt(b.getAttribute('data-totalmatches') || '0');
                        break;
                    default:
                        aVal = '';
                        bVal = '';
                }
                
                let result = 0;
                if (typeof aVal === 'number') {
                    result = aVal - bVal;
                } else {
                    result = aVal.localeCompare(bVal);
                }
                
                return currentSort.direction === 'asc' ? result : -result;
            });
            
            rows.forEach(row => tbody.appendChild(row));
        }
        
        // Load global word cloud on page load
        function loadWordCloud() {
            vscode.postMessage({ command: 'getWordCloud' });
        }
        
        // Load topics for all chats
        function loadTopics() {
            const rows = document.querySelectorAll('[data-chatid-topics]');
            rows.forEach(cell => {
                const chatId = cell.getAttribute('data-chatid-topics');
                vscode.postMessage({ command: 'getTopics', chatId: chatId });
            });
        }
        
        // Store word cloud data globally for expand feature
        let globalWordCloudData = [];
        
        function renderWordCloud(topics) {
            const container = document.getElementById('globalWordCloud');
            if (!topics || topics.length === 0) {
                container.innerHTML = '<span style="color: var(--vscode-descriptionForeground);">No topics extracted yet. Scanning chats...</span>';
                return;
            }
            
            globalWordCloudData = topics;
            
            // Clear container
            container.innerHTML = '';
            
            const width = container.clientWidth || 600;
            const height = 180;
            
            // Calculate font sizes based on count
            const maxCount = Math.max(...topics.map(t => t.count));
            const minCount = Math.min(...topics.map(t => t.count));
            const range = maxCount - minCount || 1;
            
            // Create SVG
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', width);
            svg.setAttribute('height', height);
            svg.style.cursor = 'pointer';
            
            // Green color palette
            const colors = ['#00D084', '#00A86B', '#006B3C', '#228B22', '#32CD32', '#3CB371', '#2E8B57', '#00FA9A'];
            
            // Simple spiral layout for words
            const words = topics.slice(0, 30).map((topic, i) => {
                const normalizedCount = (topic.count - minCount) / range;
                const fontSize = Math.round(12 + normalizedCount * 28); // 12-40px range
                return {
                    text: topic.word,
                    count: topic.count,
                    size: fontSize,
                    color: colors[i % colors.length]
                };
            });
            
            // Position words in a flowing layout
            let x = 10;
            let y = 30;
            let rowHeight = 0;
            
            words.forEach((word, i) => {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('font-size', word.size);
                text.setAttribute('font-weight', word.size > 25 ? 'bold' : 'normal');
                text.setAttribute('fill', word.color);
                text.setAttribute('font-family', 'Arial, sans-serif');
                text.textContent = word.text;
                text.style.cursor = 'pointer';
                text.onclick = () => searchForWord(word.text);
                
                // Estimate text width
                const estimatedWidth = word.text.length * word.size * 0.6;
                
                if (x + estimatedWidth > width - 20) {
                    x = 10;
                    y += rowHeight + 8;
                    rowHeight = 0;
                }
                
                text.setAttribute('x', x);
                text.setAttribute('y', y);
                
                // Add title for hover
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = word.text + ' (' + word.count + ' mentions)';
                text.appendChild(title);
                
                svg.appendChild(text);
                
                x += estimatedWidth + 15;
                rowHeight = Math.max(rowHeight, word.size);
            });
            
            container.appendChild(svg);
        }
        
        function expandWordCloud() {
            vscode.postMessage({ command: 'expandWordCloud', data: globalWordCloudData });
        }
        
        function renderTopicsForChat(chatId, topics) {
            const cell = document.querySelector('[data-chatid-topics="' + chatId + '"]');
            if (!cell) return;
            
            if (!topics || topics.length === 0) {
                cell.innerHTML = '<span style="opacity: 0.5;">-</span>';
                return;
            }
            
            const html = topics.slice(0, 3).map(topic => 
                '<span class="topic-pill">' + topic.word + '</span>'
            ).join('');
            cell.innerHTML = html;
        }
        
        function searchForWord(word) {
            document.getElementById('searchFilter').value = word;
            document.getElementById('searchMode').value = 'any';
            applyFilters();
        }
        
        // Initialize on page load
        setTimeout(() => {
            loadWordCloud();
            loadTopics();
        }, 500);
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
        body { font-family: var(--vscode-font-family); padding: 20px; max-width: 900px; margin: 0 auto; }
        h1 { color: var(--vscode-foreground); margin-bottom: 10px; }
        .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; flex-wrap: wrap; gap: 15px; }
        .header-left { flex: 1; }
        .header-right { display: flex; gap: 10px; flex-wrap: wrap; }
        .meta { color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
        .actions-bar { display: flex; gap: 8px; flex-wrap: wrap; }
        .actions-bar button { padding: 6px 12px; cursor: pointer; border: none; border-radius: 4px; font-size: 12px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .actions-bar button:hover { opacity: 0.9; }
        .actions-bar button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .word-cloud-section { background: var(--vscode-editor-background); border-radius: 8px; padding: 15px; margin-bottom: 20px; }
        .word-cloud-section h3 { margin: 0 0 12px 0; font-size: 14px; color: var(--vscode-foreground); }
        #chatWordCloud { width: 100%; height: 200px; display: flex; justify-content: center; align-items: center; }
        #chatWordCloud svg text { cursor: pointer; transition: opacity 0.2s; }
        #chatWordCloud svg text:hover { opacity: 0.7; }
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
    <div class="header-row">
        <div class="header-left">
            <h1>${this.escapeHtml(chat.workspaceName)}</h1>
            <div class="meta">
                Created: ${chat.createdAt.toLocaleString()} • 
                Updated: ${chat.updatedAt.toLocaleString()} • 
                ${chat.messageCount} messages
            </div>
        </div>
        <div class="header-right">
            <div class="actions-bar">
                <button onclick="reloadChat()" title="Reload this chat from disk">🔄 Reload</button>
                <button onclick="exportAs('json')" class="primary" title="Can be re-imported via ACCM Import">📤 Export JSON (ACCM)</button>
                <button onclick="exportAs('vscode')" class="secondary" title="Can be imported via Chat: Import File">📤 Export for VS Code</button>
                <button onclick="exportAs('markdown')" title="Human-readable format">📝 Export Markdown</button>
                <button onclick="exportAs('html')" title="View in browser">🌐 Export HTML</button>
                <button onclick="copyToClipboard()">📋 Copy All</button>
            </div>
        </div>
    </div>
    
    <div class="word-cloud-section">
        <h3>🔥 Topics in this Chat</h3>
        <div id="chatWordCloud">Loading word cloud...</div>
    </div>
    
    ${messages}
    
    <script>
        const vscode = acquireVsCodeApi();
        const chatId = '${chat.id}';
        
        // Green color palette
        const colors = ['#00D084', '#00A86B', '#006B3C', '#228B22', '#32CD32', '#3CB371', '#2E8B57', '#00FA9A'];
        
        function exportAs(format) {
            vscode.postMessage({ command: 'exportChat', chatId: chatId, format: format });
        }
        
        function copyToClipboard() {
            const content = document.body.innerText;
            navigator.clipboard.writeText(content).then(() => {
                vscode.postMessage({ command: 'showMessage', text: 'Chat content copied to clipboard!' });
            });
        }
        
        function reloadChat() {
            vscode.postMessage({ command: 'reloadChat', chatId: chatId });
        }
        
        // Request topics on load
        vscode.postMessage({ command: 'getTopics', chatId: chatId });
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'topicsResult' && message.chatId === chatId) {
                renderChatWordCloud(message.topics);
            }
        });
        
        function renderChatWordCloud(topics) {
            const container = document.getElementById('chatWordCloud');
            
            if (!topics || topics.length === 0) {
                container.innerHTML = '<span style="color: var(--vscode-descriptionForeground);">No significant topics found in this chat.</span>';
                return;
            }
            
            container.innerHTML = '';
            
            const width = container.clientWidth || 600;
            const height = 200;
            
            const maxCount = Math.max(...topics.map(t => t.count));
            const minCount = Math.min(...topics.map(t => t.count));
            const range = maxCount - minCount || 1;
            
            // Create SVG
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', width);
            svg.setAttribute('height', height);
            
            // Create words with sizes
            const words = topics.slice(0, 20).map((topic, i) => {
                const normalizedCount = (topic.count - minCount) / range;
                const fontSize = Math.round(14 + normalizedCount * 36); // 14-50px
                return {
                    text: topic.word,
                    count: topic.count,
                    size: fontSize,
                    color: colors[i % colors.length]
                };
            });
            
            // Sort by size for better layout
            words.sort((a, b) => b.size - a.size);
            
            // Simple spiral layout
            const centerX = width / 2;
            const centerY = height / 2;
            let angle = 0;
            let radius = 0;
            const placed = [];
            
            words.forEach((word) => {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('font-size', word.size);
                text.setAttribute('font-weight', word.size > 30 ? 'bold' : 'normal');
                text.setAttribute('fill', word.color);
                text.setAttribute('font-family', 'Arial Black, Arial, sans-serif');
                text.textContent = word.text;
                text.style.cursor = 'pointer';
                
                const estWidth = word.text.length * word.size * 0.55;
                const estHeight = word.size;
                
                let x, y;
                let attempts = 0;
                let foundSpot = false;
                
                while (!foundSpot && attempts < 300) {
                    x = centerX + radius * Math.cos(angle) - estWidth / 2;
                    y = centerY + radius * Math.sin(angle) + estHeight / 3;
                    
                    let collision = false;
                    for (const p of placed) {
                        if (x < p.x + p.w + 5 && x + estWidth + 5 > p.x &&
                            y - estHeight < p.y && y > p.y - p.h) {
                            collision = true;
                            break;
                        }
                    }
                    
                    if (x < 5 || x + estWidth > width - 5 || y - estHeight < 5 || y > height - 5) {
                        collision = true;
                    }
                    
                    if (!collision) {
                        foundSpot = true;
                        placed.push({ x, y, w: estWidth, h: estHeight });
                    } else {
                        angle += 0.6;
                        radius += 2;
                        attempts++;
                    }
                }
                
                if (foundSpot) {
                    text.setAttribute('x', x);
                    text.setAttribute('y', y);
                    
                    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                    title.textContent = word.text + ' (' + word.count + ' times)';
                    text.appendChild(title);
                    
                    text.onclick = () => {
                        navigator.clipboard.writeText(word.text);
                        vscode.postMessage({ command: 'showMessage', text: 'Copied: ' + word.text });
                    };
                    
                    svg.appendChild(text);
                }
            });
            
            container.appendChild(svg);
        }
    </script>
</body>
</html>`;
    }
}
