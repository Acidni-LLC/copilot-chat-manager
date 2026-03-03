/**
 * Acidni Telemetry Service
 * Shared telemetry implementation for all Acidni VS Code extensions
 * 
 * PRIVACY FIRST:
 * - Respects VS Code's isTelemetryEnabled setting
 * - No PII (personal identifiable information) collected
 * - No file contents, paths, or workspace names
 * - Only anonymous usage patterns and performance metrics
 * 
 * USAGE:
 * 1. Copy this file to your extension's src/services/ folder
 * 2. Initialize in activate(): AcidniTelemetry.initialize(context, 'AACE', '0.1.0')
 * 3. Track events: AcidniTelemetry.trackEvent('command_executed', { command: 'scan' })
 * 4. Dispose in deactivate(): AcidniTelemetry.dispose()
 */

import * as vscode from 'vscode';

// =============================================================================
// CONFIGURATION
// =============================================================================

const TELEMETRY_ENDPOINT = 'https://telemetry.acidni.net/api/v1/events'; // Your backend
const TELEMETRY_BATCH_SIZE = 10;
const TELEMETRY_FLUSH_INTERVAL_MS = 60000; // 1 minute
const TELEMETRY_VERSION = '1.0.0';

// =============================================================================
// EVENT TYPES & PAYLOADS
// =============================================================================

/**
 * Base event structure - all events inherit from this
 */
export interface TelemetryEventBase {
    // Auto-populated by service
    eventId: string;           // UUID for this event
    timestamp: string;         // ISO 8601
    sessionId: string;         // Unique per VS Code session
    extensionId: string;       // 'ACCM' | 'AACC' | 'AACCA' | 'AACE'
    extensionVersion: string;  // e.g., '0.1.27'
    telemetryVersion: string;  // Schema version
    
    // Environment (anonymous)
    vscodeVersion: string;     // e.g., '1.85.0'
    platform: string;          // 'win32' | 'darwin' | 'linux'
    locale: string;            // e.g., 'en-US'
    uiKind: string;            // 'desktop' | 'web'
}

/**
 * Extension lifecycle events
 */
export interface ActivationEvent extends TelemetryEventBase {
    eventType: 'activation';
    data: {
        activationKind: 'startup' | 'command' | 'language' | 'workspaceContains';
        workspaceType: 'single' | 'multi' | 'none';
        workspaceFolderCount: number;
        isFirstActivation: boolean;
        daysSinceInstall: number;
    };
}

export interface DeactivationEvent extends TelemetryEventBase {
    eventType: 'deactivation';
    data: {
        sessionDurationMinutes: number;
        commandsExecuted: number;
        errorsEncountered: number;
    };
}

/**
 * Command execution events
 */
export interface CommandEvent extends TelemetryEventBase {
    eventType: 'command';
    data: {
        commandId: string;           // e.g., 'accm.exportChat'
        commandCategory: string;     // e.g., 'export', 'scan', 'analyze'
        executionTimeMs: number;
        success: boolean;
        errorType?: string;          // Error class name, not message
        resultCount?: number;        // For commands that return items
    };
}

/**
 * Feature usage events
 */
export interface FeatureEvent extends TelemetryEventBase {
    eventType: 'feature';
    data: {
        featureId: string;           // e.g., 'treeView', 'webview', 'statusBar'
        action: string;              // e.g., 'opened', 'closed', 'clicked', 'expanded'
        context?: string;            // e.g., 'sidebar', 'panel', 'editor'
        itemCount?: number;          // Number of items displayed/processed
    };
}

/**
 * Performance metrics
 */
export interface PerformanceEvent extends TelemetryEventBase {
    eventType: 'performance';
    data: {
        operation: string;           // e.g., 'scan', 'parse', 'render'
        durationMs: number;
        itemCount: number;           // Files scanned, items rendered, etc.
        cached: boolean;             // Was result from cache?
        memoryUsageMB?: number;
    };
}

/**
 * Error events (anonymous - no stack traces with paths)
 */
export interface ErrorEvent extends TelemetryEventBase {
    eventType: 'error';
    data: {
        errorType: string;           // Error class name
        errorCode?: string;          // If available
        operation: string;           // What was being done
        recoverable: boolean;        // Did we handle it gracefully?
        userFacing: boolean;         // Did user see an error message?
    };
}

