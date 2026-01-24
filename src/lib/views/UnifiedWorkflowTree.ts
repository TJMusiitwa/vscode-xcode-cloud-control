import * as vscode from 'vscode';
import { AppStoreConnectClient } from '../appstoreconnect/client';

// =======================
// Node Types
// =======================

type TreeNode = WorkflowNode | BuildRunNode | BuildActionNode;

export class WorkflowNode extends vscode.TreeItem {
    readonly nodeType = 'workflow' as const;

    constructor(
        public readonly workflowId: string,
        public readonly workflowName: string,
        public readonly productName: string,
        public readonly isEnabled: boolean,
        public readonly appId?: string
    ) {
        super(workflowName, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = productName;
        this.contextValue = 'workflow';
        this.iconPath = new vscode.ThemeIcon('gear');
        this.tooltip = new vscode.MarkdownString(
            `**${workflowName}**\n\n` +
            `Product: ${productName}\n\n` +
            `Status: ${isEnabled ? 'Enabled' : 'Disabled'}`
        );
    }
}

export class BuildRunNode extends vscode.TreeItem {
    readonly nodeType = 'buildRun' as const;

    constructor(
        public readonly buildRunId: string,
        public readonly workflowId: string,
        public readonly runNumber: number | string,
        public readonly executionProgress: string,
        public readonly completionStatus: string,
        public readonly startedDate?: string,
        public readonly finishedDate?: string,
        public readonly appId?: string
    ) {
        super(`#${runNumber}`, vscode.TreeItemCollapsibleState.Collapsed);

        const isActive = ['PENDING', 'RUNNING'].includes(executionProgress.toUpperCase());
        this.contextValue = isActive ? 'buildRunActive' : 'buildRunComplete';
        this.description = this.formatStatus();
        this.iconPath = this.getStatusIcon();
        this.tooltip = this.buildTooltip();
    }

    private formatStatus(): string {
        const p = this.executionProgress.toLowerCase();
        const s = this.completionStatus.toLowerCase();

        if (p === 'complete') {
            if (s === 'succeeded') { return 'Succeeded'; }
            if (s === 'failed') { return 'Failed'; }
            if (s === 'canceled' || s === 'cancelled') { return 'Canceled'; }
            return this.completionStatus || 'Complete';
        }
        if (p === 'pending') { return 'Pending'; }
        if (p === 'running') { return 'Running'; }
        return this.executionProgress;
    }

