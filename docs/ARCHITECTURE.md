# Acidni Copilot Chat Manager (ACCM) — Architecture Document

**Product Code:** `accm` | **Status:** Production | **Last Updated:** 2026-03-07

---

## Overview

ACCM is a VS Code extension that manages, organizes, searches, and exports GitHub Copilot chat histories across workspaces. It provides a dashboard with word cloud visualization, deep search with word counts, export/import (JSON/Markdown/HTML), and project attachment for organizing chats.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | 5.3+ |
| Target | VS Code Extension | ^1.85.0 |
| Module System | CommonJS (ES2022) | — |
| Publisher | AcidniLLC | v0.1.27 |
| Dependencies | uuid, figma-api | — |
| Dev Tools | @vscode/vsce, eslint, sharp | — |

---

## Architecture

```text
┌─────────────────────────────────────────┐
│           VS Code Editor                │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  ACCM Extension                   │  │
│  │                                   │  │
│  │  ┌─────────────┐ ┌────────────┐  │  │
│  │  │ Tree View   │ │ Dashboard  │  │  │
│  │  │ Providers   │ │ Webview    │  │  │
│  │  │ • History   │ │ • Stats    │  │  │
│  │  │ • Workspace │ │ • Word     │  │  │
│  │  │ • Recent    │ │   Cloud    │  │  │
│  │  └──────┬──────┘ └─────┬──────┘  │  │
│  │         │              │          │  │
│  │  ┌──────▼──────────────▼──────┐   │  │
│  │  │  ChatStorageService        │   │  │
│  │  │  • Partial reads (4KB)     │   │  │
│  │  │  • Parallel I/O (10x)     │   │  │
│  │  │  • mtime caching          │   │  │
│  │  │  • Index persistence      │   │  │
│  │  └──────────┬─────────────────┘   │  │
│  │             │                     │  │
│  └─────────────┼─────────────────────┘  │
│                │                        │
│  ┌─────────────▼──────────────────┐     │
│  │  VS Code workspaceStorage     │     │
│  │  %APPDATA%/Code/User/         │     │
│  │  workspaceStorage/            │     │
│  └────────────────────────────────┘     │
└─────────────────────────────────────────┘
         │ (optional)
         ▼
┌──────────────────┐
│ telemetry.       │
│ acidni.net       │
│ Anonymous events │
└──────────────────┘
```

---

## Distribution

| Property | Value |
|----------|-------|
| Marketplace | VS Code Marketplace (search "ACCM") |
| Package Format | VSIX |
| Build | `npm run compile` (tsc) |
| Package | `npm run package` (version bump + vsce package) |
| Publish | `npm run publish` (vsce publish) |

**Note:** This is a VS Code extension, not a deployed Container App. There is no Dockerfile, FQDN, or Azure deployment.

---

## Key Source Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point — activates on startup, registers commands and views |
| `src/services/chatStorageService.ts` | Core service — reads Copilot chat files with optimized I/O |
| `src/services/acidniTelemetry.ts` | Anonymous telemetry client (batched, respects opt-out) |
| `src/models/chatHistory.ts` | Data models — ChatHistory, ChatMessage, ChatExport |
| `src/providers/chatHistoryProvider.ts` | Tree data providers for sidebar views |
| `src/commands/commandHandlers.ts` | Command implementations (dashboard, export, search) |

---

## VS Code Commands

| Command | Action |
|---------|--------|
| `ACCM: Open Dashboard` | Webview panel with stats + word cloud |
| `ACCM: Export Chat` | Export single chat |
| `ACCM: Export All Chats` | Export all histories |
| `ACCM: Import Chats` | Import from JSON |
| `ACCM: Search Chats` | Full-text search |
| `ACCM: Delete Chat` | Remove a chat |
| `ACCM: Attach Chat to Project` | Link chat to project |
| `ACCM: Refresh History` | Rescan storage |
| `ACCM: Open Chat` | View chat content |

---

## Data Storage

- **Read Source**: VS Code `workspaceStorage/` directory (configurable via settings)
- **Cache**: VS Code `globalState` for metadata index persistence
- **No external database** — all data is local filesystem

---

## Dependencies

| Dependency | Type |
|-----------|------|
| VS Code workspace storage | Local filesystem (Copilot chat files) |
| `telemetry.acidni.net` | Optional outbound HTTP (anonymous, fire-and-forget) |
