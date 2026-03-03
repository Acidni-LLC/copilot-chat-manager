/**
 * Acidni Telemetry - Integration Examples
 * 
 * Copy acidniTelemetry.ts to your extension's src/services/ folder
 * Then follow these patterns to integrate telemetry.
 */

import * as vscode from 'vscode';
import { AcidniTelemetry, telemetry } from './services/acidniTelemetry';

// =============================================================================
// EXTENSION ACTIVATION / DEACTIVATION
// =============================================================================

export function activate(context: vscode.ExtensionContext) {
    // Initialize telemetry FIRST
    AcidniTelemetry.initialize(context, 'ACCM', '0.1.27');
    telemetry()?.trackActivation('startup');

    // ... rest of activation code
}

export function deactivate() {
    // Dispose telemetry LAST (ensures deactivation event is sent)
    AcidniTelemetry.dispose();
}

// =============================================================================
// COMMAND TRACKING
// =============================================================================

// Pattern 1: Wrap command registration
function registerTrackedCommand(
    context: vscode.ExtensionContext,
    commandId: string,
    category: string,
    handler: (...args: any[]) => Promise<any>
) {
    const disposable = vscode.commands.registerCommand(commandId, async (...args) => {
        const startTime = Date.now();
        let success = true;
        let errorType: string | undefined;
        let resultCount: number | undefined;

        try {
            const result = await handler(...args);
            if (Array.isArray(result)) {
                resultCount = result.length;
            }
            return result;
        } catch (error) {
            success = false;
            errorType = (error as Error).constructor.name;
            telemetry()?.trackError(error as Error, commandId, false, true);
            throw error;
        } finally {
            telemetry()?.trackCommand(
                commandId,
                category,
                Date.now() - startTime,
                success,
                { errorType, resultCount }
            );
        }
    });
    
    context.subscriptions.push(disposable);
}

// Usage:
// registerTrackedCommand(context, 'accm.exportChat', 'export', async () => { ... });
// registerTrackedCommand(context, 'accm.scanHistory', 'scan', async () => { ... });

// Pattern 2: Manual tracking in existing commands
vscode.commands.registerCommand('accm.refreshHistory', async () => {
    const timer = telemetry()?.startTimer('refresh');
    
    try {
        const chats = await scanAllChats();
        timer?.end(chats.length);
        
        telemetry()?.trackCommand('accm.refreshHistory', 'scan', 0, true, {
            resultCount: chats.length
        });
        
        return chats;
    } catch (error) {
        timer?.end(0);
        telemetry()?.trackError(error as Error, 'refreshHistory');
        throw error;
    }
});

// =============================================================================
// FEATURE TRACKING
// =============================================================================

// Track tree view interactions
class ChatHistoryProvider implements vscode.TreeDataProvider<any> {
    getChildren() {
        telemetry()?.trackFeature('chatHistoryTree', 'expanded', {
            context: 'sidebar'
        });
        // ... return children
        return [];
    }
}

// Track webview usage
function openDashboard() {
    telemetry()?.trackFeature('dashboard', 'opened', {
        context: 'webview'
    });
    
    // When closed:
    // telemetry()?.trackFeature('dashboard', 'closed', { context: 'webview' });
}

// Track clicks/interactions
function onTreeItemClicked(item: any) {
    telemetry()?.trackFeature('chatItem', 'clicked', {
        context: 'treeView'
    });
}

// =============================================================================
// PERFORMANCE TRACKING
// =============================================================================

// Pattern 1: Using timer
async function scanWorkspace() {
    const timer = telemetry()?.startTimer('workspaceScan');
    
    const files = await doScan();
    
    timer?.end(files.length, false); // false = not cached
    
    return files;
}

// Pattern 2: Using timed() wrapper
async function analyzeFiles() {
    return telemetry()?.timed(
        'fileAnalysis',
        async () => {
            const results = await performAnalysis();
            return results;
        },
        (results) => results.length // How to get item count from result
    );
}

// Pattern 3: Manual with cache tracking
async function loadChatHistory(forceRefresh: boolean) {
    const startTime = Date.now();
    const cachedData = getCachedData();
    
    if (!forceRefresh && cachedData) {
        telemetry()?.trackPerformance('loadHistory', Date.now() - startTime, cachedData.length, true);
        return cachedData;
    }
    
    const freshData = await fetchFreshData();
    telemetry()?.trackPerformance('loadHistory', Date.now() - startTime, freshData.length, false);
    return freshData;
}

// =============================================================================
// ERROR TRACKING
// =============================================================================

// In catch blocks
async function riskyOperation() {
    try {
        await doSomethingRisky();
    } catch (error) {
        telemetry()?.trackError(
            error as Error,
            'riskyOperation',
            true,  // recoverable - we handled it
            false  // userFacing - user didn't see error message
        );
        
        // Show user-facing error
        vscode.window.showErrorMessage('Operation failed');
        telemetry()?.trackError(
            error as Error,
            'riskyOperation',
            false, // not recoverable
            true   // user saw the error
        );
    }
}

// =============================================================================
// CONFIGURATION TRACKING
// =============================================================================

// When settings change
vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('copilotChatManager.storagePath')) {
        telemetry()?.trackConfigChange('storagePath', 'string');
    }
    if (e.affectsConfiguration('copilotChatManager.autoRefresh')) {
        telemetry()?.trackConfigChange('autoRefresh', 'boolean');
    }
});

// =============================================================================
// EXTENSION-SPECIFIC EVENTS
// =============================================================================

// AACCA - Cost Analysis
function analyzeCosts(files: any[]) {
    const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);
    
    telemetry()?.trackCostAnalysis(
        'analyzed',
        'instruction',
        totalTokens,
        files.length
    );
}

// AACE - Model Management
async function selectModel() {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    
    telemetry()?.trackModel('listed', {
        modelVendor: 'copilot',
        available: models.length > 0
    });
    
    if (models.length > 0) {
        telemetry()?.trackModel('selected', {
            modelFamily: models[0].family,
            modelVendor: models[0].vendor,
            modelSource: 'vscode'
        });
    }
}

// AACE - Maturity Assessment
function runAssessment(projects: any[]) {
    telemetry()?.trackAssessment('started', 'cmmi', projects.length);
    
    // After assessment completes:
    telemetry()?.trackAssessment('completed', 'cmmi', projects.length, {
        maturityLevel: 3,
        score: 67
    });
}

// =============================================================================
// HELPER: Placeholder functions for examples
// =============================================================================
async function scanAllChats(): Promise<any[]> { return []; }
async function doScan(): Promise<any[]> { return []; }
async function performAnalysis(): Promise<any[]> { return []; }
function getCachedData(): any[] | null { return null; }
async function fetchFreshData(): Promise<any[]> { return []; }
async function doSomethingRisky(): Promise<void> { }
