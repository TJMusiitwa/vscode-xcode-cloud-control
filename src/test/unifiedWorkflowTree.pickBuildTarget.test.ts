import * as assert from 'assert';
import * as vscode from 'vscode';
import { UnifiedWorkflowTreeDataProvider } from '../lib/views/UnifiedWorkflowTree';

class MockClient {
    constructor(
        private repoId: string | undefined,
        private gitRefs: any[] = [],
        private pullRequests: any[] = []
    ) { }

    async getWorkflow(_id: string): Promise<any> {
        return { data: { relationships: { repository: this.repoId ? { data: { id: this.repoId } } : undefined } } };
    }

    async listGitReferences(_repoId: string): Promise<any> {
        return { data: this.gitRefs };
    }

    async listPullRequests(_repoId: string): Promise<any> {
        return { data: this.pullRequests };
    }
}

function stubQuickPickCapture(pickIndex: number | null) {
    const original = vscode.window.showQuickPick;
    let capturedItems: any[] = [];
    (vscode.window as any).showQuickPick = async (items: any[]) => {
        capturedItems = items;
        return pickIndex === null ? undefined : items[pickIndex];
    };
    return {
        getItems: () => capturedItems,
        restore: () => { vscode.window.showQuickPick = original; }
    };
}

suite('UnifiedWorkflowTreeDataProvider - pickBuildTarget', () => {
    test('returns undefined when workflow has no linked repository', async () => {
        const provider = new UnifiedWorkflowTreeDataProvider(new MockClient(undefined) as any);
        const stub = stubQuickPickCapture(null);
        try {
            const result = await provider.pickBuildTarget('wf-1');
            assert.strictEqual(result, undefined);
        } finally {
            stub.restore();
        }
    });

    test('lists branches/tags and open pull requests, filtering out closed ones', async () => {
        const client = new MockClient(
            'repo-1',
            [{ id: 'ref-1', attributes: { name: 'main', kind: 'BRANCH' } }],
            [
                { id: 'pr-1', attributes: { number: 42, title: 'Fix bug', isClosed: false, sourceBranchName: 'fix', destinationBranchName: 'main' } },
                { id: 'pr-2', attributes: { number: 7, title: 'Old PR', isClosed: true, sourceBranchName: 'old', destinationBranchName: 'main' } }
            ]
        );
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const stub = stubQuickPickCapture(null);
        try {
            await provider.pickBuildTarget('wf-1');
            const items = stub.getItems();

            const refItem = items.find((i: any) => i.gitRefId === 'ref-1');
            assert.ok(refItem, 'branch item should be present');

            const prItem = items.find((i: any) => i.pullRequestId === 'pr-1');
            assert.ok(prItem, 'open pull request item should be present');
            assert.ok(prItem.label.includes('#42'));

            const closedPrItem = items.find((i: any) => i.pullRequestId === 'pr-2');
            assert.strictEqual(closedPrItem, undefined, 'closed pull request should be filtered out');

            const separator = items.find((i: any) => i.kind === vscode.QuickPickItemKind.Separator);
            assert.ok(separator, 'a separator should divide branches/tags from pull requests');
        } finally {
            stub.restore();
        }
    });

    test('omits the pull request separator when there are no open pull requests', async () => {
        const client = new MockClient('repo-1', [{ id: 'ref-1', attributes: { name: 'main', kind: 'BRANCH' } }], []);
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const stub = stubQuickPickCapture(null);
        try {
            await provider.pickBuildTarget('wf-1');
            const items = stub.getItems();
            const separator = items.find((i: any) => i.kind === vscode.QuickPickItemKind.Separator);
            assert.strictEqual(separator, undefined);
        } finally {
            stub.restore();
        }
    });

    test('resolves the selected pull request as pullRequestId', async () => {
        const client = new MockClient(
            'repo-1',
            [],
            [{ id: 'pr-1', attributes: { number: 1, title: 'Add feature', isClosed: false, sourceBranchName: 'feat', destinationBranchName: 'main' } }]
        );
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        // Pick index 1: index 0 is the separator, index 1 is the PR item
        const stub = stubQuickPickCapture(1);
        try {
            const result = await provider.pickBuildTarget('wf-1');
            assert.deepStrictEqual(result, { gitRefId: undefined, pullRequestId: 'pr-1' });
        } finally {
            stub.restore();
        }
    });

    test('degrades gracefully when listPullRequests rejects', async () => {
        const client = new MockClient('repo-1', [{ id: 'ref-1', attributes: { name: 'main', kind: 'BRANCH' } }]);
        (client as any).listPullRequests = async () => { throw new Error('boom'); };
        const provider = new UnifiedWorkflowTreeDataProvider(client as any);
        const stub = stubQuickPickCapture(0);
        try {
            const result = await provider.pickBuildTarget('wf-1');
            assert.deepStrictEqual(result, { gitRefId: 'ref-1', pullRequestId: undefined });
        } finally {
            stub.restore();
        }
    });
});
