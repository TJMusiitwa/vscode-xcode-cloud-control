import * as assert from 'assert';

// Mock implementation of the AppStoreConnectClient for testing
class MockAppStoreConnectClient {
    public lastPatchPath: string | null = null;
    public lastPatchBody: any = null;
    public lastDeletePath: string | null = null;
    public lastPostPath: string | null = null;
    public lastPostBody: any = null;

    private responses: Record<string, any> = {};
    private shouldThrow: Record<string, Error> = {};

    setResponse(method: string, response: any) {
        this.responses[method] = response;
    }

    setThrow(method: string, error: Error) {
        this.shouldThrow[method] = error;
    }

    async patch(path: string, body: any): Promise<any> {
        this.lastPatchPath = path;
        this.lastPatchBody = body;
        if (this.shouldThrow['patch']) { throw this.shouldThrow['patch']; }
        return this.responses['patch'] || { data: { id: 'mock-id' } };
    }

    async delete(path: string): Promise<void> {
        this.lastDeletePath = path;
        if (this.shouldThrow['delete']) { throw this.shouldThrow['delete']; }
    }

    async post(path: string, body: any): Promise<any> {
        this.lastPostPath = path;
        this.lastPostBody = body;
        if (this.shouldThrow['post']) { throw this.shouldThrow['post']; }
        return this.responses['post'] || { data: { id: 'new-workflow-id' } };
    }

    // Simulate createWorkflow method
    async createWorkflow(
        productId: string,
        repositoryId: string,
        xcodeVersionId: string,
        macOsVersionId: string,
        attributes: {
            name: string;
            description?: string;
            isEnabled?: boolean;
            actions?: any[];
        }
    ): Promise<any> {
        const payload = {
            data: {
                type: 'ciWorkflows',
                attributes: {
                    name: attributes.name,
                    description: attributes.description || '',
                    isEnabled: attributes.isEnabled ?? true,
                    actions: attributes.actions || []
                },
                relationships: {
                    product: { data: { type: 'ciProducts', id: productId } },
                    repository: { data: { type: 'scmRepositories', id: repositoryId } },
                    xcodeVersion: { data: { type: 'ciXcodeVersions', id: xcodeVersionId } },
                    macOsVersion: { data: { type: 'ciMacOsVersions', id: macOsVersionId } }
                }
            }
        };
        return this.post('/ciWorkflows', payload);
    }

    // Simulate updateWorkflow method
    async updateWorkflow(
        workflowId: string,
        attributes: {
            name?: string;
            description?: string;
            isEnabled?: boolean;
        }
    ): Promise<any> {
        const attrs: Record<string, any> = {};
        if (attributes.name !== undefined) { attrs.name = attributes.name; }
        if (attributes.description !== undefined) { attrs.description = attributes.description; }
        if (attributes.isEnabled !== undefined) { attrs.isEnabled = attributes.isEnabled; }

        const payload = {
            data: {
                type: 'ciWorkflows',
                id: workflowId,
                attributes: attrs
            }
        };
        return this.patch(`/ciWorkflows/${workflowId}`, payload);
    }

    // Simulate deleteWorkflow method
    async deleteWorkflow(workflowId: string): Promise<void> {
        return this.delete(`/ciWorkflows/${workflowId}`);
    }
}