    private getStatusIcon(): vscode.ThemeIcon {
        const p = this.executionProgress.toLowerCase();
        const s = this.completionStatus.toLowerCase();

        if (p === 'complete') {
            if (s === 'succeeded') { return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed')); }
            if (s === 'failed') { return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')); }
            if (s === 'canceled' || s === 'cancelled') { return new vscode.ThemeIcon('circle-slash'); }
            return new vscode.ThemeIcon('check');
        }
        if (p === 'pending') { return new vscode.ThemeIcon('clock'); }
        if (p === 'running') { return new vscode.ThemeIcon('sync~spin'); }
        return new vscode.ThemeIcon('question');
    }

    private buildTooltip(): vscode.MarkdownString {
        const parts = [`**Build #${this.runNumber}**`];
        parts.push(`Status: ${this.formatStatus()}`);
        if (this.startedDate) {
            parts.push(`Started: ${new Date(this.startedDate).toLocaleString()}`);
        }
        if (this.finishedDate) {
            parts.push(`Finished: ${new Date(this.finishedDate).toLocaleString()}`);
        }
        if (this.startedDate && this.finishedDate) {
            const duration = (new Date(this.finishedDate).getTime() - new Date(this.startedDate).getTime()) / 1000;
            parts.push(`Duration: ${formatDuration(duration)}`);
        }
        return new vscode.MarkdownString(parts.join('\n\n'));
    }
}

export class BuildActionNode extends vscode.TreeItem {
    readonly nodeType = 'buildAction' as const;

    constructor(
        public readonly actionId: string,
        public readonly buildRunId: string,
        public readonly actionName: string,
        public readonly actionType: string,
        public readonly executionProgress: string,
        public readonly completionStatus: string,
        public readonly startedDate?: string,
        public readonly finishedDate?: string
    ) {
        super(actionName, vscode.TreeItemCollapsibleState.None);

        this.contextValue = 'buildAction';
        this.description = this.formatStatus();
        this.iconPath = this.getStatusIcon();
        this.tooltip = this.buildTooltip();
    }

    private formatStatus(): string {
        const p = this.executionProgress.toUpperCase();
        const s = this.completionStatus.toUpperCase();

        if (p === 'COMPLETE') {
            if (s === 'SUCCEEDED') { return 'Succeeded'; }
            if (s === 'FAILED') { return 'Failed'; }
            if (s === 'CANCELED' || s === 'CANCELLED') { return 'Canceled'; }
            if (s === 'SKIPPED') { return 'Skipped'; }
            return this.completionStatus || 'Complete';
        }
        if (p === 'PENDING') { return 'Pending'; }
        if (p === 'RUNNING') { return 'Running...'; }
        return this.executionProgress;
    }

    private getStatusIcon(): vscode.ThemeIcon {
        const p = this.executionProgress.toUpperCase();
        const s = this.completionStatus.toUpperCase();

        if (p === 'COMPLETE') {
            if (s === 'SUCCEEDED') { return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed')); }
            if (s === 'FAILED') { return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')); }
            if (s === 'SKIPPED') { return new vscode.ThemeIcon('debug-step-over'); }
            return new vscode.ThemeIcon('check');
        }
        if (p === 'RUNNING') { return new vscode.ThemeIcon('sync~spin'); }
        return new vscode.ThemeIcon('circle-outline');
    }

    private buildTooltip(): vscode.MarkdownString {
        const parts = [`**${this.actionName}**`];
        if (this.actionType) { parts.push(`Type: ${this.actionType}`); }
        parts.push(`Status: ${this.formatStatus()}`);
        if (this.startedDate) {
            parts.push(`Started: ${new Date(this.startedDate).toLocaleString()}`);
        }
        if (this.finishedDate) {
            parts.push(`Finished: ${new Date(this.finishedDate).toLocaleString()}`);
        }
        if (this.startedDate && this.finishedDate) {
            const duration = (new Date(this.finishedDate).getTime() - new Date(this.startedDate).getTime()) / 1000;
            parts.push(`Duration: ${formatDuration(duration)}`);
        }
        return new vscode.MarkdownString(parts.join('\n\n'));
    }
}

// =======================
// Unified TreeDataProvider
// =======================

export class UnifiedWorkflowTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Sort order: 'desc' = newest first (default), 'asc' = oldest first
    private _sortOrder: 'asc' | 'desc' = 'desc';

    constructor(private client: AppStoreConnectClient) { }

    get sortOrder(): 'asc' | 'desc' {
        return this._sortOrder;
    }

    toggleSortOrder(): void {
        this._sortOrder = this._sortOrder === 'desc' ? 'asc' : 'desc';
        this.refresh();
    }

    refresh(node?: TreeNode): void {
        this._onDidChangeTreeData.fire(node);
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        try {
            // Root level: return all workflows
            if (!element) {
                return this.getWorkflows();
            }

            // Workflow node: return build runs
            if (element.nodeType === 'workflow') {
                return this.getBuildRuns(element);
            }

            // Build run node: return build actions
            if (element.nodeType === 'buildRun') {
                return this.getBuildActions(element);
            }

            // Build action node: no children (leaf)
            return [];
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load tree data: ${err?.message || String(err)}`);
            return [];
        }
    }

    // Helper: pick a workflow for commands
    async pickWorkflowId(): Promise<string | undefined> {
        const workflows = await this.client.listAllWorkflows();
        const items = (workflows?.data || []).map((wf: any) => ({
            label: wf?.attributes?.name || wf.id,
            description: wf._productName || wf.id,
            id: wf.id
        }));
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select workflow' });
        return (pick as any)?.id;
    }

    // Helper: pick git reference for triggering builds
    async pickGitReferenceId(workflowId: string): Promise<string | undefined> {
        const wf = await this.client.getWorkflow(workflowId);
        const repoId = wf?.data?.relationships?.repository?.data?.id;
        if (!repoId) { return undefined; }

        const refs = await this.client.listGitReferences(repoId);
        const items = (refs?.data || []).map((ref: any) => ({
            label: ref?.attributes?.name || ref.id,
            description: ref?.attributes?.kind || '',
            id: ref.id
        }));
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select branch/tag (optional)' });
        return (pick as any)?.id;
    }

    private async getWorkflows(): Promise<WorkflowNode[]> {
        const workflows = await this.client.listAllWorkflows();
        return (workflows?.data || []).map((wf: any) => new WorkflowNode(
            wf.id,
            wf?.attributes?.name || wf.id,
            wf._productName || 'Unknown Product',
            wf?.attributes?.isEnabled ?? true,
            wf._appId
        ));
    }

    private async getBuildRuns(workflow: WorkflowNode): Promise<BuildRunNode[]> {
        const runs = await this.client.listBuildRuns({ workflowId: workflow.workflowId, limit: 25 });
        const nodes = (runs?.data || []).map((run: any) => {
            const attrs = run?.attributes || {};
            return new BuildRunNode(
                run.id,
                workflow.workflowId,
                attrs.number || run.id.slice(-6),
                attrs.executionProgress || 'unknown',
                attrs.completionStatus || '',
                attrs.startedDate,
                attrs.finishedDate,
                workflow.appId
            );
        });

        // Sort by run number
        nodes.sort((a: BuildRunNode, b: BuildRunNode) => {
            const numA = typeof a.runNumber === 'number' ? a.runNumber : parseInt(String(a.runNumber), 10) || 0;
            const numB = typeof b.runNumber === 'number' ? b.runNumber : parseInt(String(b.runNumber), 10) || 0;
            return this._sortOrder === 'desc' ? numB - numA : numA - numB;
        });

        return nodes;
    }

    private async getBuildActions(buildRun: BuildRunNode): Promise<BuildActionNode[]> {
        const response = await this.client.getBuildActions(buildRun.buildRunId);
        const actions = response?.data || [];

        if (actions.length === 0) {
            // Return a placeholder if no actions
            return [new BuildActionNode(
                'no-actions',
                buildRun.buildRunId,
                'No build actions available',
                '',
                'COMPLETE',
                'SKIPPED'
            )];
        }

        return actions.map((action: any) => {
            const attrs = action?.attributes || {};
            return new BuildActionNode(
                action.id,
                buildRun.buildRunId,
                attrs.name || 'Unknown Action',
                attrs.actionType || '',
                attrs.executionProgress || 'PENDING',
                attrs.completionStatus || '',
                attrs.startedDate,
                attrs.finishedDate
            );
        });
    }
}

// =======================
// Utility Functions
// =======================

function formatDuration(seconds: number): string {
    if (seconds < 60) { return `${Math.round(seconds)}s`; }
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) { return `${mins}m ${secs}s`; }
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}m`;
}