/**
 * Configuration events
 */
export interface ConfigEvent extends TelemetryEventBase {
    eventType: 'config';
    data: {
        settingId: string;           // e.g., 'preferredModel', 'autoScan'
        action: 'changed' | 'reset';
        valueType: string;           // 'boolean' | 'string' | 'number'
        // Note: Never log the actual value, just that it changed
    };
}

/**
 * Model usage (for AACE/AACC)
 */
export interface ModelEvent extends TelemetryEventBase {
    eventType: 'model';
    data: {
        action: 'selected' | 'switched' | 'listed' | 'tested';
        modelFamily?: string;        // e.g., 'gpt-4o', 'claude-3.5'
        modelVendor?: string;        // e.g., 'copilot', 'azure', 'ollama'
        modelSource?: string;        // e.g., 'vscode', 'custom-endpoint'
        available: boolean;
    };
}

/**
 * Cost analysis (for AACCA)
 */
export interface CostAnalysisEvent extends TelemetryEventBase {
    eventType: 'cost_analysis';
    data: {
        action: 'analyzed' | 'exported' | 'compared';
        fileType: string;            // e.g., 'instruction', 'chat-history'
        tokenCountRange: string;     // e.g., '0-1k', '1k-10k', '10k-100k', '100k+'
        filesAnalyzed: number;
    };
}

/**
 * Maturity assessment (for AACE)
 */
export interface AssessmentEvent extends TelemetryEventBase {
    eventType: 'assessment';
    data: {
        action: 'started' | 'completed' | 'exported';
        assessmentType: 'cmmi' | 'gap' | 'togaf';
        projectCount: number;
        maturityLevel?: number;      // 1-5 for CMMI
        score?: number;              // 0-100
    };
}

// Union type of all events
export type TelemetryEvent = 
    | ActivationEvent 
    | DeactivationEvent 
    | CommandEvent 
    | FeatureEvent 
    | PerformanceEvent 
    | ErrorEvent 
    | ConfigEvent
    | ModelEvent
    | CostAnalysisEvent
    | AssessmentEvent;

// =============================================================================
// TELEMETRY SERVICE
// =============================================================================

export class AcidniTelemetry {
    private static instance: AcidniTelemetry | null = null;
    
    private context: vscode.ExtensionContext;
    private extensionId: string;
    private extensionVersion: string;
    private sessionId: string;
    private sessionStartTime: number;
    private commandCount: number = 0;
    private errorCount: number = 0;
    private eventQueue: TelemetryEvent[] = [];
    private flushInterval: NodeJS.Timeout | null = null;
    private enabled: boolean = false;
    private installDate: number;

    private constructor(
        context: vscode.ExtensionContext, 
        extensionId: string, 
        extensionVersion: string
    ) {
        this.context = context;
        this.extensionId = extensionId;
        this.extensionVersion = extensionVersion;
        this.sessionId = this.generateUUID();
        this.sessionStartTime = Date.now();
        
        // Track install date
        this.installDate = context.globalState.get<number>('acidni.installDate') || Date.now();
        if (!context.globalState.get<number>('acidni.installDate')) {
            context.globalState.update('acidni.installDate', this.installDate);
        }
        
        // Check if telemetry is enabled
        this.enabled = vscode.env.isTelemetryEnabled;
        
        // Listen for telemetry setting changes
        vscode.env.onDidChangeTelemetryEnabled((enabled) => {
            this.enabled = enabled;
            if (!enabled) {
                this.eventQueue = []; // Clear queue if disabled
            }
        });
        
        // Start flush interval
        if (this.enabled) {
            this.flushInterval = setInterval(() => this.flush(), TELEMETRY_FLUSH_INTERVAL_MS);
        }
    }

    /**
     * Initialize telemetry - call in activate()
     */
    public static initialize(
        context: vscode.ExtensionContext,
        extensionId: string,
        extensionVersion: string
    ): AcidniTelemetry {
        if (!AcidniTelemetry.instance) {
            AcidniTelemetry.instance = new AcidniTelemetry(context, extensionId, extensionVersion);
        }
        return AcidniTelemetry.instance;
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): AcidniTelemetry | null {
        return AcidniTelemetry.instance;
    }

    // =========================================================================
    // PUBLIC TRACKING METHODS
    // =========================================================================

