import * as vscode from 'vscode';

export function formatDuration(seconds: number): string {
    if (seconds < 60) { return `${Math.round(seconds)}s`; }
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) {
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

export function formatDurationMs(ms: number): string {
    return formatDuration(ms / 1000);
}

export function formatStatus(progress: string, completionStatus: string): string {
    if (progress === 'PENDING') { return 'Pending'; }
    if (progress === 'RUNNING') { return 'Running'; }
    if (completionStatus === 'SUCCEEDED') { return 'Succeeded'; }
    if (completionStatus === 'FAILED') { return 'Failed'; }
    if (completionStatus === 'CANCELED') { return 'Canceled'; }
    if (completionStatus === 'SKIPPED') { return 'Skipped'; }
    return completionStatus || progress || 'Unknown';
}

export function getStatusIcon(progress: string, completionStatus: string): vscode.ThemeIcon {
    if (progress === 'PENDING') { return new vscode.ThemeIcon('clock'); }
    if (progress === 'RUNNING') { return new vscode.ThemeIcon('sync~spin'); }
    if (completionStatus === 'SUCCEEDED') { return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')); }
    if (completionStatus === 'FAILED') { return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')); }
    if (completionStatus === 'CANCELED') { return new vscode.ThemeIcon('stop'); }
    if (completionStatus === 'SKIPPED') { return new vscode.ThemeIcon('debug-step-over'); }
    return new vscode.ThemeIcon('question');
}
