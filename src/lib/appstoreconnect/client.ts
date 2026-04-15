import { request } from 'undici';
import * as vscode from 'vscode';
import { BASE_URL } from '../constants';
import { logger } from '../logger';
import { JwtProvider } from './auth';

export class AscApiError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly endpoint: string,
        public readonly apiMessage: string
    ) {
        super(AscApiError.formatMessage(statusCode, apiMessage));
        this.name = 'AscApiError';
    }

    private static formatMessage(code: number, msg: string): string {
        if (code === 401) { return 'Authentication failed. Re-run "Configure App Store Connect Credentials".'; }
        if (code === 403) {
            // Apple returns 403 for several distinct reasons — surface the raw body so the
            // developer can diagnose: wrong key scope, revoked key, or malformed JWT.
            let detail = msg;
            try {
                const parsed = JSON.parse(msg);
                const errors = parsed?.errors;
                if (Array.isArray(errors) && errors.length > 0) {
                    detail = errors.map((e: any) => e?.detail || e?.title || JSON.stringify(e)).join('; ');
                }
            } catch { /* msg is not JSON, use raw */ }
            return `Forbidden (403): ${detail}\n\nPossible causes:\n• API key lacks "Xcode Cloud" permission in App Store Connect\n• API key has been revoked\n• Re-run "Configure App Store Connect Credentials" to check your key.`;
        }
        if (code === 404) { return 'Resource not found. It may have been deleted.'; }
        if (code === 429) { return 'API rate limited. Slow down requests.'; }
        if (code >= 500) { return 'Apple server error. Try again in a moment.'; }
        return `API error ${code}: ${msg}`;
    }
}

export class AppStoreConnectClient {
    private jwt: JwtProvider;
    private cache = new Map<string, { data: any; expiresAt: number }>();
    private requestQueue = Promise.resolve();

    constructor(secretStorage: vscode.SecretStorage) {
        this.jwt = new JwtProvider(secretStorage);
    }

