import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkflowItem, WorkflowsTreeDataProvider } from '../lib/views/WorkflowsTree';
import { restoreAll, stubErrorMessage, stubQuickPick } from './helpers';

class MockClient {
    constructor(private data: any, private shouldThrow = false) { }
    async listWorkflows(): Promise<any> {
        if (this.shouldThrow) { throw new Error('boom'); }
        return this.data;
    }
}

suite('WorkflowsTreeDataProvider', () => {
    test('getChildren maps workflows to items', async () => {
        const client = new MockClient({
            data: [
                { id: 'wf1', attributes: { name: 'Build iOS', isEnabled: true } },
                { id: 'wf2', attributes: { name: 'Build macOS', isEnabled: false } },
            ]
        });
        const provider = new WorkflowsTreeDataProvider(client as any);
        const children = await provider.getChildren();

        assert.strictEqual(children.length, 2);
        const a = children[0] as WorkflowItem;
        const b = children[1] as WorkflowItem;

        assert.strictEqual(a.label, 'Build iOS');
        assert.strictEqual(a.description, 'Enabled');
        assert.strictEqual(a.contextValue, 'workflow');
        assert.ok(a.command);
        assert.ok(a.iconPath instanceof vscode.ThemeIcon);

        assert.strictEqual(b.label, 'Build macOS');
        assert.strictEqual(b.description, 'Disabled');
    });

    test('pickWorkflowId shows quick pick and returns id', async () => {
        const client = new MockClient({
            data: [
                { id: 'wf1', attributes: { name: 'Workflow 1', isEnabled: true } },
                { id: 'wf2', attributes: { name: 'Workflow 2', isEnabled: true } },
            ]
        });
        const provider = new WorkflowsTreeDataProvider(client as any);
        const stub = stubQuickPick({ label: 'Workflow 2', description: 'wf2', id: 'wf2' } as any);
        try {
            const picked = await provider.pickWorkflowId();
            assert.strictEqual(picked, 'wf2');
        } finally {
            stub.restore();
        }
    });

    test('getChildren handles API errors gracefully', async () => {
        const errStub = stubErrorMessage();
        const client = new MockClient({}, true);
        const provider = new WorkflowsTreeDataProvider(client as any);
        try {
            const items = await provider.getChildren();
            assert.strictEqual(items.length, 0);
            assert.ok(errStub.calls[0]?.includes('Failed to load workflows'));
        } finally {
            restoreAll([errStub.stub]);
        }
    });
});
