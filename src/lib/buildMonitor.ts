import * as vscode from 'vscode';
import { AppStoreConnectClient } from './appstoreconnect/client';

interface TrackedBuild {
    id: string;
    workflowName: string;
    status: string;
    state: string;
}

/**
 * Monitors active Xcode Cloud builds and sends notifications on completion/failure
 */
export class BuildMonitor {
    private trackedBuilds: Map<string, TrackedBuild> = new Map();
    private pollingInterval: NodeJS.Timeout | null = null;
    private readonly POLL_INTERVAL_MS = 30000; // 30 seconds

    constructor(
        private client: AppStoreConnectClient,
        private onBuildUpdate?: () => void
    ) { }

    /**
     * Start monitoring builds
     */
    start(): void {
        if (this.pollingInterval) { return; }

        this.pollingInterval = setInterval(() => {
            this.pollBuilds();
        }, this.POLL_INTERVAL_MS);

        // Initial poll
        this.pollBuilds();
    }

    /**
     * Stop monitoring builds
     */
    stop(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    /**
     * Track a newly triggered build for notifications
     */
    trackBuild(buildId: string, workflowName: string): void {
        this.trackedBuilds.set(buildId, {
            id: buildId,
            workflowName,
            status: 'PENDING',
            state: ''
        });
    }

    private async pollBuilds(): Promise<void> {
        if (this.trackedBuilds.size === 0) {
            // Also check for any in-progress builds we should pick up
            await this.discoverActiveBuilds();
        }

        for (const [buildId, tracked] of this.trackedBuilds) {
            try {
                const response = await this.client.get(`/ciBuildRuns/${buildId}`);
                const build = response?.data;

                if (!build) { continue; }

                const progress = build?.attributes?.executionProgress || '';
                const state = build?.attributes?.completionStatus || '';
                const workflowName = tracked.workflowName || `Build ${buildId}`;

                // Check if build has completed
                if (progress.toUpperCase() === 'COMPLETE' && tracked.status !== 'COMPLETE') {
                    this.notifyBuildComplete(buildId, workflowName, state);
                    this.trackedBuilds.delete(buildId);
                    this.onBuildUpdate?.();
                } else if (progress.toUpperCase() !== tracked.status) {
                    // Update status
                    tracked.status = progress.toUpperCase();
                    tracked.state = state;
                }
            } catch (err) {
                // Build may no longer exist or API error - remove from tracking
                console.error(`Failed to poll build ${buildId}:`, err);
            }
        }
    }

    private async discoverActiveBuilds(): Promise<void> {
        try {
            const response = await this.client.listAllRecentBuilds({ limit: 10 });
            const builds = response?.data || [];

            for (const build of builds) {
                const progress = build?.attributes?.executionProgress?.toUpperCase() || '';
                const id = build?.id;

                // Track builds that are in progress
                if (id && (progress === 'PENDING' || progress === 'RUNNING')) {
                    if (!this.trackedBuilds.has(id)) {
                        this.trackedBuilds.set(id, {
                            id,
                            workflowName: `Build ${id.slice(-6)}`,
                            status: progress,
                            state: ''
                        });
                    }
                }
            }
        } catch (err) {
            console.error('Failed to discover active builds:', err);
        }
    }

    private notifyBuildComplete(buildId: string, workflowName: string, state: string): void {
        const normalizedState = state.toUpperCase();

        if (normalizedState === 'SUCCEEDED' || normalizedState === 'SUCCESS') {
            vscode.window.showInformationMessage(
                `✅ Build completed: ${workflowName}`,
                'View Builds'
            ).then(choice => {
                if (choice === 'View Builds') {
                    vscode.commands.executeCommand('xcodecloudBuildRuns.focus');
                }
            });
        } else if (normalizedState === 'FAILED' || normalizedState === 'ERROR') {
            vscode.window.showErrorMessage(
                `❌ Build failed: ${workflowName}`,
                'View Builds'
            ).then(choice => {
                if (choice === 'View Builds') {
                    vscode.commands.executeCommand('xcodecloudBuildRuns.focus');
                }
            });
        } else if (normalizedState === 'CANCELED' || normalizedState === 'CANCELLED') {
            vscode.window.showWarningMessage(
                `⚠️ Build canceled: ${workflowName}`
            );
        } else {
            // Unknown completion state
            vscode.window.showInformationMessage(
                `Build finished (${state}): ${workflowName}`
            );
        }
    }

    dispose(): void {
        this.stop();
        this.trackedBuilds.clear();
    }
}
