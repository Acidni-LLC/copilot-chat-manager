# GitHub Copilot Chat Manager

A VS Code extension for managing, organizing, and exporting your GitHub Copilot chat histories.

## Features

### 📊 Dashboard View
- View all your Copilot chats in one place
- See statistics: total chats, messages, and workspaces
- Quick actions for each chat

### 🗂️ Sidebar Views
- **All Chats**: Flat list of all chat histories
- **By Workspace**: Chats grouped by workspace
- **Recent**: Your most recent conversations

### 📤 Export Capabilities
- Export individual chats or all at once
- Multiple formats supported:
  - **JSON**: Full data export for backup/import
  - **Markdown**: Human-readable documentation
  - **HTML**: Shareable web format

### 📥 Import Chats
- Import previously exported chat histories
- Automatic duplicate detection

### 🔍 Search
- Full-text search across all chat messages
- Quick navigation to matching chats

### 🏷️ Project Attachment
- Attach chats to specific projects
- Keep relevant conversations organized

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Copilot Chat Manager"
4. Click Install

### From VSIX
1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions
4. Click the `...` menu → "Install from VSIX..."
5. Select the downloaded file

## Usage

### Command Palette Commands

| Command | Description |
|---------|-------------|
| `Copilot Chat Manager: Open Dashboard` | Open the main dashboard view |
| `Copilot Chat Manager: Export Chat` | Export selected chat |
| `Copilot Chat Manager: Export All Chats` | Export all chat histories |
| `Copilot Chat Manager: Import Chats` | Import chats from JSON file |
| `Copilot Chat Manager: Search Chats` | Search across all chats |
| `Copilot Chat Manager: Refresh History` | Rescan for new chats |

### Sidebar

The extension adds a "Chat Manager" view container to your Activity Bar with three views:
- **All Chats**: Browse all your chat histories
- **Workspaces**: See chats organized by workspace
- **Recent**: Quick access to recent conversations

Right-click any chat for additional options:
- Open
- Export
- Delete
- Attach to Project

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `copilotChatManager.exportPath` | Default export directory | `""` (prompts) |
| `copilotChatManager.autoRefresh` | Auto-refresh on focus | `true` |
| `copilotChatManager.showNotifications` | Show status notifications | `true` |
| `copilotChatManager.maxRecentChats` | Number of recent chats | `10` |
| `copilotChatManager.confirmDelete` | Confirm before deleting | `true` |
| `copilotChatManager.dateFormat` | Date display format | `"relative"` |

## Export Format Examples

### JSON
```json
{
  "exportDate": "2025-01-15T10:30:00Z",
  "version": "1.0.0",
  "chats": [
    {
      "id": "abc123",
      "workspacePath": "/path/to/workspace",
      "workspaceName": "my-project",
      "messages": [
        {
          "id": "msg1",
          "role": "user",
          "content": "How do I...",
          "timestamp": "2025-01-15T10:00:00Z"
        }
      ],
      "createdAt": "2025-01-15T10:00:00Z",
      "updatedAt": "2025-01-15T10:30:00Z"
    }
  ]
}
```

### Markdown
```markdown
# Copilot Chat Export

## my-project
**Created:** 1/15/2025, 10:00:00 AM
**Messages:** 5

### Conversation

**👤 You (1/15/2025, 10:00:00 AM):**
How do I implement...

**🤖 Copilot (1/15/2025, 10:00:05 AM):**
You can implement this by...
```

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/Acidni-LLC/Github-Copilot-Chat-Manager.git
cd Github-Copilot-Chat-Manager

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package extension
npx vsce package
```

### Project Structure
```
├── src/
│   ├── extension.ts          # Main entry point
│   ├── commands/
│   │   └── commandHandlers.ts # Command implementations
│   ├── models/
│   │   └── chatHistory.ts    # Data interfaces
│   ├── providers/
│   │   └── chatHistoryProvider.ts # Tree view providers
│   └── services/
│       └── chatStorageService.ts  # Storage service
├── resources/
│   ├── chat.svg              # Tree view icon
│   └── icon.png              # Extension icon
├── package.json
├── tsconfig.json
└── README.md
```

## Requirements

- VS Code 1.85.0 or higher
- GitHub Copilot Chat extension installed

## Known Issues

- Chat histories are read-only; editing is not supported
- Some older chat formats may not be fully parsed

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## About

Developed by [Acidni LLC](https://acidni.com)

Part of the Acidni enterprise configuration ecosystem.
