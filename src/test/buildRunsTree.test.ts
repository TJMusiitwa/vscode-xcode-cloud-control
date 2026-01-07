import * as assert from 'assert';
import * as vscode from 'vscode';
import { BuildRunsTreeDataProvider } from '../lib/views/BuildRunsTree';
import { WorkflowsTreeDataProvider } from '../lib/views/WorkflowsTree';
import { restoreAll, stubErrorMessage, stubQuickPick } from './helpers';

class MockClient {
    constructor(private responses: Record<string, any> = {}) { }
    async listBuildRuns(_: any): Promise<any> { return this.responses.listBuildRuns; }
    async getWorkflow(_: string): Promise<any> { return this.responses.getWorkflow; }
    async listGitReferences(_: string): Promise<any> { return this.responses.listGitReferences; }
}

class MockWorkflowsProvider extends WorkflowsTreeDataProvider {
    constructor() { super({} as any); }
    async pickWorkflowId(): Promise<string | undefined> { return 'wf-123'; }
}

suite('BuildRunsTreeDataProvider', () => {
    test('getChildren maps runs with status and icons', async () => {
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
        const workflows = new MockWorkflowsProvider();
        const provider = new BuildRunsTreeDataProvider(client as any, workflows);
        provider.refresh('wf-123');
        const items = await provider.getChildren();
        assert.strictEqual(items.length, 5);

        const labels = items.map(i => i.label);
        assert.deepStrictEqual(labels, ['#1', '#2', '#3', '#4', '#5']);

        const desc = items.map(i => i.description);
        assert.ok((desc[0] as string).includes('Pending'));
        assert.ok((desc[1] as string).includes('Running'));
        assert.ok((desc[2] as string).includes('Succeeded'));
        assert.ok((desc[3] as string).includes('Failed'));
        assert.ok((desc[4] as string).includes('Canceled'));

        // Icons are ThemeIcons
        items.forEach(i => assert.ok(i.iconPath instanceof vscode.ThemeIcon));
    });

    test('pickGitReferenceId returns selected ref id', async () => {
        const client = new MockClient({
            getWorkflow: { data: { relationships: { repository: { data: { id: 'repo-1' } } } } },
            listGitReferences: { data: [{ id: 'ref-1', attributes: { name: 'main', kind: 'BRANCH' } }] }
        });
        const workflows = new MockWorkflowsProvider();
        const provider = new BuildRunsTreeDataProvider(client as any, workflows);
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
        client.listBuildRuns = async () => { throw new Error('kaput'); };
        const provider = new BuildRunsTreeDataProvider(client as any, new MockWorkflowsProvider());
        provider.refresh('wf-123');
        try {
            const items = await provider.getChildren();
            assert.strictEqual(items.length, 0);
            assert.ok(errStub.calls[0]?.includes('Failed to load build runs'));
        } finally {
            restoreAll([errStub.stub]);
        }
    });
});
