# Acidni Telemetry System

**Version:** 1.0.0  
**Last Updated:** December 21, 2025

This document describes the telemetry system for Acidni VS Code extensions. Use this as the contract between the frontend (VS Code extensions) and backend (telemetry server).

---

## Overview

The Acidni telemetry system collects anonymous usage data from our VS Code extensions to:
- Understand feature usage patterns
- Track performance metrics
- Identify errors and issues
- Measure user engagement

### Extensions Using This System

| Extension | ID | Description |
|-----------|-----|-------------|
| **ACCM** | `copilot-chat-manager` | Chat history backup & management |
| **AACC** | `ai-chat-chooser` | Simple AI tool configuration |
| **AACCA** | `ai-chat-cost-analyzer` | Cost analysis for AI usage |
| **AACE** | `ai-chat-expert` | Enterprise AI configuration & governance |

---

## Privacy Compliance

### What We Collect ✅
- Anonymous session IDs (UUIDs)
- Command usage (which commands, how often)
- Performance metrics (scan duration, item counts)
- Error types (class names only, no stack traces)
- Feature interactions (opened, closed, clicked)
- Platform info (win32/darwin/linux)
- VS Code version
- Extension version

### What We DON'T Collect ❌
- File paths or names
- File contents
- Workspace names
- Personal identifiable information (PII)
- IP addresses (don't log these server-side)
- User names or emails
- Exact token counts (bucketed instead)
- Error messages or stack traces

### User Control
- Respects VS Code's `telemetry.telemetryLevel` setting
- Checked via `vscode.env.isTelemetryEnabled`
- If disabled, no events are sent

---

## API Contract

### Endpoint
```
POST https://telemetry.acidni.net/api/v1/events
```

### Headers
```
Content-Type: application/json
X-Acidni-Telemetry-Version: 1.0.0
```

### Request Body
```json
{
  "events": [
    { /* TelemetryEvent */ },
    { /* TelemetryEvent */ },
    ...
  ]
}
```

### Response
- `200 OK` - Events received successfully
- `400 Bad Request` - Invalid payload
- `429 Too Many Requests` - Rate limited
- `500 Internal Server Error` - Server issue

### Batching
- Events are batched client-side (default: 10 events per request)
- Flush interval: 60 seconds
- On extension deactivation: immediate flush

---

## Event Schema

### Base Event (All Events)

Every event includes these fields:

```typescript
interface TelemetryEventBase {
    eventId: string;           // UUID v4 - unique per event
    timestamp: string;         // ISO 8601 format
    sessionId: string;         // UUID v4 - unique per VS Code session
    extensionId: string;       // 'ACCM' | 'AACC' | 'AACCA' | 'AACE'
    extensionVersion: string;  // Semver, e.g., '0.1.27'
    telemetryVersion: string;  // Schema version, e.g., '1.0.0'
    vscodeVersion: string;     // e.g., '1.95.0'
    platform: string;          // 'win32' | 'darwin' | 'linux'
    locale: string;            // e.g., 'en-US'
    uiKind: string;            // 'desktop' | 'web'
    eventType: string;         // See event types below
    data: object;              // Event-specific data
}
```

---

## Event Types

### 1. `activation`

Sent when extension activates.

```json
{
  "eventType": "activation",
  "data": {
    "activationKind": "startup",       // 'startup' | 'command' | 'language' | 'workspaceContains'
    "workspaceType": "single",         // 'single' | 'multi' | 'none'
    "workspaceFolderCount": 3,         // Number of folders in workspace
    "isFirstActivation": false,        // First time ever activating
    "daysSinceInstall": 14             // Days since extension was installed
  }
}
```

### 2. `deactivation`

Sent when extension deactivates (VS Code closing).

```json
{
  "eventType": "deactivation",
  "data": {
    "sessionDurationMinutes": 45,      // How long extension was active
    "commandsExecuted": 12,            // Total commands run this session
    "errorsEncountered": 1             // Total errors this session
  }
}
```

### 3. `command`

Sent when user executes a command.

```json
{
  "eventType": "command",
  "data": {
    "commandId": "accm.exportChat",    // Command identifier
    "commandCategory": "export",        // Category: 'export' | 'scan' | 'analyze' | 'config' | 'view'
    "executionTimeMs": 234,            // How long command took
    "success": true,                   // Did it complete successfully?
    "errorType": null,                 // Error class name if failed
    "resultCount": 5                   // Number of items affected (optional)
  }
}
```

**Command Categories:**
- `scan` - Scanning/searching operations
- `export` - Export/backup operations
- `import` - Import operations
- `analyze` - Analysis operations
- `config` - Configuration changes
- `view` - View/display operations
- `model` - AI model operations
- `assess` - Assessment operations

### 4. `feature`

Sent when user interacts with a feature.

```json
{
  "eventType": "feature",
  "data": {
    "featureId": "chatHistoryTree",    // Feature identifier
    "action": "expanded",              // 'opened' | 'closed' | 'clicked' | 'expanded' | 'collapsed'
    "context": "sidebar",              // Where: 'sidebar' | 'panel' | 'editor' | 'webview' | 'statusBar'
    "itemCount": 25                    // Number of items displayed (optional)
  }
}
```

### 5. `performance`

Sent for performance-critical operations.

```json
{
  "eventType": "performance",
  "data": {
    "operation": "workspaceScan",      // Operation name
    "durationMs": 1234,                // Time taken
    "itemCount": 500,                  // Items processed
    "cached": false,                   // Was result from cache?
    "memoryUsageMB": 45.2              // Memory used (optional)
  }
}
```

### 6. `error`

Sent when an error occurs.

```json
{
  "eventType": "error",
  "data": {
    "errorType": "FileNotFoundError",  // Error class name (NOT message)
    "errorCode": "ENOENT",             // Error code if available
    "operation": "loadChatHistory",    // What was being done
    "recoverable": true,               // Did we handle it gracefully?
    "userFacing": false                // Did user see an error message?
  }
}
```

### 7. `config`

Sent when user changes a setting.

```json
{
  "eventType": "config",
  "data": {
    "settingId": "autoRefresh",        // Setting that changed
    "action": "changed",               // 'changed' | 'reset'
    "valueType": "boolean"             // Type: 'boolean' | 'string' | 'number' | 'array' | 'object'
    // NOTE: Never log the actual value!
  }
}
```

### 8. `model` (AACE/AACC only)

Sent for AI model interactions.

```json
{
  "eventType": "model",
  "data": {
    "action": "selected",              // 'selected' | 'switched' | 'listed' | 'tested'
    "modelFamily": "gpt-4o",           // Model family name
    "modelVendor": "copilot",          // 'copilot' | 'azure' | 'ollama' | 'openrouter' | 'custom'
    "modelSource": "vscode",           // 'vscode' | 'custom-endpoint' | 'azure-foundry'
    "available": true                  // Was model available?
  }
}
```

### 9. `cost_analysis` (AACCA only)

Sent for cost analysis operations.

```json
{
  "eventType": "cost_analysis",
  "data": {
    "action": "analyzed",              // 'analyzed' | 'exported' | 'compared'
    "fileType": "instruction",         // 'instruction' | 'chat-history' | 'prompt' | 'agent'
    "tokenCountRange": "1k-10k",       // '0-1k' | '1k-10k' | '10k-100k' | '100k+'
    "filesAnalyzed": 12                // Number of files
  }
}
```

### 10. `assessment` (AACE only)

Sent for maturity assessments.

```json
{
  "eventType": "assessment",
  "data": {
    "action": "completed",             // 'started' | 'completed' | 'exported'
    "assessmentType": "cmmi",          // 'cmmi' | 'gap' | 'togaf'
    "projectCount": 5,                 // Number of projects assessed
    "maturityLevel": 3,                // 1-5 for CMMI (optional)
    "score": 67                        // 0-100 score (optional)
  }
}
```

---

## Database Schema

### Recommended PostgreSQL Schema

```sql
-- Main events table
CREATE TABLE telemetry_events (
    id SERIAL PRIMARY KEY,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Event identity
    event_id UUID NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    session_id UUID NOT NULL,
    
    -- Extension info
    extension_id VARCHAR(10) NOT NULL,
    extension_version VARCHAR(20) NOT NULL,
    telemetry_version VARCHAR(10) NOT NULL,
    
    -- Environment
    vscode_version VARCHAR(20),
    platform VARCHAR(20),
    locale VARCHAR(10),
    ui_kind VARCHAR(10),
    
    -- Event data
    event_type VARCHAR(50) NOT NULL,
    data JSONB NOT NULL,
    
    -- Indexes
    CONSTRAINT unique_event UNIQUE (event_id)
);

-- Indexes for common queries
CREATE INDEX idx_events_timestamp ON telemetry_events(timestamp);
CREATE INDEX idx_events_extension ON telemetry_events(extension_id);
CREATE INDEX idx_events_type ON telemetry_events(event_type);
CREATE INDEX idx_events_session ON telemetry_events(session_id);
CREATE INDEX idx_events_data ON telemetry_events USING GIN (data);

-- Partitioning by month (recommended for scale)
-- CREATE TABLE telemetry_events_2025_12 PARTITION OF telemetry_events
--     FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
```

### Recommended Indexes for Analytics

```sql
-- Daily active users
CREATE INDEX idx_daily_sessions ON telemetry_events(
    DATE(timestamp), extension_id, session_id
);

-- Command popularity
CREATE INDEX idx_command_usage ON telemetry_events(
    (data->>'commandId'), extension_id
) WHERE event_type = 'command';

-- Error tracking
CREATE INDEX idx_errors ON telemetry_events(
    (data->>'errorType'), (data->>'operation')
) WHERE event_type = 'error';
```

---

## Sample Queries

### Daily Active Users (DAU)
```sql
SELECT 
    DATE(timestamp) as day,
    extension_id,
    COUNT(DISTINCT session_id) as dau
FROM telemetry_events
WHERE event_type = 'activation'
  AND timestamp > NOW() - INTERVAL '30 days'
GROUP BY DATE(timestamp), extension_id
ORDER BY day DESC;
```

### Most Used Commands
```sql
SELECT 
    data->>'commandId' as command,
    COUNT(*) as executions,
    AVG((data->>'executionTimeMs')::int) as avg_duration_ms,
    SUM(CASE WHEN (data->>'success')::boolean THEN 1 ELSE 0 END)::float / COUNT(*) as success_rate
FROM telemetry_events
WHERE event_type = 'command'
  AND timestamp > NOW() - INTERVAL '7 days'
GROUP BY data->>'commandId'
ORDER BY executions DESC
LIMIT 20;
```

### Error Frequency
```sql
SELECT 
    data->>'errorType' as error_type,
    data->>'operation' as operation,
    COUNT(*) as occurrences,
    COUNT(DISTINCT session_id) as affected_sessions
FROM telemetry_events
WHERE event_type = 'error'
  AND timestamp > NOW() - INTERVAL '7 days'
GROUP BY data->>'errorType', data->>'operation'
ORDER BY occurrences DESC;
```

### Average Session Duration
```sql
SELECT 
    extension_id,
    AVG((data->>'sessionDurationMinutes')::int) as avg_session_minutes,
    AVG((data->>'commandsExecuted')::int) as avg_commands
FROM telemetry_events
WHERE event_type = 'deactivation'
  AND timestamp > NOW() - INTERVAL '30 days'
GROUP BY extension_id;
```

### Performance Trends
```sql
SELECT 
    DATE(timestamp) as day,
    data->>'operation' as operation,
    AVG((data->>'durationMs')::int) as avg_duration,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (data->>'durationMs')::int) as p95_duration
FROM telemetry_events
WHERE event_type = 'performance'
  AND timestamp > NOW() - INTERVAL '14 days'
GROUP BY DATE(timestamp), data->>'operation'
ORDER BY day DESC, operation;
```

---

## Rate Limiting

### Recommended Limits
- **Per session:** 1000 events/hour
- **Per IP:** 10000 events/hour
- **Batch size:** Max 100 events per request

### Client Behavior
- Client batches events (10 per request by default)
- Flushes every 60 seconds
- On 429 response: exponential backoff
- Re-queues failed events (max 100 in queue)

---

## Versioning

### Telemetry Version
- Current: `1.0.0`
- Sent in header: `X-Acidni-Telemetry-Version`
- Sent in event: `telemetryVersion`

### Breaking Changes
- If schema changes significantly, bump major version
- Backend should accept all versions and transform as needed
- Deprecate old versions after 6 months

---

## Security Considerations

1. **HTTPS only** - Never accept HTTP
2. **Don't log IPs** - Or anonymize them (hash)
3. **Validate UUIDs** - Reject malformed event_ids
4. **Rate limit aggressively** - Prevent abuse
5. **No PII in logs** - Sanitize server logs
6. **Data retention** - Delete events older than 12 months
7. **Access control** - Limit who can query raw data

---

## Frontend Implementation

The frontend telemetry service is in:
```
Github Copilot Chat Manager/src/services/acidniTelemetry.ts
```

Copy this file to each extension and initialize:

```typescript
// In activate()
AcidniTelemetry.initialize(context, 'ACCM', '0.1.27');
telemetry()?.trackActivation();

// In deactivate()
AcidniTelemetry.dispose();
```

See `telemetry-integration-examples.ts` for usage patterns.

---

## Dashboard Metrics (Suggested)

### Overview
- Total events (24h, 7d, 30d)
- DAU per extension
- Error rate trend
- Session duration trend

### Commands
- Top 10 commands by usage
- Command success rates
- Slowest commands (p95)

### Errors
- Error frequency by type
- Affected session percentage
- Error trend over time

### Performance
- Scan duration trends
- Cache hit rate
- Memory usage

### Features
- Feature adoption (% of sessions using)
- Most clicked UI elements
- Tree view expansion patterns

---

## Contact

**Maintainer:** Acidni LLC  
**Website:** https://acidni.net  
**Issues:** Report to respective extension repo