    /**
     * Enqueue a function to execute serially.
     * Ensures only one HTTP request is in-flight at a time, preventing rate limiting.
     */
    private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.requestQueue = this.requestQueue
                .then(() => fn(), err => {
                    // If previous request failed, still proceed with next one
                    return fn();
                })
                .then(resolve, reject);
        });
    }

    private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
        const delays = [1000, 2000, 4000];
        let attempt = 0;
        while (true) {
            try {
                return await fn();
            } catch (error: any) {
                if (attempt >= delays.length) { throw error; }
                const isRetryable = error instanceof AscApiError ? error.statusCode >= 500 : true;
                if (!isRetryable) { throw error; }

                logger.warn(`API request failed, retrying in ${delays[attempt]}ms... (Attempt ${attempt + 1}/${delays.length})`);
                await new Promise(resolve => setTimeout(resolve, delays[attempt]));
                attempt++;
            }
        }
    }

    private getCache(key: string): any | null {
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        return null;
    }

    private setCache(key: string, data: any, ttlMs: number): void {
        this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    }

    private invalidateCache(): void {
        this.cache.clear();
    }

    /**
     * Fetch all items from a paginated API endpoint.
     * Automatically follows cursor pagination until all results are fetched.
     * @param path API path to fetch from
     * @param limit Maximum total items to fetch (null = fetch all)
     * @returns Array of all items across all pages
     */
    private async fetchAllPages(path: string, limit?: number): Promise<any[]> {
        const items: any[] = [];
        let nextCursor: string | null = null;
        let totalFetched = 0;

        while (true) {
            const query: Record<string, string | number> = { limit: 50 }; // Page size
            if (nextCursor) {
                query.next = nextCursor;
            }

            const response = await this.get(path, query as Record<string, string>);
            const pageItems = response?.data || [];
            items.push(...pageItems);
            totalFetched += pageItems.length;

            // Check if we've reached the limit or if there are no more pages
            if (limit && totalFetched >= limit) {
                return items.slice(0, limit);
            }

            // Get cursor for next page
            nextCursor = response?.meta?.paging?.next || null;
            if (!nextCursor || pageItems.length === 0) {
                break; // No more pages
            }
        }

        return items;
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
        return this.enqueue(async () =>
            this.withRetry(async () => {
                const url = new URL(`${BASE_URL}${path}`);
                if (query) {
                    for (const [k, v] of Object.entries(query)) {
                        url.searchParams.set(k, String(v));
                    }
                }
                const headers = await this.getHeaders();
                logger.request('GET', path);
                const t0 = Date.now();
                const res = await request(url.toString(), { method: 'GET', headers });
                logger.response('GET', path, res.statusCode, Date.now() - t0);
                if (res.statusCode >= 400) {
                    const body = await res.body.text();
                    throw new AscApiError(res.statusCode, path, body);
                }
                return await res.body.json();
            })
        );
    }

    async post(path: string, body: any): Promise<any> {
        this.invalidateCache();
        return this.enqueue(async () =>
            this.withRetry(async () => {
                const url = `${BASE_URL}${path}`;
                const headers = await this.getHeaders();
                logger.request('POST', path);
                const t0 = Date.now();
                const res = await request(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body)
                });
                logger.response('POST', path, res.statusCode, Date.now() - t0);
                if (res.statusCode >= 400) {
                    const text = await res.body.text();
                    throw new AscApiError(res.statusCode, path, text);
                }
                return await res.body.json();
            })
        );
    }

    // Xcode Cloud: list all products (apps with Xcode Cloud enabled)
    async listProducts(options?: { limit?: number }) {
        const cacheKey = `listProducts_${options?.limit || 'default'}`;
        const cached = this.getCache(cacheKey);
        if (cached) { return cached; }

        const query: Record<string, string> = {};
        if (options?.limit) {
            query['limit'] = String(options.limit);
        }
        const data = await this.get('/ciProducts', query);
        this.setCache(cacheKey, data, 60_000); // 60s TTL
        return data;
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

        // Fetch workflows from all products in parallel, with pagination support
        const workflowPromises = products.map((product: any) =>
            this.fetchAllPages(`/ciProducts/${product.id}/workflows`, Math.ceil(limit / products.length) + 5)
                .then(workflows => {
                    // Attach product info to each workflow for context
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
    // Supports pagination automatically for accounts with many builds
    async listBuildRuns(options: { workflowId: string; limit?: number }) {
        const limit = options.limit || 25;
        const items = await this.fetchAllPages(`/ciWorkflows/${options.workflowId}/buildRuns`, limit);
        return { data: items };
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

        // Fetch builds from all products in parallel with pagination support
        const buildPromises = products.map((product: any) =>
            this.fetchAllPages(`/ciProducts/${product.id}/buildRuns`, Math.ceil(limit / products.length) + 5)
                .catch(() => []) // Ignore errors for individual products
        );

        const results = await Promise.all(buildPromises);

        // Combine and sort by startedDate (most recent first)
        const allBuilds = results
            .flat()
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
        const cacheKey = `getWorkflow_${id}`;
        const cached = this.getCache(cacheKey);
        if (cached) { return cached; }

        const data = await this.get(`/ciWorkflows/${id}`, { 'include': 'repository' });
        this.setCache(cacheKey, data, 30_000); // 30s TTL
        return data;
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

    // Xcode Cloud: download artifact content (logs) from a download URL
    async downloadArtifactContent(downloadUrl: string): Promise<string> {
        const res = await request(downloadUrl, { method: 'GET' });
        if (res.statusCode >= 400) {
            const body = await res.body.text();
            throw new Error(`Failed to download artifact (${res.statusCode}): ${body}`);
        }
        return await res.body.text();
    }

    // Get a single build run
    async getBuildRun(buildRunId: string) {
        return this.get(`/ciBuildRuns/${buildRunId}`);
    }

    // Xcode Cloud: get test results for a test action
    // Automatically paginated for actions with many tests
    async getTestResults(actionId: string, options?: { limit?: number }) {
        const limit = options?.limit || 100;
        const items = await this.fetchAllPages(`/ciBuildActions/${actionId}/testResults`, limit);
        return { data: items };
    }

    // Xcode Cloud: get issues for a build action
    // Automatically paginated for actions with many issues
    async getIssues(actionId: string, options?: { limit?: number }) {
        const limit = options?.limit || 100;
        const items = await this.fetchAllPages(`/ciBuildActions/${actionId}/issues`, limit);
        return { data: items };
    }

    // ==========================
    // Generic HTTP Methods
    // ==========================

    async patch(path: string, body: any): Promise<any> {
        this.invalidateCache();
        return this.enqueue(async () =>
            this.withRetry(async () => {
                const url = `${BASE_URL}${path}`;
                const headers = await this.getHeaders();
                logger.request('PATCH', path);
                const t0 = Date.now();
                const res = await request(url, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify(body)
                });
                logger.response('PATCH', path, res.statusCode, Date.now() - t0);
                if (res.statusCode >= 400) {
                    const text = await res.body.text();
                    throw new AscApiError(res.statusCode, path, text);
                }
                return await res.body.json();
            })
        );
    }

    async delete(path: string): Promise<void> {
        this.invalidateCache();
        return this.enqueue(async () =>
            this.withRetry(async () => {
                const url = `${BASE_URL}${path}`;
                const headers = await this.getHeaders();
                logger.request('DELETE', path);
                const t0 = Date.now();
                const res = await request(url, { method: 'DELETE', headers });
                logger.response('DELETE', path, res.statusCode, Date.now() - t0);
                if (res.statusCode >= 400) {
                    const text = await res.body.text();
                    throw new AscApiError(res.statusCode, path, text);
                }
            })
        );
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
        const cacheKey = `listXcodeVersions_${options?.limit || 'default'}`;
        const cached = this.getCache(cacheKey);
        if (cached) { return cached; }

        const query: Record<string, string> = {};
        if (options?.limit) { query['limit'] = String(options.limit); }
        const data = await this.get('/ciXcodeVersions', query);
        this.setCache(cacheKey, data, 300_000); // 5 min TTL
        return data;
    }

    /**
     * List available macOS versions for workflows
     */
    async listMacOsVersions(xcodeVersionId: string, options?: { limit?: number }) {
        const cacheKey = `listMacOsVersions_${xcodeVersionId}_${options?.limit || 'default'}`;
        const cached = this.getCache(cacheKey);
        if (cached) { return cached; }

        const query: Record<string, string> = {};
        if (options?.limit) { query['limit'] = String(options.limit); }
        const data = await this.get(`/ciXcodeVersions/${xcodeVersionId}/macOsVersions`, query);
        this.setCache(cacheKey, data, 300_000); // 5 min TTL
        return data;
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