    /**
     * Track extension activation
     */
    public trackActivation(kind: ActivationEvent['data']['activationKind'] = 'startup'): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const isFirst = !this.context.globalState.get<boolean>('acidni.hasActivatedBefore');
        
        if (isFirst) {
            this.context.globalState.update('acidni.hasActivatedBefore', true);
        }

        this.queueEvent('activation', {
            activationKind: kind,
            workspaceType: !workspaceFolders ? 'none' : workspaceFolders.length > 1 ? 'multi' : 'single',
            workspaceFolderCount: workspaceFolders?.length || 0,
            isFirstActivation: isFirst,
            daysSinceInstall: Math.floor((Date.now() - this.installDate) / (1000 * 60 * 60 * 24))
        });
    }

    /**
     * Track extension deactivation
     */
    public trackDeactivation(): void {
        this.queueEvent('deactivation', {
            sessionDurationMinutes: Math.round((Date.now() - this.sessionStartTime) / 60000),
            commandsExecuted: this.commandCount,
            errorsEncountered: this.errorCount
        });
        
        // Flush synchronously on deactivate
        this.flushSync();
    }

    /**
     * Track command execution
     */
    public trackCommand(
        commandId: string,
        category: string,
        executionTimeMs: number,
        success: boolean,
        options?: { errorType?: string; resultCount?: number }
    ): void {
        this.commandCount++;
        if (!success) this.errorCount++;

        this.queueEvent('command', {
            commandId: this.sanitizeCommandId(commandId),
            commandCategory: category,
            executionTimeMs,
            success,
            errorType: options?.errorType,
            resultCount: options?.resultCount
        });
    }

    /**
     * Track feature usage
     */
    public trackFeature(
        featureId: string,
        action: string,
        options?: { context?: string; itemCount?: number }
    ): void {
        this.queueEvent('feature', {
            featureId,
            action,
            context: options?.context,
            itemCount: options?.itemCount
        });
    }

    /**
     * Track performance metrics
     */
    public trackPerformance(
        operation: string,
        durationMs: number,
        itemCount: number,
        cached: boolean = false,
        memoryUsageMB?: number
    ): void {
        this.queueEvent('performance', {
            operation,
            durationMs,
            itemCount,
            cached,
            memoryUsageMB
        });
    }

    /**
     * Track errors (no sensitive data)
     */
    public trackError(
        error: Error,
        operation: string,
        recoverable: boolean = true,
        userFacing: boolean = false
    ): void {
        this.errorCount++;
        
        this.queueEvent('error', {
            errorType: error.constructor.name,
            errorCode: (error as any).code,
            operation,
            recoverable,
            userFacing
        });
    }

    /**
     * Track configuration changes
     */
    public trackConfigChange(settingId: string, valueType: string): void {
        this.queueEvent('config', {
            settingId,
            action: 'changed',
            valueType
        });
    }

    /**
     * Track model usage (AACE/AACC)
     */
    public trackModel(
        action: ModelEvent['data']['action'],
        options?: { 
            modelFamily?: string; 
            modelVendor?: string; 
            modelSource?: string;
            available?: boolean;
        }
    ): void {
        this.queueEvent('model', {
            action,
            modelFamily: options?.modelFamily,
            modelVendor: options?.modelVendor,
            modelSource: options?.modelSource,
            available: options?.available ?? true
        });
    }

    /**
     * Track cost analysis (AACCA)
     */
    public trackCostAnalysis(
        action: CostAnalysisEvent['data']['action'],
        fileType: string,
        tokenCount: number,
        filesAnalyzed: number
    ): void {
        this.queueEvent('cost_analysis', {
            action,
            fileType,
            tokenCountRange: this.getTokenRange(tokenCount),
            filesAnalyzed
        });
    }

    /**
     * Track assessment (AACE)
     */
    public trackAssessment(
        action: AssessmentEvent['data']['action'],
        assessmentType: AssessmentEvent['data']['assessmentType'],
        projectCount: number,
        options?: { maturityLevel?: number; score?: number }
    ): void {
        this.queueEvent('assessment', {
            action,
            assessmentType,
            projectCount,
            maturityLevel: options?.maturityLevel,
            score: options?.score
        });
    }

    // =========================================================================
    // HELPER: Timed operation tracking
    // =========================================================================

    /**
     * Create a timer for tracking operation duration
     * Usage: const timer = telemetry.startTimer('scan'); ... timer.end(itemCount);
     */
    public startTimer(operation: string): { end: (itemCount: number, cached?: boolean) => void } {
        const startTime = Date.now();
        return {
            end: (itemCount: number, cached: boolean = false) => {
                const duration = Date.now() - startTime;
                this.trackPerformance(operation, duration, itemCount, cached);
            }
        };
    }

    /**
     * Wrap an async function with automatic timing
     */
    public async timed<T>(
        operation: string,
        fn: () => Promise<T>,
        getItemCount: (result: T) => number = () => 1
    ): Promise<T> {
        const timer = this.startTimer(operation);
        try {
            const result = await fn();
            timer.end(getItemCount(result));
            return result;
        } catch (error) {
            timer.end(0);
            throw error;
        }
    }

    // =========================================================================
    // INTERNAL METHODS
    // =========================================================================

    private queueEvent<T extends TelemetryEvent['eventType']>(
        eventType: T,
        data: Extract<TelemetryEvent, { eventType: T }>['data']
    ): void {
        if (!this.enabled) return;

        const event = {
            eventId: this.generateUUID(),
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            extensionId: this.extensionId,
            extensionVersion: this.extensionVersion,
            telemetryVersion: TELEMETRY_VERSION,
            vscodeVersion: vscode.version,
            platform: process.platform,
            locale: vscode.env.language,
            uiKind: vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop',
            eventType,
            data
        } as TelemetryEvent;

        this.eventQueue.push(event);

        // Flush if batch size reached
        if (this.eventQueue.length >= TELEMETRY_BATCH_SIZE) {
            this.flush();
        }
    }

    private async flush(): Promise<void> {
        if (!this.enabled || this.eventQueue.length === 0) return;

        const events = [...this.eventQueue];
        this.eventQueue = [];

        try {
            const response = await fetch(TELEMETRY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Acidni-Telemetry-Version': TELEMETRY_VERSION
                },
                body: JSON.stringify({ events })
            });

            if (!response.ok) {
                // Re-queue events on failure (but don't grow indefinitely)
                if (this.eventQueue.length < 100) {
                    this.eventQueue.unshift(...events);
                }
            }
        } catch {
            // Network error - re-queue if not too many
            if (this.eventQueue.length < 100) {
                this.eventQueue.unshift(...events);
            }
        }
    }

    private flushSync(): void {
        // For deactivation - best effort sync send
        if (!this.enabled || this.eventQueue.length === 0) return;

        const events = [...this.eventQueue];
        this.eventQueue = [];

        // Use sendBeacon for reliable delivery on shutdown (if available)
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            navigator.sendBeacon(
                TELEMETRY_ENDPOINT,
                JSON.stringify({ events })
            );
        } else {
            // Fallback to sync XHR (blocking but ensures delivery)
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', TELEMETRY_ENDPOINT, false); // false = sync
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify({ events }));
            } catch {
                // Best effort - ignore errors on shutdown
            }
        }
    }

    /**
     * Dispose - call in deactivate()
     */
    public static dispose(): void {
        if (AcidniTelemetry.instance) {
            AcidniTelemetry.instance.trackDeactivation();
            
            if (AcidniTelemetry.instance.flushInterval) {
                clearInterval(AcidniTelemetry.instance.flushInterval);
            }
            
            AcidniTelemetry.instance = null;
        }
    }

    // =========================================================================
    // UTILITIES
    // =========================================================================

    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    private sanitizeCommandId(commandId: string): string {
        // Remove any potential sensitive prefixes, keep just the command name
        const parts = commandId.split('.');
        return parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : commandId;
    }

    private getTokenRange(tokens: number): string {
        if (tokens < 1000) return '0-1k';
        if (tokens < 10000) return '1k-10k';
        if (tokens < 100000) return '10k-100k';
        return '100k+';
    }
}

// =============================================================================
// CONVENIENCE EXPORT
// =============================================================================

/**
 * Quick access to telemetry instance
 * Usage: import { telemetry } from './acidniTelemetry';
 *        telemetry()?.trackCommand(...)
 */
export function telemetry(): AcidniTelemetry | null {
    return AcidniTelemetry.getInstance();
}
