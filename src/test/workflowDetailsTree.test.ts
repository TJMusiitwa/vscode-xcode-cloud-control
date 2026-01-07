import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkflowDetailItem, WorkflowDetailsTreeDataProvider } from '../lib/views/WorkflowDetailsTree';

class MockClient {
    constructor(private resp: any = {}) { }
    async getWorkflow(_: string): Promise<any> { return this.resp.getWorkflow; }
}

suite('WorkflowDetailsTreeDataProvider', () => {
    test('shows placeholder when no workflow selected', async () => {
        const provider = new WorkflowDetailsTreeDataProvider({} as any);
        const children = await provider.getChildren();
        assert.strictEqual(children.length, 1);
        const it = children[0] as WorkflowDetailItem;
        assert.strictEqual(it.contextValue, 'placeholder');
    });

    test('renders details and actions section', async () => {
        const client = new MockClient({
            getWorkflow: {
                data: {
                    attributes: {
                        isEnabled: true,
                        description: 'Sample workflow',
                        branchStartCondition: { patterns: ['main'] },
                        tagStartCondition: { patterns: ['v*'] },
                        pullRequestStartCondition: { enabled: true },
                        scheduledStartCondition: { frequency: 'DAILY', hour: 2, minute: 30 },
                        manualBranchStartCondition: { enabled: true },
                        clean: true,
                        containerFilePath: 'ci.yml',
                        lastModifiedDate: new Date().toISOString(),
                        actions: [{ name: 'Build', actionType: 'BUILD' }, { name: 'Test', actionType: 'TEST' }],
                    }
                }
            }
        });
        const provider = new WorkflowDetailsTreeDataProvider(client as any);
        provider.setWorkflow('wf-1', 'Workflow One');
        const root = await provider.getChildren();
        // Expect header, status, description, actions section at least
        const labels = root.map(i => i.label?.toString());
        assert.ok(labels.includes('Workflow One'));
        assert.ok(labels.includes('Status'));
        const actionsSection = root.find(i => (i as any).section === 'actions');
        assert.ok(actionsSection);
        assert.strictEqual((actionsSection as any).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

        const actions = await provider.getChildren(actionsSection as WorkflowDetailItem);
        assert.strictEqual(actions.length, 2);
        assert.strictEqual(actions[0].label, 'Build');
        assert.strictEqual(actions[1].label, 'Test');
        actions.forEach(a => assert.ok(a.iconPath instanceof vscode.ThemeIcon));
    });
});
