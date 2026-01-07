import * as vscode from 'vscode';
import { AppStoreConnectClient } from '../appstoreconnect/client';
import { WorkflowsTreeDataProvider } from './WorkflowsTree';

export class BuildRunsTreeDataProvider implements vscode.TreeDataProvider<BuildRunItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private selectedWorkflowId: string | null = null;

    constructor(private client: AppStoreConnectClient, private workflows: WorkflowsTreeDataProvider) { }

    refresh(workflowId?: string) {
        if (workflowId) {
            this.selectedWorkflowId = workflowId;
        }
        this._onDidChangeTreeData.fire();
    }

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

    getTreeItem(element: BuildRunItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<BuildRunItem[]> {
        try {
            const workflowId = this.selectedWorkflowId || (await this.workflows.pickWorkflowId());
            if (!workflowId) { return []; }

            const runs = await this.client.listBuildRuns({ workflowId, limit: 25 });
            return (runs?.data || []).map((run: any) => {
                const progress = run?.attributes?.executionProgress || 'unknown';
                const state = run?.attributes?.completionStatus || '';
                const started = run?.attributes?.startedDate || '';
                const finished = run?.attributes?.finishedDate || '';
                const number = run?.attributes?.number || run.id.slice(-6);

                // Determine if build is active (can be canceled)
                const isActive = ['PENDING', 'RUNNING'].includes(progress.toUpperCase());

                const item = new BuildRunItem(
                    run.id,
                    `#${number}`,
                    formatStatus(progress, state),
                    isActive,
                    started,
                    finished
                );
                item.iconPath = statusIcon(progress, state);
                return item;
            });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load build runs: ${err?.message || String(err)}`);
            return [];
        }
    }
}

function formatStatus(progress: string, state: string): string {
    const p = progress.toLowerCase();
    const s = state.toLowerCase();

    if (p === 'complete') {
        if (s === 'succeeded') { return '✓ Succeeded'; }
        if (s === 'failed') { return '✗ Failed'; }
        if (s === 'canceled' || s === 'cancelled') { return '⊘ Canceled'; }
        return `Complete (${state})`;
    }
    if (p === 'pending') { return '◷ Pending'; }
    if (p === 'running') { return '● Running'; }
    return progress;
}

function statusIcon(progress: string, state: string): vscode.ThemeIcon {
    const p = progress.toLowerCase();
    const s = state.toLowerCase();

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

export class BuildRunItem extends vscode.TreeItem {
    constructor(
        public readonly id: string,
        label: string,
        status: string,
        isActive: boolean,
        started?: string,
        finished?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = status;
        this.contextValue = isActive ? 'buildRunActive' : 'buildRunComplete';
        this.tooltip = new vscode.MarkdownString(
            `**Build ${label}**\n\n` +
            `Status: ${status}\n\n` +
            `Started: ${started ? new Date(started).toLocaleString() : '-'}\n\n` +
            `Finished: ${finished ? new Date(finished).toLocaleString() : '-'}`
        );
    }
}

