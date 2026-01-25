import * as assert from 'assert';
import * as vscode from 'vscode';
import { BuildActionNode, BuildRunNode, UnifiedWorkflowTreeDataProvider, WorkflowNode } from '../lib/views/UnifiedWorkflowTree';
import { restoreAll, stubErrorMessage, stubQuickPick } from './helpers';

class MockClient {
    constructor(private responses: Record<string, any> = {}) { }
    async listAllWorkflows(): Promise<any> { return this.responses.listAllWorkflows; }
    async listBuildRuns(_: any): Promise<any> { return this.responses.listBuildRuns; }
    async getBuildActions(_: string): Promise<any> { return this.responses.getBuildActions; }
    async getWorkflow(_: string): Promise<any> { return this.responses.getWorkflow; }
    async listGitReferences(_: string): Promise<any> { return this.responses.listGitReferences; }
    async getIssues(_: string): Promise<any> { return this.responses.getIssues || { data: [] }; }
    async getTestResults(_: string): Promise<any> { return this.responses.getTestResults || { data: [] }; }
}

suite('UnifiedWorkflowTreeDataProvider', () => {
    test('getChildren at root returns workflows', async () => {
        const client = new MockClient({
            listAllWorkflows: {
                data: [
                    { id: 'wf-1', attributes: { name: 'Workflow 1', isEnabled: true }, _productName: 'App 1' },
                    { id: 'wf-2', attributes: { name: 'Workflow 2', isEnabled: false }, _productName: 'App 2' },
                ]
            }
        });
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const items = await provider.getChildren();

        assert.strictEqual(items.length, 2);
        assert.ok(items[0] instanceof WorkflowNode);
        assert.strictEqual((items[0] as WorkflowNode).workflowName, 'Workflow 1');
        assert.strictEqual((items[1] as WorkflowNode).workflowName, 'Workflow 2');
    });

    test('getChildren with workflow returns build runs', async () => {
        const client = new MockClient({
            listBuildRuns: {
                data: [
                    { id: 'r1', attributes: { number: 1, executionProgress: 'PENDING', completionStatus: '' } },
                    { id: 'r2', attributes: { number: 2, executionProgress: 'RUNNING', completionStatus: '' } },
                    { id: 'r3', attributes: { number: 3, executionProgress: 'COMPLETE', completionStatus: 'SUCCEEDED' } },
                ]
            }
        });
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const workflow = new WorkflowNode('wf-1', 'Test Workflow', 'App', true);
        const items = await provider.getChildren(workflow);

        assert.strictEqual(items.length, 3);
        assert.ok(items[0] instanceof BuildRunNode);
        // Default sort is 'desc' (newest first), so run 3 is first
        assert.strictEqual((items[0] as BuildRunNode).runNumber, 3);
        assert.strictEqual((items[2] as BuildRunNode).runNumber, 1);
    });

    test('getChildren with build run returns build actions', async () => {
        const client = new MockClient({
            getBuildActions: {
                data: [
                    { id: 'a1', attributes: { name: 'Build Step', actionType: 'BUILD', executionProgress: 'COMPLETE', completionStatus: 'SUCCEEDED' } },
                    { id: 'a2', attributes: { name: 'Test Step', actionType: 'TEST', executionProgress: 'RUNNING', completionStatus: '' } },
                ]
            }
        });
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const buildRun = new BuildRunNode('br-1', 'wf-1', 42, 'COMPLETE', 'SUCCEEDED');
        const items = await provider.getChildren(buildRun);

        assert.strictEqual(items.length, 2);
        assert.ok(items[0] instanceof BuildActionNode);
        assert.strictEqual((items[0] as BuildActionNode).actionName, 'Build Step');
        assert.strictEqual((items[1] as BuildActionNode).actionName, 'Test Step');
    });

    test('getChildren with build action returns issues (or placeholder)', async () => {
        const client = new MockClient({});
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const action = new BuildActionNode('a1', 'br-1', 'Build', 'BUILD', 'COMPLETE', 'SUCCEEDED');
        const items = await provider.getChildren(action);

        // With no issues from API, should return placeholder
        assert.strictEqual(items.length, 1);
    });

    test('build run status icons', async () => {
        const client = new MockClient({
            listBuildRuns: {
                data: [
                    { id: 'r1', attributes: { number: 1, executionProgress: 'PENDING', completionStatus: '' } },
                    { id: 'r2', attributes: { number: 2, executionProgress: 'RUNNING', completionStatus: '' } },
                    { id: 'r3', attributes: { number: 3, executionProgress: 'COMPLETE', completionStatus: 'SUCCEEDED' } },
                    { id: 'r4', attributes: { number: 4, executionProgress: 'COMPLETE', completionStatus: 'FAILED' } },
                    { id: 'r5', attributes: { number: 5, executionProgress: 'COMPLETE', completionStatus: 'CANCELED' } },
                ]
            }
        });
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const workflow = new WorkflowNode('wf-1', 'Test', 'App', true);
        const items = await provider.getChildren(workflow) as BuildRunNode[];

        assert.strictEqual(items.length, 5);
        items.forEach(i => assert.ok(i.iconPath instanceof vscode.ThemeIcon));
    });

    test('pickGitReferenceId returns selected ref id', async () => {
        const client = new MockClient({
            getWorkflow: { data: { relationships: { repository: { data: { id: 'repo-1' } } } } },
            listGitReferences: { data: [{ id: 'ref-1', attributes: { name: 'main', kind: 'BRANCH' } }] }
        });
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const stub = stubQuickPick({ label: 'main', description: 'BRANCH', id: 'ref-1' } as any);
        try {
            const id = await provider.pickGitReferenceId('wf-123');
            assert.strictEqual(id, 'ref-1');
        } finally {
            stub.restore();
        }
    });

    test('getChildren handles API error and returns empty', async () => {
        const errStub = stubErrorMessage();
        const client = new MockClient();
        client.listAllWorkflows = async () => { throw new Error('kaput'); };
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        try {
            const items = await provider.getChildren();
            assert.strictEqual(items.length, 0);
            assert.ok(errStub.calls[0]?.includes('Failed to load tree data'));
        } finally {
            restoreAll([errStub.stub]);
        }
    });
});
