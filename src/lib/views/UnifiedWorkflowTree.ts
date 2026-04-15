import * as vscode from 'vscode';
import { AppStoreConnectClient } from '../appstoreconnect/client';
import { TreeNode, WorkflowNode, BuildRunNode, BuildActionNode, TestResultNode, IssueNode } from './nodes';
export { TreeNode, WorkflowNode, BuildRunNode, BuildActionNode, TestResultNode, IssueNode } from './nodes';

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