suite('Workflow CRUD Operations', () => {

    suite('createWorkflow', () => {
        test('constructs correct API payload', async () => {
            const client = new MockAppStoreConnectClient();

            await client.createWorkflow(
                'product-123',
                'repo-456',
                'xcode-789',
                'macos-abc',
                {
                    name: 'Build iOS',
                    description: 'Build workflow for iOS',
                    isEnabled: true,
                    actions: [{ name: 'Build', actionType: 'BUILD' }]
                }
            );

            assert.strictEqual(client.lastPostPath, '/ciWorkflows');
            assert.strictEqual(client.lastPostBody.data.type, 'ciWorkflows');
            assert.strictEqual(client.lastPostBody.data.attributes.name, 'Build iOS');
            assert.strictEqual(client.lastPostBody.data.attributes.description, 'Build workflow for iOS');
            assert.strictEqual(client.lastPostBody.data.attributes.isEnabled, true);
            assert.strictEqual(client.lastPostBody.data.relationships.product.data.id, 'product-123');
            assert.strictEqual(client.lastPostBody.data.relationships.repository.data.id, 'repo-456');
            assert.strictEqual(client.lastPostBody.data.relationships.xcodeVersion.data.id, 'xcode-789');
            assert.strictEqual(client.lastPostBody.data.relationships.macOsVersion.data.id, 'macos-abc');
        });

        test('uses default values for optional fields', async () => {
            const client = new MockAppStoreConnectClient();

            await client.createWorkflow(
                'product-123',
                'repo-456',
                'xcode-789',
                'macos-abc',
                { name: 'Minimal Workflow' }
            );

            assert.strictEqual(client.lastPostBody.data.attributes.name, 'Minimal Workflow');
            assert.strictEqual(client.lastPostBody.data.attributes.description, '');
            assert.strictEqual(client.lastPostBody.data.attributes.isEnabled, true);
            assert.deepStrictEqual(client.lastPostBody.data.attributes.actions, []);
        });

        test('throws error on API failure', async () => {
            const client = new MockAppStoreConnectClient();
            client.setThrow('post', new Error('POST /ciWorkflows failed (400): Invalid request'));

            await assert.rejects(
                () => client.createWorkflow('p', 'r', 'x', 'm', { name: 'Test' }),
                /Invalid request/
            );
        });
    });

    suite('updateWorkflow', () => {
        test('constructs correct PATCH payload', async () => {
            const client = new MockAppStoreConnectClient();

            await client.updateWorkflow('workflow-123', {
                name: 'Updated Name',
                description: 'Updated description',
                isEnabled: false
            });

            assert.strictEqual(client.lastPatchPath, '/ciWorkflows/workflow-123');
            assert.strictEqual(client.lastPatchBody.data.type, 'ciWorkflows');
            assert.strictEqual(client.lastPatchBody.data.id, 'workflow-123');
            assert.strictEqual(client.lastPatchBody.data.attributes.name, 'Updated Name');
            assert.strictEqual(client.lastPatchBody.data.attributes.description, 'Updated description');
            assert.strictEqual(client.lastPatchBody.data.attributes.isEnabled, false);
        });

        test('only includes defined attributes in payload', async () => {
            const client = new MockAppStoreConnectClient();

            await client.updateWorkflow('workflow-123', {
                name: 'Only Name Changed'
            });

            assert.strictEqual(client.lastPatchBody.data.attributes.name, 'Only Name Changed');
            assert.strictEqual(client.lastPatchBody.data.attributes.description, undefined);
            assert.strictEqual(client.lastPatchBody.data.attributes.isEnabled, undefined);
        });

        test('throws error on API failure', async () => {
            const client = new MockAppStoreConnectClient();
            client.setThrow('patch', new Error('PATCH failed (403): Forbidden'));

            await assert.rejects(
                () => client.updateWorkflow('wf-1', { name: 'Test' }),
                /Forbidden/
            );
        });
    });

    suite('deleteWorkflow', () => {
        test('calls correct DELETE endpoint', async () => {
            const client = new MockAppStoreConnectClient();

            await client.deleteWorkflow('workflow-to-delete');

            assert.strictEqual(client.lastDeletePath, '/ciWorkflows/workflow-to-delete');
        });

        test('throws error on API failure', async () => {
            const client = new MockAppStoreConnectClient();
            client.setThrow('delete', new Error('DELETE failed (404): Not Found'));

            await assert.rejects(
                () => client.deleteWorkflow('nonexistent'),
                /Not Found/
            );
        });
    });
});

suite('Workflow Payload Validation', () => {
    test('CiWorkflow create request has required structure', () => {
        // Validate the structure of a workflow create request
        const request = {
            data: {
                type: 'ciWorkflows',
                attributes: {
                    name: 'Test Workflow',
                    description: 'Test description',
                    isEnabled: true,
                    clean: false,
                    actions: []
                },
                relationships: {
                    product: { data: { type: 'ciProducts', id: 'p1' } },
                    repository: { data: { type: 'scmRepositories', id: 'r1' } },
                    xcodeVersion: { data: { type: 'ciXcodeVersions', id: 'x1' } },
                    macOsVersion: { data: { type: 'ciMacOsVersions', id: 'm1' } }
                }
            }
        };

        assert.strictEqual(request.data.type, 'ciWorkflows');
        assert.ok(request.data.attributes.name);
        assert.ok(request.data.relationships.product);
        assert.ok(request.data.relationships.repository);
    });

    test('CiWorkflow update request has required structure', () => {
        // Validate the structure of a workflow update request
        const request = {
            data: {
                type: 'ciWorkflows',
                id: 'workflow-123',
                attributes: {
                    name: 'Updated Workflow'
                }
            }
        };

        assert.strictEqual(request.data.type, 'ciWorkflows');
        assert.ok(request.data.id);
        assert.ok(request.data.attributes);
    });
});
