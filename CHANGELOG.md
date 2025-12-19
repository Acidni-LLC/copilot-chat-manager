# Changelog

All notable changes to ACCM - Acidni Copilot Chat Manager will be documented in this file.

## [0.1.12] - 2025-12-19

### Added
- Word cloud visualization on dashboard showing top chat topics
- Expanded word cloud view with customizable topic count
- Word cloud per individual chat detail view
- Deep search with word counts and context highlighting
- Dashboard and Refresh buttons in sidebar header
- ACCM 4-box logo with shiny green design

### Changed
- Rebranded to ACCM - Acidni Copilot Chat Manager
- Improved topic extraction with 150+ stop words filtering
- Enhanced search results with match counts per chat

### Fixed
- Date serialization from cache (strings → Date objects)
- Extension Development Host isolation for testing

## [0.1.11] - 2025-12-18

### Added
- Date/time range filters (Today, This Week, This Month, Custom)
- Import support for native VS Code Copilot chat format

### Fixed
- Performance optimizations (lazy loading, parallel I/O)
- 100% CPU usage issue resolved

## [0.1.0] - 2025-12-17

### Added
- Initial release
- Dashboard view with chat statistics
- Sidebar views (All Chats, By Workspace, Recent)
- Export to JSON, Markdown, HTML formats
- Import previously exported chats
- Full-text search across chat histories
- Attach chats to projects
