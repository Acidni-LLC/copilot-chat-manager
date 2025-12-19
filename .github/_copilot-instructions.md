# Copilot Chat Manager - AI Agent Instructions

## Project Overview
VS Code extension for managing GitHub Copilot chat histories. TypeScript-based, uses VS Code Extension API.

## Architecture

### Core Components
- **extension.ts** - Entry point; initializes services, registers commands, sets up file watchers
- **services/chatStorageService.ts** - Singleton service reading Copilot chats from VS Code's `workspaceStorage` directories
- **providers/chatHistoryProvider.ts** - TreeDataProviders for sidebar views (All Chats, By Workspace, Recent)
- **commands/commandHandlers.ts** - Command implementations with webview rendering
- **models/chatHistory.ts** - TypeScript interfaces (ChatHistory, ChatMessage, ChatExport, etc.)

### Data Flow
1. `ChatStorageService` scans `%APPDATA%/Code/User/workspaceStorage/*/GitHub.copilot-chat/` for chat JSON files
2. Parsed data cached in `Map<string, ChatHistory>` for fast access
3. TreeProviders consume storage service via `refresh()` pattern using `EventEmitter<void>`
4. FileSystemWatcher auto-refreshes on Copilot storage changes

### Singleton Pattern
`ChatStorageService` uses singleton pattern - first call requires `ExtensionContext`, subsequent calls use cached instance:
```typescript
const service = ChatStorageService.getInstance(context); // initialization
const service = ChatStorageService.getInstance(); // later usage
```

## Development Commands
```bash
npm run compile    # Build TypeScript to out/
npm run watch      # Watch mode for development
npm run lint       # ESLint check
npm run test       # Run tests (requires compile first)
npm run package    # Create .vsix package
```

## Key Conventions

### Command Registration Pattern
Commands are registered as tuples in extension.ts with consistent naming:
```typescript
const commands: Array<[string, (...args: any[]) => Promise<void>]> = [
    ['copilotChatManager.{commandName}', (item: ChatTreeItem) => handlers.{method}(item)],
];
```

### TreeItem Context Values
Use `contextValue = 'chatItem'` for menu contributions. All tree items must implement VS Code's `TreeItem` class.

### Configuration Schema
Settings defined in `package.json` under `contributes.configuration`. Access via:
```typescript
vscode.workspace.getConfiguration('copilotChatManager').get('settingName')
```

### Export Formats
Three formats supported: `json` (full backup), `markdown` (readable), `html` (shareable). Export logic in `ChatStorageService.exportChats()`.

## File Patterns
- Source: `src/**/*.ts` → compiled to `out/**/*.js`
- Views registered in `package.json` under `contributes.views.copilotChatManager`
- Icons: `resources/*.svg` referenced in package.json

## Testing Considerations
When modifying chat parsing logic, test against multiple Copilot chat JSON formats (array, `conversations` property, or single object) - see `parseChatFile()` method.
