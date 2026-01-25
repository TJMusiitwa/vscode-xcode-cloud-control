import * as vscode from 'vscode';
import { AppStoreConnectClient } from '../appstoreconnect/client';

// =======================
// Node Types
// =======================

type TreeNode = WorkflowNode | BuildRunNode | BuildActionNode | TestResultNode | IssueNode;

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
        this.command = {
            command: 'xcodecloud.viewWorkflowDetails',
            title: 'View Workflow Details',
            arguments: [this]
        };
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
        // All completed actions are collapsible to show issues; TEST actions also show test results
        const isTestAction = actionType.toUpperCase() === 'TEST';
        const isComplete = executionProgress.toUpperCase() === 'COMPLETE';
        const collapsibleState = isComplete
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        super(actionName, collapsibleState);

        this.contextValue = isTestAction ? 'buildActionTest' : 'buildAction';
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

export class TestResultNode extends vscode.TreeItem {
    readonly nodeType = 'testResult' as const;

    constructor(
        public readonly testId: string,
        public readonly className: string,
        public readonly testName: string,
        public readonly status: 'passed' | 'failed' | 'skipped' | 'expectedFailure' | 'unknown',
        public readonly duration?: number,
        public readonly destinationName?: string,
        public readonly message?: string
    ) {
        // Display test name as label, or class name if no test name
        super(testName || className, vscode.TreeItemCollapsibleState.None);

        this.contextValue = 'testResult';
        this.description = this.formatStatus();
        this.iconPath = this.getStatusIcon();
        this.tooltip = this.buildTooltip();
    }

    private formatStatus(): string {
        const parts: string[] = [];
        if (this.duration !== undefined) {
            parts.push(formatDuration(this.duration));
        }
        return parts.join(' • ') || this.status;
    }

    private getStatusIcon(): vscode.ThemeIcon {
        switch (this.status) {
            case 'passed':
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case 'skipped':
                return new vscode.ThemeIcon('debug-step-over');
            case 'expectedFailure':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private buildTooltip(): vscode.MarkdownString {
        const parts = [`**${this.testName || 'Test'}**`];
        if (this.className) { parts.push(`Class: \`${this.className}\``); }
        parts.push(`Status: ${this.status}`);
        if (this.duration !== undefined) {
            parts.push(`Duration: ${formatDuration(this.duration)}`);
        }
        if (this.destinationName) {
            parts.push(`Device: ${this.destinationName}`);
        }
        if (this.message) {
            parts.push(`\n---\n\n${this.message}`);
        }
        return new vscode.MarkdownString(parts.join('\n\n'));
    }
}

export class IssueNode extends vscode.TreeItem {
    readonly nodeType = 'issue' as const;

    constructor(
        public readonly issueId: string,
        public readonly issueType: 'ANALYZER_WARNING' | 'ERROR' | 'TEST_FAILURE' | 'WARNING',
        public readonly message: string,
        public readonly selfLink?: string,
        public readonly filePath?: string,
        public readonly lineNumber?: number
    ) {
        super(message || 'Unknown Issue', vscode.TreeItemCollapsibleState.None);

        this.contextValue = 'issue';
        this.description = this.formatIssueType();
        this.iconPath = this.getIssueIcon();
        this.tooltip = this.buildTooltip();
    }

    private formatIssueType(): string {
        // Convert ANALYZER_WARNING -> Analyzer Warning, etc.
        return this.issueType.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    private getIssueIcon(): vscode.ThemeIcon {
        switch (this.issueType) {
            case 'ERROR':
            case 'TEST_FAILURE':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case 'WARNING':
            case 'ANALYZER_WARNING':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
            default:
                return new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground'));
        }
    }

    private buildTooltip(): vscode.MarkdownString {
        const parts = [`**${this.formatIssueType()}**`];
        if (this.message) { parts.push(`\n---\n\n${this.message}`); }
        if (this.filePath) {
            const location = this.lineNumber ? `${this.filePath}:${this.lineNumber}` : this.filePath;
            parts.push(`\nLocation: \`${location}\``);
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
                return await this.getWorkflows();
            }

            // Workflow node: return build runs
            if (element.nodeType === 'workflow') {
                return await this.getBuildRuns(element);
            }

            // Build run node: return build actions
            if (element.nodeType === 'buildRun') {
                return await this.getBuildActions(element);
            }

            // Build action node: return test results (for TEST) and/or issues
            if (element.nodeType === 'buildAction') {
                return await this.getBuildActionChildren(element);
            }

            // Test result node: no children (leaf)
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

    private async getTestResults(buildAction: BuildActionNode): Promise<TestResultNode[]> {
        const response = await this.client.getTestResults(buildAction.actionId, { limit: 100 });
        const results = response?.data || [];

        if (results.length === 0) {
            // Return a placeholder if no test results
            return [new TestResultNode(
                'no-results',
                '',
                'No test results available',
                'unknown'
            )];
        }

        return results.map((result: any) => {
            const attrs = result?.attributes || {};

            // Map API status to our status type
            let status: 'passed' | 'failed' | 'skipped' | 'expectedFailure' | 'unknown' = 'unknown';
            const apiStatus = (attrs.status || '').toUpperCase();
            if (apiStatus === 'SUCCESS' || apiStatus === 'PASSED') {
                status = 'passed';
            } else if (apiStatus === 'FAILURE' || apiStatus === 'FAILED') {
                status = 'failed';
            } else if (apiStatus === 'SKIPPED') {
                status = 'skipped';
            } else if (apiStatus === 'EXPECTED_FAILURE') {
                status = 'expectedFailure';
            }

            return new TestResultNode(
                result.id,
                attrs.className || '',
                attrs.name || attrs.className || 'Unknown Test',
                status,
                attrs.duration,
                attrs.destinationDisplayName,
                attrs.message
            );
        });
    }

    private async getBuildActionChildren(buildAction: BuildActionNode): Promise<(TestResultNode | IssueNode)[]> {
        const children: (TestResultNode | IssueNode)[] = [];

        // Fetch test results for TEST actions
        if (buildAction.actionType.toUpperCase() === 'TEST') {
            const testResults = await this.getTestResults(buildAction);
            // Filter out placeholder nodes
            const validResults = testResults.filter(r => r.testId !== 'no-results');
            children.push(...validResults);
        }

        // Fetch issues for all action types
        const issues = await this.getIssues(buildAction);
        children.push(...issues);

        // Return placeholder if no children
        if (children.length === 0) {
            return [new IssueNode('no-issues', 'WARNING', 'No issues found')];
        }

        return children;
    }

    private async getIssues(buildAction: BuildActionNode): Promise<IssueNode[]> {
        try {
            const response = await this.client.getIssues(buildAction.actionId, { limit: 100 });
            const issues = response?.data || [];

            return issues.map((issue: any) => {
                const attrs = issue?.attributes || {};
                const issueType = (attrs.issueType || 'ERROR') as 'ANALYZER_WARNING' | 'ERROR' | 'TEST_FAILURE' | 'WARNING';

                return new IssueNode(
                    issue.id,
                    issueType,
                    attrs.message || 'No message',
                    issue.links?.self,
                    attrs.fileSource?.path,
                    attrs.fileSource?.lineNumber
                );
            });
        } catch {
            // Return empty array on error - issues are optional
            return [];
        }
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
