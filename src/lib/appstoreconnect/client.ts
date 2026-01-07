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

    // Xcode Cloud: list workflows
    async listWorkflows(options?: { projectId?: string }) {
        // Optionally filter by project: filter[project] or filter[product]
        const query: Record<string, string> = {};
        if (options?.projectId) {
            query['filter[project]'] = options.projectId;
        }
        return this.get('/ciWorkflows', query);
    }

    // Xcode Cloud: list build runs (optionally per workflow)
    async listBuildRuns(options?: { workflowId?: string; limit?: number }) {
        const query: Record<string, string> = {};
        if (options?.workflowId) {
            query['filter[workflow]'] = options.workflowId;
        }
        if (options?.limit) {
            query['limit'] = String(options.limit);
        }
        return this.get('/ciBuildRuns', query);
    }

    // Xcode Cloud: list git references (branches/tags) for a repository
    async listGitReferences(scmRepoId: string) {
        return this.get('/scmGitReferences', { 'filter[repository]': scmRepoId });
    }

    // Helper: fetch workflow details including linked repository
    async getWorkflow(id: string) {
        return this.get(`/ciWorkflows/${id}`, { 'include': 'repository' });
    }

    // Xcode Cloud: trigger a build run
    async createBuildRun(workflowId: string, gitRefId?: string) {
        const payload: any = {
            data: {
                type: 'ciBuildRuns',
                relationships: {
                    workflow: { data: { type: 'ciWorkflows', id: workflowId } }
                }
            }
        };
        // Depending on configuration, you may need to specify sourceCommit or branch/tag reference
        if (gitRefId) {
            payload.data.relationships['sourceCommit'] = { data: { type: 'scmGitReferences', id: gitRefId } };
        }
        // Some setups may require 'sourceBranchOrTag' or use 'scmPullRequest'. Adjust per Apple docs.
        const res = await this.post('/ciBuildRuns', payload);
        return res?.data;
    }

    // Xcode Cloud: cancel a build run
    async cancelBuildRun(buildRunId: string) {
        const url = `${BASE_URL}/ciBuildRuns/${buildRunId}`;
        const headers = await this.getHeaders();
        const res = await request(url, { method: 'DELETE', headers });
        if (res.statusCode >= 400) {
            const text = await res.body.text();
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

    // Get a single build run
    async getBuildRun(buildRunId: string) {
        return this.get(`/ciBuildRuns/${buildRunId}`);
    }
}