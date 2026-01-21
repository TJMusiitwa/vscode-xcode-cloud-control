import * as vscode from 'vscode';
import { AppStoreConnectClient } from './lib/appstoreconnect/client';
import { BuildMonitor } from './lib/buildMonitor';
import { ensureCredentials } from './lib/credentials';
import { BuildActionsTreeDataProvider } from './lib/views/BuildLogsPanel';
import { BuildRunItem, BuildRunsTreeDataProvider } from './lib/views/BuildRunsTree';
import { WorkflowDetailsTreeDataProvider } from './lib/views/WorkflowDetailsTree';
import { WorkflowItem, WorkflowsTreeDataProvider } from './lib/views/WorkflowsTree';

let client: AppStoreConnectClient | null = null;
let workflowsProvider: WorkflowsTreeDataProvider | null = null;
let buildRunsProvider: BuildRunsTreeDataProvider | null = null;
let buildActionsProvider: BuildActionsTreeDataProvider | null = null;
let workflowDetailsProvider: WorkflowDetailsTreeDataProvider | null = null;
let buildMonitor: BuildMonitor | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;

export async function activate(context: vscode.ExtensionContext) {
	client = new AppStoreConnectClient(context.secrets);

	workflowsProvider = new WorkflowsTreeDataProvider(client);
	buildRunsProvider = new BuildRunsTreeDataProvider(client, workflowsProvider);
	buildActionsProvider = new BuildActionsTreeDataProvider(client);
	workflowDetailsProvider = new WorkflowDetailsTreeDataProvider(client);

	// Initialize build monitor for notifications
	buildMonitor = new BuildMonitor(client, () => {
		buildRunsProvider?.refresh();
		updateStatusBar();
	});

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = 'xcodecloudBuildRuns.focus';
	statusBarItem.tooltip = 'Xcode Cloud Build Status';
	updateStatusBar();

	context.subscriptions.push(
		statusBarItem,
		vscode.window.registerTreeDataProvider('xcodecloudWorkflows', workflowsProvider),
		vscode.window.registerTreeDataProvider('xcodecloudBuildRuns', buildRunsProvider),
		vscode.window.registerTreeDataProvider('xcodecloudBuildActions', buildActionsProvider),
		vscode.window.registerTreeDataProvider('xcodecloudWorkflowDetails', workflowDetailsProvider),

		// Configure credentials
		vscode.commands.registerCommand('xcodecloud.configureCredentials', async () => {
			await ensureCredentials(context.secrets);
			vscode.window.showInformationMessage('App Store Connect credentials saved.');
			workflowsProvider?.refresh();
			buildRunsProvider?.refresh();
			buildMonitor?.start();
			updateStatusBar();
		}),

		// Refresh commands
		vscode.commands.registerCommand('xcodecloud.refreshWorkflows', () => workflowsProvider?.refresh()),
		vscode.commands.registerCommand('xcodecloud.refreshBuildRuns', () => {
			buildRunsProvider?.refresh();
			updateStatusBar();
		}),
		vscode.commands.registerCommand('xcodecloud.refreshBuildActions', () => buildActionsProvider?.refresh()),
		vscode.commands.registerCommand('xcodecloud.refreshWorkflowDetails', () => workflowDetailsProvider?.refresh()),

		// Trigger build
		vscode.commands.registerCommand('xcodecloud.triggerBuild', async (workflowNode?: WorkflowItem) => {
			if (!client) { return; }
			try {
				const workflowId = workflowNode?.id || (await workflowsProvider?.pickWorkflowId());
				if (!workflowId) { return; }

				const workflowName = workflowNode?.label?.toString() || `Workflow ${workflowId.slice(-6)}`;

				// Pick branch/tag via scmGitReferences
				const gitRefId = await buildRunsProvider?.pickGitReferenceId(workflowId);
				const buildRun = await client.createBuildRun(workflowId, gitRefId || undefined);

				const buildId = buildRun?.id;
				if (buildId) {
					vscode.window.showInformationMessage(`🚀 Triggered build: ${workflowName}`);
					buildMonitor?.trackBuild(buildId, workflowName);
				}

				buildRunsProvider?.refresh(workflowId);
				updateStatusBar();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to trigger build: ${err?.message || String(err)}`);
			}
		}),

		// Cancel build
		vscode.commands.registerCommand('xcodecloud.cancelBuild', async (buildNode?: BuildRunItem) => {
			if (!client || !buildNode?.id) { return; }

			const confirm = await vscode.window.showWarningMessage(
				`Are you sure you want to cancel build ${buildNode.label}?`,
				{ modal: true },
				'Cancel Build'
			);

			if (confirm !== 'Cancel Build') { return; }

			try {
				await client.cancelBuildRun(buildNode.id);
				vscode.window.showInformationMessage(`Build ${buildNode.label} canceled.`);
				buildRunsProvider?.refresh();
				updateStatusBar();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to cancel build: ${err?.message || String(err)}`);
			}
		}),

		// View build logs/actions
		vscode.commands.registerCommand('xcodecloud.viewBuildLogs', async (buildNode?: BuildRunItem) => {
			if (!buildNode?.id) {
				vscode.window.showWarningMessage('Select a build to view its actions.');
				return;
			}

			buildActionsProvider?.setBuildRun(buildNode.id, buildNode.label?.toString());
			// Focus the build actions view
			await vscode.commands.executeCommand('xcodecloudBuildActions.focus');
		}),

		// View workflow details
		vscode.commands.registerCommand('xcodecloud.viewWorkflowDetails', async (workflowNode?: WorkflowItem) => {
			if (!workflowNode?.id) {
				vscode.window.showWarningMessage('Select a workflow to view its details.');
				return;
			}

			workflowDetailsProvider?.setWorkflow(workflowNode.id, workflowNode.label?.toString());
			// Focus the workflow details view
			await vscode.commands.executeCommand('xcodecloudWorkflowDetails.focus');
		}),

		// Open in browser (App Store Connect)
		vscode.commands.registerCommand('xcodecloud.openInBrowser', async () => {
			// App Store Connect URL for Xcode Cloud
			const url = 'https://appstoreconnect.apple.com/access/integrations/ci';
			vscode.env.openExternal(vscode.Uri.parse(url));
		}),

		// Disposable for build monitor cleanup
		{ dispose: () => buildMonitor?.dispose() }
	);

	// Prompt for credentials on first run
	const configured = await client.hasCredentials();
	if (!configured) {
		const choice = await vscode.window.showInformationMessage(
			'Configure App Store Connect credentials to use Xcode Cloud Control.',
			'Configure'
		);
		if (choice === 'Configure') {
			await ensureCredentials(context.secrets);
		}
	}

	// Start build monitoring if credentials exist
	if (configured) {
		buildMonitor.start();
		statusBarItem.show();
	}

	workflowsProvider?.refresh();
	buildRunsProvider?.refresh();
}

