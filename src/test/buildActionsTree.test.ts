import * as assert from 'assert';
import * as vscode from 'vscode';
import { BuildActionItem, BuildActionsTreeDataProvider } from '../lib/views/BuildLogsPanel';
import { restoreAll, stubErrorMessage } from './helpers';

class MockClient {
    constructor(private resp: Record<string, any> = {}) { }
    async getBuildActions(_: string): Promise<any> { return this.resp.getBuildActions; }
}

suite('BuildActionsTreeDataProvider', () => {
    test('shows placeholder when no build selected', async () => {
        const provider = new BuildActionsTreeDataProvider({} as any);
        const items = await provider.getChildren();
        assert.strictEqual(items.length, 1);
        const it = items[0] as BuildActionItem;
        assert.strictEqual(it.contextValue, 'placeholder');
        assert.ok(it.iconPath instanceof vscode.ThemeIcon);
    });

    test('lists actions when build selected', async () => {
        const client = new MockClient({
            getBuildActions: {
                data: [
                    { id: 'a1', attributes: { name: 'Build', actionType: 'BUILD', executionProgress: 'RUNNING', completionStatus: '' } },
                    { id: 'a2', attributes: { name: 'Test', actionType: 'TEST', executionProgress: 'COMPLETE', completionStatus: 'SUCCEEDED' } },
                ]
            }
        });
        const provider = new BuildActionsTreeDataProvider(client as any);
        provider.setBuildRun('run-1', '#12');
        const items = await provider.getChildren();
        assert.strictEqual(items.length, 2);
        assert.strictEqual(items[0].label, 'Build');
        assert.strictEqual(items[0].description, 'Running...');
        assert.strictEqual(items[1].label, 'Test');
        assert.strictEqual(items[1].description, 'Succeeded');
        items.forEach(i => assert.strictEqual(i.contextValue, 'buildAction'));
    });

    test('handles error and returns error placeholder', async () => {
        const errStub = stubErrorMessage();
        const client = new MockClient();
        client.getBuildActions = async () => { throw new Error('bad'); };
        const provider = new BuildActionsTreeDataProvider(client as any);
        provider.setBuildRun('run-2', '#13');
        try {
            const items = await provider.getChildren();
            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].contextValue, 'placeholder');
            assert.ok(errStub.calls[0]?.includes('Failed to load build actions'));
        } finally {
            restoreAll([errStub.stub]);
        }
    });
});
