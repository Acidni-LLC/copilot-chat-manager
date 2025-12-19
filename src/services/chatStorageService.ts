/**
 * Chat Storage Service
 * Handles reading and writing Copilot chat histories from VS Code's storage
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * - Partial file reading: Only reads first 4KB to extract metadata
 * - Parallel I/O: Processes files concurrently with limited parallelism
 * - Modification time caching: Skips unchanged files on re-scan
 * - Index persistence: Caches metadata to avoid re-parsing
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatHistory, ChatMessage, ChatExport, ImportResult } from '../models/chatHistory';

// Performance constants
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const METADATA_READ_BYTES = 4096; // Read only first 4KB for metadata
const MAX_PARALLEL_READS = 10; // Limit concurrent file operations
const MAX_MESSAGE_PREVIEW_LENGTH = 200;

interface CachedChatMeta {
    id: string;
    filePath: string;
    mtime: number;
    size: number;
    chat: ChatHistory;
}

export class ChatStorageService {
    private static instance: ChatStorageService;
    private context: vscode.ExtensionContext;
    private cachedChats: Map<string, ChatHistory> = new Map();
    private chatFilePaths: Map<string, string> = new Map();
    private fileMetaCache: Map<string, CachedChatMeta> = new Map(); // Indexed by filePath
    private _storagePath: string = '';
    private _scanStats = { foldersScanned: 0, chatsFound: 0, errors: 0, skippedLarge: 0, skippedCached: 0 };
    private _lastScanTime: number = 0;
    private _scanInProgress: boolean = false;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadIndexFromStorage();
    }

    public static getInstance(context?: vscode.ExtensionContext): ChatStorageService {
        if (!ChatStorageService.instance) {
            if (!context) {
                throw new Error('ChatStorageService must be initialized with context first');
            }
            ChatStorageService.instance = new ChatStorageService(context);
        }
        return ChatStorageService.instance;
    }

    /**
     * Load cached index from extension storage
     */
    private loadIndexFromStorage(): void {
        try {
            const cached = this.context.globalState.get<CachedChatMeta[]>('chatMetaCache');
            if (cached) {
                for (const meta of cached) {
                    this.fileMetaCache.set(meta.filePath, meta);
                    // Also restore chatFilePaths and cachedChats for lazy loading to work
                    if (meta.chat) {
                        this.chatFilePaths.set(meta.chat.id, meta.filePath);
                        this.cachedChats.set(meta.chat.id, meta.chat);
                    }
                }
                console.log(`[ChatStorageService] Loaded ${cached.length} entries from cache`);
            }
        } catch (e) {
            console.log('[ChatStorageService] No cache found or cache invalid');
        }
    }

    /**
     * Save index to extension storage
     */
    private async saveIndexToStorage(): Promise<void> {
        const cacheArray = Array.from(this.fileMetaCache.values());
        await this.context.globalState.update('chatMetaCache', cacheArray);
    }

    public getCopilotChatStoragePath(): string {
        const config = vscode.workspace.getConfiguration('copilotChatManager');
        const customPath = config.get<string>('storagePath', '');
        
        if (customPath && fs.existsSync(customPath)) {
            this._storagePath = customPath;
            return customPath;
        }
        
        const userDataPath = this.getUserDataPath();
        this._storagePath = path.join(userDataPath, 'workspaceStorage');
        return this._storagePath;
    }

    public getStoragePathDisplay(): string {
        return this._storagePath || this.getCopilotChatStoragePath();
    }

    public getScanStats(): { foldersScanned: number; chatsFound: number; errors: number; skippedLarge: number; skippedCached: number } {
        return { ...this._scanStats };
    }

    private getUserDataPath(): string {
        if (process.platform === 'win32') {
            const appData = process.env.APPDATA;
            if (appData) {
                return path.join(appData, 'Code', 'User');
            }
            const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
            return path.join(userProfile, 'AppData', 'Roaming', 'Code', 'User');
        } else if (process.platform === 'darwin') {
            const home = process.env.HOME || '/Users/default';
            return path.join(home, 'Library', 'Application Support', 'Code', 'User');
        } else {
            const home = process.env.HOME || '/home/default';
            return path.join(home, '.config', 'Code', 'User');
        }
    }

    /**
     * Ultra-fast scan using parallel I/O, partial reads, and caching
     */
    public async scanAllChatHistories(forceRefresh: boolean = false): Promise<ChatHistory[]> {
        if (this._scanInProgress) {
            return this.getAllChats();
        }

        // Use memory cache if very recent
        const cacheAge = Date.now() - this._lastScanTime;
        if (!forceRefresh && cacheAge < 30000 && this.cachedChats.size > 0) {
            return this.getAllChats();
        }

        this._scanInProgress = true;
        const startTime = Date.now();
        const workspaceStoragePath = this.getCopilotChatStoragePath();
        this._scanStats = { foldersScanned: 0, chatsFound: 0, errors: 0, skippedLarge: 0, skippedCached: 0 };

        console.log(`[ChatStorageService] Fast scan starting: ${workspaceStoragePath}`);

        try {
            if (!fs.existsSync(workspaceStoragePath)) {
                return [];
            }

            // Collect all file paths first (fast directory traversal)
            const filesToProcess: { filePath: string; workspaceId: string; stats: fs.Stats }[] = [];
            const workspaceDirs = fs.readdirSync(workspaceStoragePath);
            
            for (const workspaceDir of workspaceDirs) {
                const chatSessionsPath = path.join(workspaceStoragePath, workspaceDir, 'chatSessions');
                if (!fs.existsSync(chatSessionsPath)) continue;
                
                this._scanStats.foldersScanned++;
                const files = fs.readdirSync(chatSessionsPath);
                
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    const filePath = path.join(chatSessionsPath, file);
                    const stats = fs.statSync(filePath);
                    
                    if (stats.size > MAX_FILE_SIZE_BYTES) {
                        this._scanStats.skippedLarge++;
                        continue;
                    }
                    
                    filesToProcess.push({ filePath, workspaceId: workspaceDir, stats });
                }
            }

            // Process files in parallel batches
            const chats: ChatHistory[] = [];
            for (let i = 0; i < filesToProcess.length; i += MAX_PARALLEL_READS) {
                const batch = filesToProcess.slice(i, i + MAX_PARALLEL_READS);
                const results = await Promise.all(
                    batch.map(({ filePath, workspaceId, stats }) => 
                        this.processFileFast(filePath, workspaceId, stats)
                    )
                );
                chats.push(...results.filter((c): c is ChatHistory => c !== null));
            }

            // Update caches
            this.cachedChats.clear();
            for (const chat of chats) {
                this.cachedChats.set(chat.id, chat);
            }

            this._scanStats.chatsFound = chats.length;
            this._lastScanTime = Date.now();
            
            // Save index in background
            this.saveIndexToStorage();

            const elapsed = Date.now() - startTime;
            console.log(`[ChatStorageService] Scan complete in ${elapsed}ms: ${chats.length} chats, ${this._scanStats.skippedCached} from cache`);

            return chats;

        } catch (error) {
            console.error('[ChatStorageService] Scan error:', error);
            this._scanStats.errors++;
            return this.getAllChats();
        } finally {
            this._scanInProgress = false;
        }
    }

    /**
     * Process a single file - use cache if unchanged, else partial read
     */
    private async processFileFast(filePath: string, workspaceId: string, stats: fs.Stats): Promise<ChatHistory | null> {
        // Check if we have valid cached data
        const cached = this.fileMetaCache.get(filePath);
        if (cached && cached.mtime === stats.mtimeMs && cached.size === stats.size) {
            this._scanStats.skippedCached++;
            this.chatFilePaths.set(cached.chat.id, filePath);
            return cached.chat;
        }

        // Need to read file - use partial read for speed
        const chat = await this.parseMetadataFast(filePath, workspaceId, stats.size);
        
        if (chat) {
            // Update cache
            this.fileMetaCache.set(filePath, {
                id: chat.id,
                filePath,
                mtime: stats.mtimeMs,
                size: stats.size,
                chat
            });
            this.chatFilePaths.set(chat.id, filePath);
        }
        
        return chat;
    }

    /**
     * Fast metadata extraction - reads only what's needed
     */
    private async parseMetadataFast(filePath: string, workspaceId: string, fileSize: number): Promise<ChatHistory | null> {
        try {
            // For small files, read entire content; for larger files, read partial
            const readSize = Math.min(fileSize, METADATA_READ_BYTES * 4); // Read up to 16KB
            
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(readSize);
            fs.readSync(fd, buffer, 0, readSize, 0);
            fs.closeSync(fd);
            
            let content = buffer.toString('utf-8');
            
            // Try to parse - if file is truncated, we need to read more
            let data: any;
            try {
                data = JSON.parse(content);
            } catch {
                // Partial read didn't get valid JSON - read full file
                content = fs.readFileSync(filePath, 'utf-8');
                data = JSON.parse(content);
            }

            if (!data.requests || data.requests.length === 0) {
                return null;
            }

            const workspaceName = this.getWorkspaceName(workspaceId);
            const requestCount = data.requests.length;
            
            // Get first and last message previews
            const firstRequest = data.requests[0];
            const lastRequest = data.requests[requestCount - 1];
            
            const firstMessage = this.truncateText(firstRequest?.message?.text || '', MAX_MESSAGE_PREVIEW_LENGTH);
            const lastMessage = this.truncateText(lastRequest?.message?.text || '', MAX_MESSAGE_PREVIEW_LENGTH);
            const modelInfo = data.selectedModel?.metadata?.name || 'Unknown';

            return {
                id: data.sessionId || path.basename(filePath, '.json'),
                workspacePath: workspaceId,
                workspaceName,
                createdAt: new Date(data.creationDate || Date.now()),
                updatedAt: new Date(data.lastMessageDate || Date.now()),
                firstMessage,
                lastMessage,
                messageCount: requestCount * 2,
                fileSize,
                messages: [],
                tags: [modelInfo],
                attachedProject: null
            };
        } catch (error) {
            this._scanStats.errors++;
            return null;
        }
    }

    private truncateText(text: string, maxLength: number): string {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    /**
     * Load full messages for a specific chat (lazy loading on demand)
     */
    public async loadFullChat(chatId: string): Promise<ChatHistory | null> {
        const filePath = this.chatFilePaths.get(chatId);
        if (!filePath) {
            return this.cachedChats.get(chatId) || null;
        }

        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            
            const messages: ChatMessage[] = [];
            for (const request of data.requests || []) {
                if (request.message?.text) {
                    messages.push({
                        id: this.generateId(),
                        role: 'user',
                        content: request.message.text,
                        timestamp: new Date(request.message.timestamp || data.creationDate || Date.now())
                    });
                }
                
                const responseText = this.extractResponseText(request);
                if (responseText) {
                    messages.push({
                        id: this.generateId(),
                        role: 'assistant',
                        content: responseText,
                        timestamp: new Date(request.responseCompleteDate || data.lastMessageDate || Date.now())
                    });
                }
            }

            const chat = this.cachedChats.get(chatId);
            if (chat) {
                chat.messages = messages;
                chat.messageCount = messages.length;
            }
            return chat || null;
        } catch (error) {
            console.error(`[ChatStorageService] Error loading full chat ${chatId}:`, error);
            return null;
        }
    }

    /**
     * Extract response text from various response formats
     */
    private extractResponseText(request: any): string {
        // Try different response formats used by Copilot
        if (request.response?.value) {
            return request.response.value;
        }
        if (request.response?.result?.value) {
            return request.response.result.value;
        }
        if (request.result?.value) {
            return request.result.value;
        }
        // Sometimes response is stored as markdown parts
        if (request.response?.result?.content) {
            const content = request.response.result.content;
            if (Array.isArray(content)) {
                return content.map((part: any) => part.value || part.text || '').join('\n');
            }
            return content;
        }
        return '';
    }

    /**
     * Get workspace name from workspace.json
     */
    private getWorkspaceName(workspaceId: string): string {
        try {
            const workspaceStoragePath = this.getCopilotChatStoragePath();
            const workspaceJsonPath = path.join(workspaceStoragePath, workspaceId, 'workspace.json');
            
            if (fs.existsSync(workspaceJsonPath)) {
                const data = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'));
                if (data.folder) {
                    // Handle both file:// URIs and plain paths
                    const folderPath = data.folder.replace(/^file:\/\/\//, '').replace(/%20/g, ' ');
                    return path.basename(folderPath);
                }
                if (data.workspace) {
                    const workspacePath = data.workspace.replace(/^file:\/\/\//, '').replace(/%20/g, ' ');
                    return path.basename(workspacePath, '.code-workspace');
                }
            }
        } catch {
            // Ignore errors
        }
        return `Workspace ${workspaceId.substring(0, 8)}`;
    }

    /**
     * Get a specific chat by ID
     */
    public getChatById(id: string): ChatHistory | undefined {
        return this.cachedChats.get(id);
    }

    /**
     * Get all cached chats
     */
    public getAllChats(): ChatHistory[] {
        return Array.from(this.cachedChats.values());
    }

    /**
     * Get chats grouped by workspace
     */
    public getChatsByWorkspace(): Map<string, ChatHistory[]> {
        const grouped = new Map<string, ChatHistory[]>();
        
        for (const chat of this.cachedChats.values()) {
            const key = chat.workspaceName;
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key)!.push(chat);
        }
        
        return grouped;
    }

    /**
     * Export chats to file
     */
    public async exportChats(
        chats: ChatHistory[], 
        format: 'json' | 'markdown' | 'html',
        outputPath: string
    ): Promise<void> {
        let content: string;

        switch (format) {
            case 'markdown':
                content = this.convertToMarkdown(chats);
                break;
            case 'html':
                content = this.convertToHtml(chats);
                break;
            case 'json':
            default:
                const exportData: ChatExport = {
                    version: '1.0',
                    exportedAt: new Date(),
                    sourceExtension: 'copilot-chat-manager',
                    chats: chats
                };
                content = JSON.stringify(exportData, null, 2);
                break;
        }

        await fs.promises.writeFile(outputPath, content, 'utf-8');
    }

    /**
     * Import chats from file
     */
    public async importChats(filePath: string): Promise<ImportResult> {
        const result: ImportResult = {
            success: false,
            importedCount: 0,
            skippedCount: 0,
            errors: []
        };

        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);

            // Check if this is our export format (has chats array)
            if (data.chats && Array.isArray(data.chats)) {
                for (const chat of data.chats) {
                    if (this.cachedChats.has(chat.id)) {
                        result.skippedCount++;
                    } else {
                        // Convert dates back from strings
                        chat.createdAt = new Date(chat.createdAt);
                        chat.updatedAt = new Date(chat.updatedAt);
                        chat.messages = chat.messages.map((m: any) => ({
                            ...m,
                            timestamp: new Date(m.timestamp)
                        }));
                        
                        this.cachedChats.set(chat.id, chat);
                        result.importedCount++;
                    }
                }
            }
            // Check if this is native VS Code Copilot chat format (has sessionId and requests)
            else if (data.sessionId && data.requests) {
                const chat = this.convertNativeCopilotChat(data, filePath);
                if (chat) {
                    if (this.cachedChats.has(chat.id)) {
                        result.skippedCount++;
                    } else {
                        this.cachedChats.set(chat.id, chat);
                        this.chatFilePaths.set(chat.id, filePath);
                        result.importedCount++;
                    }
                } else {
                    result.errors.push('Could not parse native Copilot chat format');
                }
            }
            else {
                result.errors.push('Invalid chat session data - not a recognized format');
                return result;
            }

            result.success = result.importedCount > 0 || result.skippedCount > 0;
        } catch (error: any) {
            result.errors.push(error.message);
        }

        return result;
    }

    /**
     * Convert native VS Code Copilot chat format to our ChatHistory format
     */
    private convertNativeCopilotChat(data: any, filePath: string): ChatHistory | null {
        try {
            if (!data.requests || data.requests.length === 0) {
                return null;
            }

            const messages: ChatMessage[] = [];
            for (const request of data.requests) {
                if (request.message?.text) {
                    messages.push({
                        id: this.generateId(),
                        role: 'user',
                        content: request.message.text,
                        timestamp: new Date(request.message.timestamp || data.creationDate || Date.now())
                    });
                }
                
                const responseText = this.extractResponseText(request);
                if (responseText) {
                    messages.push({
                        id: this.generateId(),
                        role: 'assistant',
                        content: responseText,
                        timestamp: new Date(request.responseCompleteDate || data.lastMessageDate || Date.now())
                    });
                }
            }

            const workspaceName = path.basename(path.dirname(path.dirname(filePath)));
            const firstMessage = this.truncateText(data.requests[0]?.message?.text || '', MAX_MESSAGE_PREVIEW_LENGTH);
            const lastMessage = this.truncateText(data.requests[data.requests.length - 1]?.message?.text || '', MAX_MESSAGE_PREVIEW_LENGTH);

            return {
                id: data.sessionId || path.basename(filePath, '.json'),
                workspacePath: path.dirname(path.dirname(filePath)),
                workspaceName: workspaceName || 'Imported',
                createdAt: new Date(data.creationDate || Date.now()),
                updatedAt: new Date(data.lastMessageDate || Date.now()),
                firstMessage,
                lastMessage,
                messageCount: messages.length,
                fileSize: 0,
                messages,
                tags: [data.selectedModel?.metadata?.name || 'Unknown'],
                attachedProject: null
            };
        } catch (error) {
            console.error('[ChatStorageService] Error converting native chat:', error);
            return null;
        }
    }

    /**
     * Get the file path for a chat
     */
    public getChatFilePath(chatId: string): string | undefined {
        return this.chatFilePaths.get(chatId);
    }

    /**
     * Deep search through full file content for word counts
     * Returns chats with word occurrence counts for each search term
     */
    public async deepSearch(
        searchTerms: string[], 
        mode: 'any' | 'all' | 'exact'
    ): Promise<{ chat: ChatHistory; wordCounts: Map<string, number>; totalMatches: number; filePath: string }[]> {
        const results: { chat: ChatHistory; wordCounts: Map<string, number>; totalMatches: number; filePath: string }[] = [];
        
        for (const [chatId, filePath] of this.chatFilePaths.entries()) {
            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const lowerContent = content.toLowerCase();
                const wordCounts = new Map<string, number>();
                let totalMatches = 0;
                
                if (mode === 'exact') {
                    // Search for exact phrase
                    const phrase = searchTerms.join(' ').toLowerCase();
                    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                    const matches = content.match(regex);
                    const count = matches ? matches.length : 0;
                    wordCounts.set(searchTerms.join(' '), count);
                    totalMatches = count;
                } else {
                    // Count each word
                    for (const term of searchTerms) {
                        const lowerTerm = term.toLowerCase();
                        const regex = new RegExp(lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                        const matches = content.match(regex);
                        const count = matches ? matches.length : 0;
                        wordCounts.set(term, count);
                        totalMatches += count;
                    }
                }
                
                // Check if it matches based on mode
                let matches = false;
                if (mode === 'any') {
                    matches = totalMatches > 0;
                } else if (mode === 'all') {
                    matches = searchTerms.every(term => (wordCounts.get(term) || 0) > 0);
                } else if (mode === 'exact') {
                    matches = totalMatches > 0;
                }
                
                if (matches) {
                    const chat = this.cachedChats.get(chatId);
                    if (chat) {
                        results.push({ chat, wordCounts, totalMatches, filePath });
                    }
                }
            } catch (error) {
                // Skip files that can't be read
            }
        }
        
        // Sort by total matches descending
        results.sort((a, b) => b.totalMatches - a.totalMatches);
        return results;
    }

    /**
     * Delete a chat
     */
    public deleteChat(id: string): boolean {
        return this.cachedChats.delete(id);
    }

    /**
     * Search chats by text
     */
    public searchChats(query: string): ChatHistory[] {
        const lowerQuery = query.toLowerCase();
        return this.getAllChats().filter(chat => {
            // Search in workspace name
            if (chat.workspaceName.toLowerCase().includes(lowerQuery)) {
                return true;
            }
            // Search in messages
            return chat.messages.some(msg => 
                msg.content.toLowerCase().includes(lowerQuery)
            );
        });
    }

    /**
     * Convert chats to Markdown format
     */
    private convertToMarkdown(chats: ChatHistory[]): string {
        let md = '# Copilot Chat Export\n\n';
        md += `Exported: ${new Date().toISOString()}\n\n`;

        for (const chat of chats) {
            md += `## ${chat.workspaceName}\n`;
            md += `*Created: ${chat.createdAt.toISOString()}*\n\n`;

            for (const msg of chat.messages) {
                const role = msg.role === 'user' ? '👤 User' : '🤖 Copilot';
                md += `### ${role}\n`;
                md += `${msg.content}\n\n`;
            }
            md += '---\n\n';
        }

        return md;
    }

    /**
     * Return word counts for a specific chat or for all chats when chatId is omitted.
     * If `terms` is provided, only return counts for those terms.
     */
    public getWordCounts(chatId?: string, terms?: string[]): Record<string, number> {
        const counts: Record<string, number> = {};

        const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9']/g, ' ');

        const processText = (text: string) => {
            const normalized = normalize(text);
            for (const raw of normalized.split(/\s+/)) {
                const w = raw.trim();
                if (!w || w.length <= 2) continue;
                counts[w] = (counts[w] || 0) + 1;
            }
        };

        if (chatId) {
            const chat = this.cachedChats.get(chatId);
            if (!chat) return {};
            for (const msg of chat.messages || []) {
                processText(msg.content || '');
            }
        } else {
            for (const chat of this.cachedChats.values()) {
                for (const msg of chat.messages || []) {
                    processText(msg.content || '');
                }
            }
        }

        if (terms && terms.length > 0) {
            const out: Record<string, number> = {};
            for (const t of terms) {
                const k = t.toLowerCase();
                out[k] = counts[k] || 0;
            }
            return out;
        }

        return counts;
    }

    /**
     * Return top N words across all cached chats (or for a given chat if chatId provided).
     */
    public getTopWords(limit = 25, chatId?: string): Array<{ word: string; count: number }> {
        const counts = this.getWordCounts(chatId);
        const arr = Object.keys(counts).map(w => ({ word: w, count: counts[w] }));
        arr.sort((a, b) => b.count - a.count);
        return arr.slice(0, limit);
    }

    /**
     * Convert chats to HTML format
     */
    private convertToHtml(chats: ChatHistory[]): string {
        let html = `<!DOCTYPE html>
<html>
<head>
    <title>Copilot Chat Export</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .chat { border: 1px solid #ddd; margin: 20px 0; padding: 15px; border-radius: 8px; }
        .workspace { font-size: 1.2em; font-weight: bold; color: #333; }
        .date { color: #666; font-size: 0.9em; }
        .message { margin: 10px 0; padding: 10px; border-radius: 6px; }
        .user { background: #e3f2fd; }
        .assistant { background: #f5f5f5; }
        .role { font-weight: bold; margin-bottom: 5px; }
        hr { border: none; border-top: 1px solid #eee; margin: 30px 0; }
    </style>
</head>
<body>
    <h1>Copilot Chat Export</h1>
    <p>Exported: ${new Date().toISOString()}</p>
`;

        for (const chat of chats) {
            html += `
    <div class="chat">
        <div class="workspace">${chat.workspaceName}</div>
        <div class="date">Created: ${chat.createdAt.toISOString()}</div>
`;
            for (const msg of chat.messages) {
                const roleClass = msg.role;
                const roleLabel = msg.role === 'user' ? '👤 User' : '🤖 Copilot';
                html += `
        <div class="message ${roleClass}">
            <div class="role">${roleLabel}</div>
            <div>${msg.content.replace(/\n/g, '<br>')}</div>
        </div>
`;
            }
            html += `    </div>\n`;
        }

        html += `</body>\n</html>`;
        return html;
    }

    /**
     * Generate a unique ID
     */
    private generateId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}
