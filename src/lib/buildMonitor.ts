import * as vscode from 'vscode';
import { AppStoreConnectClient } from './appstoreconnect/client';
import { BuildLogStream } from './buildLogStream';
import { POLL_INTERVAL_MS_ACTIVE, POLL_INTERVAL_MS_IDLE } from './constants';
import { logger } from './logger';

interface TrackedBuild {
    id: string;
    workflowName: string;
    runNumber?: number;
    status: string;
    state: string;
    knownActions: Map<string, { name: string; status: string; type: string }>;
}

/**
 * Monitors active Xcode Cloud builds and sends notifications on completion/failure
 */
export class BuildMonitor {
    private trackedBuilds: Map<string, TrackedBuild> = new Map();
    private pollingInterval: NodeJS.Timeout | null = null;
    private buildLogStream = new BuildLogStream();
    private currentPollInterval = POLL_INTERVAL_MS_IDLE;

    constructor(
        private client: AppStoreConnectClient,
        private onBuildUpdate?: () => void
    ) { }

    private getConfiguredPollInterval(): number {
        const config = vscode.workspace.getConfiguration('xcodecloud');
        const seconds = config.get<number>('pollIntervalSeconds') || 30;
        return seconds * 1000;
    }

    private getAdaptiveInterval(): number {
        if (this.trackedBuilds.size > 0) {
            return POLL_INTERVAL_MS_ACTIVE;
        }
        return this.getConfiguredPollInterval();
    }

    private updatePollingInterval(): void {
        const desiredInterval = this.getAdaptiveInterval();
        if (this.currentPollInterval !== desiredInterval || !this.pollingInterval) {
            this.currentPollInterval = desiredInterval;
            this.stop();
            this.pollingInterval = setInterval(() => {
                this.pollBuilds();
            }, this.currentPollInterval);
        }
    }

    /**
     * Start monitoring builds
     */
    start(): void {
        this.updatePollingInterval();
        this.pollBuilds();
    }

    /**
     * Restart monitoring — re-reads configuration and resets the polling interval.
     * Call this when the user changes extension settings at runtime.
     */
    restart(): void {
        logger.log('BuildMonitor: restarting with updated configuration');
        this.stop();
        this.start();
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
    trackBuild(buildId: string, workflowName: string, runNumber?: number): void {
        this.trackedBuilds.set(buildId, {
            id: buildId,
            workflowName,
            runNumber,
            status: 'PENDING',
            state: '',
            knownActions: new Map()
        });

        if (runNumber) {
            const config = vscode.workspace.getConfiguration('xcodecloud');
            if (config.get<boolean>('autoShowBuildLogs', true)) {
                this.buildLogStream.openForBuild(buildId, runNumber, workflowName).show(true);
            } else {
                this.buildLogStream.openForBuild(buildId, runNumber, workflowName);
            }
        }

        this.updatePollingInterval();
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

                // Poll actions for log streaming
                await this.pollActionsForLogs(buildId, tracked);

                // Check if build has completed
                if (progress.toUpperCase() === 'COMPLETE' && tracked.status !== 'COMPLETE') {
                    this.notifyBuildComplete(buildId, workflowName, state);
                    this.buildLogStream.closeBuild(buildId);
                    this.trackedBuilds.delete(buildId);
                    this.onBuildUpdate?.();
                } else if (progress.toUpperCase() !== tracked.status) {
                    // Update status
                    tracked.status = progress.toUpperCase();
                    tracked.state = state;
                }
            } catch (err) {
                // Build may no longer exist or API error - remove from tracking
                logger.error(`Failed to poll build ${buildId}: ${err}`);
            }
        }

        // Polling loop might change active vs idle status
        this.updatePollingInterval();
    }

    private async pollActionsForLogs(buildId: string, tracked: TrackedBuild): Promise<void> {
        try {
            const actionsResp = await this.client.getBuildActions(buildId);
            const actions = actionsResp?.data || [];

            for (const action of actions) {
                const attrs = action?.attributes || {};
                const actionId = action.id;
                const name = attrs.name || 'Unknown Action';
                const type = attrs.actionType || 'UNKNOWN';
                const status = attrs.executionProgress?.toUpperCase() || 'UNKNOWN';
                const completionStatus = attrs.completionStatus?.toUpperCase() || '';

                const known = tracked.knownActions.get(actionId);

                if (!known) {
                    // newly discovered action
                    tracked.knownActions.set(actionId, { name, status, type });
                    if (status === 'RUNNING') {
                        this.buildLogStream.appendActionStart(buildId, name, type);
                    } else if (status === 'COMPLETE') {
                        this.buildLogStream.appendActionComplete(buildId, name, completionStatus);
                        await this.fetchAndAppendActionLogs(buildId, actionId);
                    }
                } else {
                    // updated action status
                    if (known.status !== status) {
                        known.status = status;
                        if (status === 'RUNNING') {
                            this.buildLogStream.appendActionStart(buildId, name, type);
                        } else if (status === 'COMPLETE') {
                            this.buildLogStream.appendActionComplete(buildId, name, completionStatus);
                            await this.fetchAndAppendActionLogs(buildId, actionId);
                        }
                    }
                }
            }
        } catch (err) {
            logger.warn(`Failed to poll actions for build ${buildId}: ${err}`);
        }
    }

    private async fetchAndAppendActionLogs(buildId: string, actionId: string): Promise<void> {
        try {
            const artifactsResp = await this.client.getBuildActionArtifacts(actionId);
            const artifacts = artifactsResp?.data || [];

            // Find log artifacts
            const logArtifacts = artifacts.filter((a: any) => {
                const fileType = a?.attributes?.fileType || '';
                const name = a?.attributes?.fileName || '';
                return fileType.toLowerCase() === 'log' || name.toLowerCase().includes('log');
            });

            for (const artifact of logArtifacts) {
                try {
                    const artifactDetails = await this.client.getArtifact(artifact.id);
                    const downloadUrl = artifactDetails?.data?.attributes?.downloadUrl || artifactDetails?.data?.attributes?.fileUrl;
                    if (downloadUrl) {
                        const downloaded = await this.client.downloadArtifactContent(downloadUrl);
                        if (downloaded) {
                            this.buildLogStream.appendActionLogs(buildId, downloaded);
                        }
                    }
                } catch (e) {
                    logger.warn(`Failed to download log artifact ${artifact.id} for action ${actionId}`);
                }
            }
        } catch (err) {
            logger.warn(`Failed to fetch action artifacts for action ${actionId}: ${err}`);
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
                        const runNumber = build?.attributes?.number;
                        const workflowName = `Build #${runNumber || id.slice(-6)}`;
                        this.trackedBuilds.set(id, {
                            id,
                            workflowName,
                            runNumber,
                            status: progress,
                            state: '',
                            knownActions: new Map()
                        });

                        if (runNumber) {
                            const config = vscode.workspace.getConfiguration('xcodecloud');
                            if (config.get<boolean>('autoShowBuildLogs', true)) {
                                this.buildLogStream.openForBuild(id, runNumber, workflowName).show(true);
                            } else {
                                this.buildLogStream.openForBuild(id, runNumber, workflowName);
                            }
                        }
                    }
                }
            }
        } catch (err) {
            logger.error(`Failed to discover active builds: ${err}`);
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
        this.buildLogStream.dispose();
    }
}
