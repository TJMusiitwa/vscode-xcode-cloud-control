import * as assert from 'assert';
import { AppStoreConnectClient, AscApiError } from '../lib/appstoreconnect/client';

class MockSecrets {
    async get(_key: string): Promise<string | undefined> { return undefined; }
    async store(_key: string, _value: string): Promise<void> { /* no-op */ }
}

function newClient(): AppStoreConnectClient {
    return new AppStoreConnectClient(new MockSecrets() as any);
}

suite('AppStoreConnectClient - createBuildRun', () => {
    test('sets sourceBranchOrTag relationship when only a git ref is given', async () => {
        const client = newClient();
        let capturedBody: any = null;
        (client as any).post = async (path: string, body: any) => {
            capturedBody = body;
            assert.strictEqual(path, '/ciBuildRuns');
            return { data: { id: 'build-1' } };
        };

        await client.createBuildRun('workflow-1', 'gitref-1');

        assert.deepStrictEqual(capturedBody.data.relationships.sourceBranchOrTag, {
            data: { type: 'scmGitReferences', id: 'gitref-1' }
        });
        assert.strictEqual(capturedBody.data.relationships.pullRequest, undefined);
    });

    test('sets pullRequest relationship when a pull request is given', async () => {
        const client = newClient();
        let capturedBody: any = null;
        (client as any).post = async (_path: string, body: any) => {
            capturedBody = body;
            return { data: { id: 'build-2' } };
        };

        await client.createBuildRun('workflow-1', undefined, { pullRequestId: 'pr-1' });

        assert.deepStrictEqual(capturedBody.data.relationships.pullRequest, {
            data: { type: 'scmPullRequests', id: 'pr-1' }
        });
        assert.strictEqual(capturedBody.data.relationships.sourceBranchOrTag, undefined);
    });

    test('pull request takes precedence when both a git ref and a pull request are given', async () => {
        const client = newClient();
        let capturedBody: any = null;
        (client as any).post = async (_path: string, body: any) => {
            capturedBody = body;
            return { data: { id: 'build-3' } };
        };

        await client.createBuildRun('workflow-1', 'gitref-1', { pullRequestId: 'pr-1' });

        assert.strictEqual(capturedBody.data.relationships.pullRequest.data.id, 'pr-1');
        assert.strictEqual(capturedBody.data.relationships.sourceBranchOrTag, undefined);
    });

    test('omits both relationships when no target is given', async () => {
        const client = newClient();
        let capturedBody: any = null;
        (client as any).post = async (_path: string, body: any) => {
            capturedBody = body;
            return { data: { id: 'build-4' } };
        };

        await client.createBuildRun('workflow-1');

        assert.strictEqual(capturedBody.data.relationships.sourceBranchOrTag, undefined);
        assert.strictEqual(capturedBody.data.relationships.pullRequest, undefined);
    });
});

suite('AppStoreConnectClient - cancelBuildRun', () => {
    test('returns true and calls DELETE on the build run when it succeeds', async () => {
        const client = newClient();
        let capturedPath: string | null = null;
        (client as any).delete = async (path: string) => { capturedPath = path; };

        const result = await client.cancelBuildRun('build-1');

        assert.strictEqual(result, true);
        assert.strictEqual(capturedPath, '/ciBuildRuns/build-1');
    });

    for (const status of [403, 404, 405]) {
        test(`raises a "not supported" error for status ${status}`, async () => {
            const client = newClient();
            (client as any).delete = async () => {
                throw new AscApiError(status, '/ciBuildRuns/build-1', 'unsupported');
            };

            await assert.rejects(
                () => client.cancelBuildRun('build-1'),
                (err: any) => {
                    assert.match(err.message, /not supported by the App Store Connect API/);
                    assert.match(err.message, new RegExp(String(status)));
                    return true;
                }
            );
        });
    }

    test('rethrows the original error for unrelated failures (e.g. 500)', async () => {
        const client = newClient();
        (client as any).delete = async () => {
            throw new AscApiError(500, '/ciBuildRuns/build-1', 'Internal Server Error');
        };

        await assert.rejects(
            () => client.cancelBuildRun('build-1'),
            /Apple server error/
        );
    });
});

suite('AppStoreConnectClient - SCM providers and pull requests', () => {
    test('listScmProviders calls GET /scmProviders', async () => {
        const client = newClient();
        let capturedPath: string | null = null;
        (client as any).get = async (path: string) => {
            capturedPath = path;
            return { data: [{ id: 'provider-1', type: 'scmProviders' }] };
        };

        const result = await client.listScmProviders();

        assert.strictEqual(capturedPath, '/scmProviders');
        assert.strictEqual(result.data[0].id, 'provider-1');
    });

    test('listRepositoriesForProvider paginates GET /scmProviders/{id}/repositories', async () => {
        const client = newClient();
        let capturedPath: string | null = null;
        (client as any).get = async (path: string) => {
            capturedPath = path;
            return { data: [{ id: 'repo-1' }], meta: { paging: {} } };
        };

        const result = await client.listRepositoriesForProvider('provider-1');

        assert.strictEqual(capturedPath, '/scmProviders/provider-1/repositories');
        assert.strictEqual(result.data.length, 1);
        assert.strictEqual(result.data[0].id, 'repo-1');
    });

    test('listPullRequests paginates GET /scmRepositories/{id}/pullRequests', async () => {
        const client = newClient();
        let capturedPath: string | null = null;
        (client as any).get = async (path: string) => {
            capturedPath = path;
            return { data: [{ id: 'pr-1', attributes: { isClosed: false } }], meta: { paging: {} } };
        };

        const result = await client.listPullRequests('repo-1');

        assert.strictEqual(capturedPath, '/scmRepositories/repo-1/pullRequests');
        assert.strictEqual(result.data.length, 1);
        assert.strictEqual(result.data[0].id, 'pr-1');
    });

    test('getPullRequest calls GET /scmPullRequests/{id}', async () => {
        const client = newClient();
        let capturedPath: string | null = null;
        (client as any).get = async (path: string) => {
            capturedPath = path;
            return { data: { id: 'pr-1' } };
        };

        await client.getPullRequest('pr-1');

        assert.strictEqual(capturedPath, '/scmPullRequests/pr-1');
    });
});
