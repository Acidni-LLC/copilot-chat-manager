/**
 * Chat History data models for Copilot Chat Manager
 */

/**
 * Represents a single message in a chat
 */
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

/**
 * Represents a complete chat history session
 */
export interface ChatHistory {
    id: string;
    workspacePath: string;
    workspaceName: string;
    createdAt: Date;
    updatedAt: Date;
    firstMessage: string;
    lastMessage: string;
    messageCount: number;
    fileSize: number;
    messages: ChatMessage[];
    tags: string[];
    attachedProject: string | null;
}

/**
 * Export format wrapper
 */
export interface ChatExport {
    version: string;
    exportedAt: Date;
    sourceExtension: string;
    chats: ChatHistory[];
}

/**
 * Tree item representing a chat in the sidebar
 */
export interface ChatTreeItem {
    id: string;
    label: string;
    description: string;
    workspaceName: string;
    lastMessage: string;
    updatedAt: Date;
    messageCount: number;
}

/**
 * Workspace group for organizing chats
 */
export interface WorkspaceGroup {
    workspacePath: string;
    workspaceName: string;
    chatCount: number;
    chats: ChatHistory[];
}

/**
 * Search result for chat searches
 */
export interface ChatSearchResult {
    chat: ChatHistory;
    matchedMessages: ChatMessage[];
    relevanceScore: number;
}

/**
 * Import result status
 */
export interface ImportResult {
    success: boolean;
    importedCount: number;
    skippedCount: number;
    errors: string[];
}

/**
 * Export options
 */
export interface ExportOptions {
    format: 'json' | 'markdown' | 'html';
    includeTags: boolean;
    includeTimestamps: boolean;
    outputPath?: string;
}

/**
 * Filter options for chat history view
 */
export interface ChatFilter {
    workspacePath?: string;
    tags?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    searchText?: string;
}
