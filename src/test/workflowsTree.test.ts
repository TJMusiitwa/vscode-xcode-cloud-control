import * as assert from 'assert';
import * as vscode from 'vscode';
import { UnifiedWorkflowTreeDataProvider, WorkflowNode } from '../lib/views/UnifiedWorkflowTree';
import { restoreAll, stubErrorMessage, stubQuickPick } from './helpers';

class MockClient {
    constructor(private data: any, private shouldThrow = false) { }
    async listAllWorkflows(): Promise<any> {
        if (this.shouldThrow) { throw new Error('boom'); }
        return this.data;
    }
}

suite('WorkflowNode Tests', () => {
    test('getChildren maps workflows to items', async () => {
        const client = new MockClient({
            data: [
                { id: 'wf1', attributes: { name: 'Build iOS', isEnabled: true }, _productName: 'MyApp' },
                { id: 'wf2', attributes: { name: 'Build macOS', isEnabled: false }, _productName: 'MyApp' },
            ]
        });
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const children = await provider.getChildren();

        assert.strictEqual(children.length, 2);
        const a = children[0] as WorkflowNode;
        const b = children[1] as WorkflowNode;

        assert.strictEqual(a.workflowName, 'Build iOS');
        assert.strictEqual(a.description, 'MyApp');
        assert.strictEqual(a.contextValue, 'workflow');
        assert.ok(a.iconPath instanceof vscode.ThemeIcon);

        assert.strictEqual(b.workflowName, 'Build macOS');
    });

    test('pickWorkflowId shows quick pick and returns id', async () => {
        const client = new MockClient({
            data: [
                { id: 'wf1', attributes: { name: 'Workflow 1', isEnabled: true } },
                { id: 'wf2', attributes: { name: 'Workflow 2', isEnabled: true } },
            ]
        });
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
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
