import { request } from 'undici';
import * as vscode from 'vscode';
import { JwtProvider } from './auth';

const BASE_URL = 'https://api.appstoreconnect.apple.com/v1';

export class AppStoreConnectClient {
    private jwt: JwtProvider;

    constructor(secretStorage: vscode.SecretStorage) {
        this.jwt = new JwtProvider(secretStorage);
    }

    async hasCredentials(): Promise<boolean> {
        try {
            await this.jwt.getToken();
            return true;
        } catch {
            return false;
        }
    }

    private async getHeaders() {
        const token = await this.jwt.getToken();
        return {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
        };
    }

    async get(path: string, query?: Record<string, string | number | boolean>): Promise<any> {
        const url = new URL(`${BASE_URL}${path}`);
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                url.searchParams.set(k, String(v));
            }
        }
        const headers = await this.getHeaders();
        const res = await request(url.toString(), { method: 'GET', headers });
        if (res.statusCode >= 400) {
            const body = await res.body.text();
            throw new Error(`GET ${url} failed (${res.statusCode}): ${body}`);
        }
        return await res.body.json();
    }

    async post(path: string, body: any): Promise<any> {
        const url = `${BASE_URL}${path}`;
        const headers = await this.getHeaders();
        const res = await request(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
        if (res.statusCode >= 400) {
            const text = await res.body.text();
            throw new Error(`POST ${url} failed (${res.statusCode}): ${text}`);
        }
        return await res.body.json();
    }

    // Xcode Cloud: list all products (apps with Xcode Cloud enabled)
    async listProducts(options?: { limit?: number }) {
        const query: Record<string, string> = {};
        if (options?.limit) {
            query['limit'] = String(options.limit);
        }
        return this.get('/ciProducts', query);
    }

    // Xcode Cloud: list workflows for a product (required - /ciWorkflows doesn't allow collection listing)
    async listWorkflowsByProduct(productId: string, options?: { limit?: number }) {
        const query: Record<string, string> = {};
        if (options?.limit) {
            query['limit'] = String(options.limit);
        }
        return this.get(`/ciProducts/${productId}/workflows`, query);
    }

    // Xcode Cloud: list all workflows across all products
    async listAllWorkflows(options?: { limit?: number }): Promise<any> {
        const limit = options?.limit || 50;
        const productsResponse = await this.listProducts({ limit: 50 });
        const products = productsResponse?.data || [];

        if (products.length === 0) {
            return { data: [] };
        }

        // Fetch workflows from all products in parallel
        const workflowPromises = products.map((product: any) =>
            this.listWorkflowsByProduct(product.id, { limit: Math.ceil(limit / products.length) + 5 })
                .then(response => {
                    // Attach product info to each workflow for context
                    const workflows = response?.data || [];
                    return workflows.map((wf: any) => ({
                        ...wf,
                        _productId: product.id,
                        _productName: product?.attributes?.name || 'Unknown',
                        // CiProduct relationship 'app' 'data' 'id' is the App Store ID (e.g. 1560000000)
                        _appId: product?.relationships?.app?.data?.id
                    }));
                })
                .catch(() => []) // Ignore errors for individual products
        );

        const results = await Promise.all(workflowPromises);
        const allWorkflows = results.flat().slice(0, limit);

        return { data: allWorkflows };
    }

    // Xcode Cloud: list build runs for a workflow (required - cannot list all builds directly)
    async listBuildRuns(options: { workflowId: string; limit?: number }) {
        const query: Record<string, string> = {};
        if (options.limit) {
            query['limit'] = String(options.limit);
        }
        // Apple's API requires fetching builds via the workflow relationship
        return this.get(`/ciWorkflows/${options.workflowId}/buildRuns`, query);
    }

    // Xcode Cloud: list build runs for a product (alternative to per-workflow)
    async listBuildRunsByProduct(options: { productId: string; limit?: number }) {
        const query: Record<string, string> = {};
        if (options.limit) {
            query['limit'] = String(options.limit);
        }
        return this.get(`/ciProducts/${options.productId}/buildRuns`, query);
    }

    // Xcode Cloud: list all recent builds across all products
    async listAllRecentBuilds(options?: { limit?: number }): Promise<any> {
        const limit = options?.limit || 10;
        const productsResponse = await this.listProducts({ limit: 50 });
        const products = productsResponse?.data || [];

        if (products.length === 0) {
            return { data: [] };
        }

        // Fetch builds from all products in parallel
        const buildPromises = products.map((product: any) =>
            this.listBuildRunsByProduct({ productId: product.id, limit: Math.ceil(limit / products.length) + 5 })
                .catch(() => ({ data: [] })) // Ignore errors for individual products
        );

        const results = await Promise.all(buildPromises);

        // Combine and sort by startedDate (most recent first)
        const allBuilds = results
            .flatMap(r => r?.data || [])
            .sort((a: any, b: any) => {
                const dateA = a?.attributes?.startedDate || a?.attributes?.createdDate || '';
                const dateB = b?.attributes?.startedDate || b?.attributes?.createdDate || '';
                return dateB.localeCompare(dateA);
            })
            .slice(0, limit);

        return { data: allBuilds };
    }

    // Xcode Cloud: list git references (branches/tags) for a repository
    // Note: /scmGitReferences doesn't allow collection listing - must fetch via repository
    async listGitReferences(scmRepoId: string, options?: { limit?: number }) {
        const query: Record<string, string> = {};
        if (options?.limit) {
            query['limit'] = String(options.limit);
        }
        return this.get(`/scmRepositories/${scmRepoId}/gitReferences`, query);
    }

    // Helper: fetch workflow details including linked repository
    async getWorkflow(id: string) {
        return this.get(`/ciWorkflows/${id}`, { 'include': 'repository' });
    }

    // Xcode Cloud: trigger a build run
    // Valid relationships: workflow (required), sourceBranchOrTag (optional), pullRequest (optional), buildRun (optional for re-runs)
    async createBuildRun(workflowId: string, gitRefId?: string, options?: { clean?: boolean }) {
        const payload: any = {
            data: {
                type: 'ciBuildRuns',
                attributes: {
                    clean: options?.clean ?? false
                },
                relationships: {
                    workflow: { data: { type: 'ciWorkflows', id: workflowId } }
                }
            }
        };
        // Use sourceBranchOrTag to specify a branch or tag reference (NOT sourceCommit)
        if (gitRefId) {
            payload.data.relationships['sourceBranchOrTag'] = { data: { type: 'scmGitReferences', id: gitRefId } };
        }
        const res = await this.post('/ciBuildRuns', payload);
        return res?.data;
    }

    // Xcode Cloud: cancel a build run
    // Note: Apple's API may not support DELETE for build runs. The proper way to cancel
    // a build may be different or not available via the API. This currently attempts DELETE.
    async cancelBuildRun(buildRunId: string) {
        const url = `${BASE_URL}/ciBuildRuns/${buildRunId}`;
        const headers = await this.getHeaders();
        const res = await request(url, { method: 'DELETE', headers });
        if (res.statusCode >= 400) {
            const text = await res.body.text();
            // If API doesn't support cancellation, provide helpful error
            if (res.statusCode === 403 || res.statusCode === 405) {
                throw new Error(`Build cancellation is not supported via the API. Status: ${res.statusCode}`);
            }
            throw new Error(`DELETE ${url} failed (${res.statusCode}): ${text}`);
        }
        return true;
    }

    // Xcode Cloud: get build actions (for logs)
    async getBuildActions(buildRunId: string) {
        return this.get(`/ciBuildRuns/${buildRunId}/actions`);
    }

    // Xcode Cloud: get build action artifacts (logs)
    async getBuildActionArtifacts(actionId: string) {
        return this.get(`/ciBuildActions/${actionId}/artifacts`);
    }

    // Xcode Cloud: get artifact download URL
    async getArtifact(artifactId: string) {
        return this.get(`/ciArtifacts/${artifactId}`);
    }

    async downloadArtifactContent(artifactId: string): Promise<{ content: string; fileName?: string; downloadUrl?: string; contentType?: string }> {
        const artifact = await this.getArtifact(artifactId);
        const attrs = artifact?.data?.attributes || {};
        const downloadUrl = attrs?.downloadUrl || attrs?.fileUrl || attrs?.url;

        if (!downloadUrl) {
            throw new Error('No download URL available for this artifact.');
        }

        const res = await request(downloadUrl, { method: 'GET' });
        if (res.statusCode >= 400) {
            const body = await res.body.text();
            throw new Error(`Download failed (${res.statusCode}): ${body}`);
        }

        const content = await res.body.text();
        const contentTypeHeader = res.headers['content-type'];
        const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;

        return { content, fileName: attrs?.fileName, downloadUrl, contentType };
    }

    // Get a single build run
    async getBuildRun(buildRunId: string) {
        return this.get(`/ciBuildRuns/${buildRunId}`);
    }

    // Xcode Cloud: get test results for a test action
    async getTestResults(actionId: string, options?: { limit?: number }) {
        const query: Record<string, string> = {};
        if (options?.limit) {
            query['limit'] = String(options.limit);
        }
        return this.get(`/ciBuildActions/${actionId}/testResults`, query);
    }

    // Xcode Cloud: get issues for a build action
    async getIssues(actionId: string, options?: { limit?: number }) {
        const query: Record<string, string> = {};
        if (options?.limit) {
            query['limit'] = String(options.limit);
        }
        return this.get(`/ciBuildActions/${actionId}/issues`, query);
    }

    // ==========================
    // Generic HTTP Methods
    // ==========================

    async patch(path: string, body: any): Promise<any> {
        const url = `${BASE_URL}${path}`;
        const headers = await this.getHeaders();
        const res = await request(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(body)
        });
        if (res.statusCode >= 400) {
            const text = await res.body.text();
            throw new Error(`PATCH ${url} failed (${res.statusCode}): ${text}`);
        }
        return await res.body.json();
    }

    async delete(path: string): Promise<void> {
        const url = `${BASE_URL}${path}`;
        const headers = await this.getHeaders();
        const res = await request(url, { method: 'DELETE', headers });
        if (res.statusCode >= 400) {
            const text = await res.body.text();
            throw new Error(`DELETE ${url} failed (${res.statusCode}): ${text}`);
        }
    }

    // ==========================
    // Workflow CRUD Operations
    // ==========================

    /**
     * Create a new Xcode Cloud workflow
     * Requires: product, repository, xcodeVersion, macOsVersion relationships
     */
    async createWorkflow(
        productId: string,
        repositoryId: string,
        xcodeVersionId: string,
        macOsVersionId: string,
        attributes: {
            name: string;
            description?: string;
            isEnabled?: boolean;
            isLockedForEditing?: boolean;
            clean?: boolean;
            containerFilePath?: string;
            branchStartCondition?: any;
            tagStartCondition?: any;
            pullRequestStartCondition?: any;
            scheduledStartCondition?: any;
            manualBranchStartCondition?: any;
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
                    isLockedForEditing: attributes.isLockedForEditing ?? false,
                    clean: attributes.clean ?? false,
                    containerFilePath: attributes.containerFilePath,
                    branchStartCondition: attributes.branchStartCondition,
                    tagStartCondition: attributes.tagStartCondition,
                    pullRequestStartCondition: attributes.pullRequestStartCondition,
                    scheduledStartCondition: attributes.scheduledStartCondition,
                    manualBranchStartCondition: attributes.manualBranchStartCondition,
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

    /**
     * Update an existing Xcode Cloud workflow
     */
    async updateWorkflow(
        workflowId: string,
        attributes: {
            name?: string;
            description?: string;
            isEnabled?: boolean;
            clean?: boolean;
            containerFilePath?: string;
            branchStartCondition?: any | null;
            tagStartCondition?: any | null;
            pullRequestStartCondition?: any | null;
            scheduledStartCondition?: any | null;
            manualBranchStartCondition?: any | null;
            actions?: any[];
        }
    ): Promise<any> {
        // Build attributes object with only defined values
        const attrs: Record<string, any> = {};
        if (attributes.name !== undefined) { attrs.name = attributes.name; }
        if (attributes.description !== undefined) { attrs.description = attributes.description; }
        if (attributes.isEnabled !== undefined) { attrs.isEnabled = attributes.isEnabled; }
        if (attributes.clean !== undefined) { attrs.clean = attributes.clean; }
        if (attributes.containerFilePath !== undefined) { attrs.containerFilePath = attributes.containerFilePath; }
        if (attributes.branchStartCondition !== undefined) { attrs.branchStartCondition = attributes.branchStartCondition; }
        if (attributes.tagStartCondition !== undefined) { attrs.tagStartCondition = attributes.tagStartCondition; }
        if (attributes.pullRequestStartCondition !== undefined) { attrs.pullRequestStartCondition = attributes.pullRequestStartCondition; }
        if (attributes.scheduledStartCondition !== undefined) { attrs.scheduledStartCondition = attributes.scheduledStartCondition; }
        if (attributes.manualBranchStartCondition !== undefined) { attrs.manualBranchStartCondition = attributes.manualBranchStartCondition; }
        if (attributes.actions !== undefined) { attrs.actions = attributes.actions; }

        const payload = {
            data: {
                type: 'ciWorkflows',
                id: workflowId,
                attributes: attrs
            }
        };
        return this.patch(`/ciWorkflows/${workflowId}`, payload);
    }

    /**
     * Delete an Xcode Cloud workflow and all associated data
     */
    async deleteWorkflow(workflowId: string): Promise<void> {
        return this.delete(`/ciWorkflows/${workflowId}`);
    }

    // ==========================
    // Helper Methods for Workflow Creation
    // ==========================

    /**
     * List available Xcode versions for workflows
     */
    async listXcodeVersions(options?: { limit?: number }) {
        const query: Record<string, string> = {};
        if (options?.limit) { query['limit'] = String(options.limit); }
        return this.get('/ciXcodeVersions', query);
    }

    /**
     * List available macOS versions for workflows
     */
    async listMacOsVersions(xcodeVersionId: string, options?: { limit?: number }) {
        const query: Record<string, string> = {};
        if (options?.limit) { query['limit'] = String(options.limit); }
        return this.get(`/ciXcodeVersions/${xcodeVersionId}/macOsVersions`, query);
    }

    /**
     * List repositories for a product
     */
    async listRepositories(productId: string, options?: { limit?: number }) {
        const query: Record<string, string> = {};
        if (options?.limit) { query['limit'] = String(options.limit); }
        return this.get(`/ciProducts/${productId}/primaryRepositories`, query);
    }
}
