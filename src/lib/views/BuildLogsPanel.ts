import * as vscode from 'vscode';
import { AppStoreConnectClient } from '../appstoreconnect/client';

/**
 * Tree data provider for displaying build actions (steps) for a selected build run
 */
export class BuildActionsTreeDataProvider implements vscode.TreeDataProvider<BuildActionItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private selectedBuildRunId: string | null = null;
    private selectedBuildLabel: string | null = null;

    constructor(private client: AppStoreConnectClient) { }

    /**
     * Set the build run to display actions for
     */
    setBuildRun(buildRunId: string, label?: string) {
        this.selectedBuildRunId = buildRunId;
        this.selectedBuildLabel = label || `Build ${buildRunId.slice(-6)}`;
        this.refresh();
    }

    /**
     * Clear the selected build run
     */
    clear() {
        this.selectedBuildRunId = null;
        this.selectedBuildLabel = null;
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BuildActionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: BuildActionItem): Promise<BuildActionItem[]> {
        // If no build run selected, show placeholder
        if (!this.selectedBuildRunId) {
            return [new BuildActionItem(
                'placeholder',
                'Select a build to view actions',
                '',
                'none',
                true
            )];
        }

        // Root level - show build info and actions
        if (!element) {
            return this._getBuildActions();
        }

        // No nested children for now
        return [];
    }

    private async _getBuildActions(): Promise<BuildActionItem[]> {
        if (!this.selectedBuildRunId) { return []; }

        try {
            // Fetch build actions
            const response = await this.client.getBuildActions(this.selectedBuildRunId);
            const actions = response?.data || [];

            if (actions.length === 0) {
                return [new BuildActionItem(
                    'empty',
                    'No build actions available',
                    '',
                    'none',
                    true
                )];
            }

            return actions.map((action: any) => {
                const attrs = action?.attributes || {};
                const name = attrs.name || 'Unknown Action';
                const actionType = attrs.actionType || '';
                const progress = attrs.executionProgress || 'PENDING';
                const status = attrs.completionStatus || '';
                const started = attrs.startedDate;
                const finished = attrs.finishedDate;

                return new BuildActionItem(
                    action.id,
                    name,
                    formatActionStatus(progress, status),
                    getActionState(progress, status),
                    false,
                    actionType,
                    started,
                    finished
                );
            });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load build actions: ${err?.message || String(err)}`);
            return [new BuildActionItem(
                'error',
                'Error loading actions',
                err?.message || 'Unknown error',
                'error',
                true
            )];
        }
    }

    /**
     * Get the current build label for display
     */
    getBuildLabel(): string | null {
        return this.selectedBuildLabel;
    }
}

function formatActionStatus(progress: string, status: string): string {
    const p = progress.toUpperCase();
    const s = status.toUpperCase();

    if (p === 'COMPLETE') {
        if (s === 'SUCCEEDED') { return 'Succeeded'; }
        if (s === 'FAILED') { return 'Failed'; }
        if (s === 'CANCELED' || s === 'CANCELLED') { return 'Canceled'; }
        if (s === 'SKIPPED') { return 'Skipped'; }
        return status || 'Complete';
    }
    if (p === 'PENDING') { return 'Pending'; }
    if (p === 'RUNNING') { return 'Running...'; }
    return progress;
}

function getActionState(progress: string, status: string): 'success' | 'error' | 'running' | 'pending' | 'skipped' | 'none' {
    const p = progress.toUpperCase();
    const s = status.toUpperCase();

    if (p === 'COMPLETE') {
        if (s === 'SUCCEEDED') { return 'success'; }
        if (s === 'FAILED') { return 'error'; }
        if (s === 'SKIPPED') { return 'skipped'; }
        return 'success';
    }
    if (p === 'RUNNING') { return 'running'; }
    return 'pending';
}

export class BuildActionItem extends vscode.TreeItem {
    constructor(
        public readonly id: string,
        label: string,
        status: string,
        state: 'success' | 'error' | 'running' | 'pending' | 'skipped' | 'none',
        isPlaceholder: boolean = false,
        actionType?: string,
        started?: string,
        finished?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);

        this.description = status;
        this.contextValue = isPlaceholder ? 'placeholder' : 'buildAction';

        // Set icon based on state
        switch (state) {
            case 'success':
                this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
                break;
            case 'running':
                this.iconPath = new vscode.ThemeIcon('sync~spin');
                break;
            case 'pending':
                this.iconPath = new vscode.ThemeIcon('circle-outline');
                break;
            case 'skipped':
                this.iconPath = new vscode.ThemeIcon('debug-step-over');
                break;
            case 'none':
            default:
                this.iconPath = new vscode.ThemeIcon('info');
                break;
        }

        // Build tooltip
        if (!isPlaceholder) {
            const tooltipParts = [`**${label}**`];
            if (actionType) { tooltipParts.push(`Type: ${actionType}`); }
            tooltipParts.push(`Status: ${status}`);
            if (started) { tooltipParts.push(`Started: ${new Date(started).toLocaleString()}`); }
            if (finished) { tooltipParts.push(`Finished: ${new Date(finished).toLocaleString()}`); }
            if (started && finished) {
                const duration = (new Date(finished).getTime() - new Date(started).getTime()) / 1000;
                tooltipParts.push(`Duration: ${formatDuration(duration)}`);
            }
            this.tooltip = new vscode.MarkdownString(tooltipParts.join('\n\n'));
        }
    }
}

function formatDuration(seconds: number): string {
    if (seconds < 60) { return `${Math.round(seconds)}s`; }
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) { return `${mins}m ${secs}s`; }
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}m`;
}