async function updateStatusBar() {
	if (!statusBarItem || !client) { return; }

	try {
		const runs = await client.listAllRecentBuilds({ limit: 5 });
		const data = runs?.data || [];

		const running = data.filter((r: any) => {
			const progress = r?.attributes?.executionProgress?.toUpperCase();
			return progress === 'RUNNING' || progress === 'PENDING';
		}).length;

		if (running > 0) {
			statusBarItem.text = `$(sync~spin) ${running} build${running > 1 ? 's' : ''} running`;
			statusBarItem.backgroundColor = undefined;
		} else {
			// Check last build status
			const lastBuild = data[0];
			const status = lastBuild?.attributes?.completionStatus?.toUpperCase();

			if (status === 'SUCCEEDED') {
				statusBarItem.text = '$(pass) Xcode Cloud';
				statusBarItem.backgroundColor = undefined;
			} else if (status === 'FAILED') {
				statusBarItem.text = '$(error) Xcode Cloud';
				statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
			} else {
				statusBarItem.text = '$(cloud) Xcode Cloud';
				statusBarItem.backgroundColor = undefined;
			}
		}

		statusBarItem.show();
	} catch {
		statusBarItem.text = '$(cloud) Xcode Cloud';
		statusBarItem.show();
	}
}

export function deactivate() {
	buildMonitor?.dispose();
	statusBarItem?.dispose();
}