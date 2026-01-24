import * as vscode from 'vscode';
import { AppStoreConnectClient } from './lib/appstoreconnect/client';
import { BuildMonitor } from './lib/buildMonitor';
import { ensureCredentials } from './lib/credentials';
import { BuildRunNode, UnifiedWorkflowTreeDataProvider, WorkflowNode } from './lib/views/UnifiedWorkflowTree';
import { WorkflowDetailsTreeDataProvider } from './lib/views/WorkflowDetailsTree';

let client: AppStoreConnectClient | null = null;
let unifiedProvider: UnifiedWorkflowTreeDataProvider | null = null;
let workflowDetailsProvider: WorkflowDetailsTreeDataProvider | null = null;
let buildMonitor: BuildMonitor | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;

export async function activate(context: vscode.ExtensionContext) {
	client = new AppStoreConnectClient(context.secrets);

	unifiedProvider = new UnifiedWorkflowTreeDataProvider(client);
	workflowDetailsProvider = new WorkflowDetailsTreeDataProvider(client);

	// Initialize build monitor for notifications
	buildMonitor = new BuildMonitor(client, () => {
		unifiedProvider?.refresh();
		updateStatusBar();
	});

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = 'xcodecloudWorkflowRuns.focus';
	statusBarItem.tooltip = 'Xcode Cloud Build Status';
	updateStatusBar();

	context.subscriptions.push(
		statusBarItem,
		vscode.window.registerTreeDataProvider('xcodecloudWorkflowRuns', unifiedProvider),
		vscode.window.registerTreeDataProvider('xcodecloudWorkflowDetails', workflowDetailsProvider),

		// Configure credentials
		vscode.commands.registerCommand('xcodecloud.configureCredentials', async () => {
			await ensureCredentials(context.secrets);
			vscode.window.showInformationMessage('App Store Connect credentials saved.');
			unifiedProvider?.refresh();
			buildMonitor?.start();
			updateStatusBar();
		}),

		// Refresh commands
		vscode.commands.registerCommand('xcodecloud.refreshWorkflows', () => unifiedProvider?.refresh()),
		vscode.commands.registerCommand('xcodecloud.refreshWorkflowDetails', () => workflowDetailsProvider?.refresh()),

		// Trigger build
		vscode.commands.registerCommand('xcodecloud.triggerBuild', async (workflowNode?: WorkflowNode) => {
			if (!client) { return; }
			try {
				const workflowId = workflowNode?.workflowId || (await unifiedProvider?.pickWorkflowId());
				if (!workflowId) { return; }

				const workflowName = workflowNode?.workflowName || `Workflow ${workflowId.slice(-6)}`;

				// Pick branch/tag via scmGitReferences
				const gitRefId = await unifiedProvider?.pickGitReferenceId(workflowId);
				const buildRun = await client.createBuildRun(workflowId, gitRefId || undefined);

				const buildId = buildRun?.id;
				if (buildId) {
					vscode.window.showInformationMessage(`🚀 Triggered build: ${workflowName}`);
					buildMonitor?.trackBuild(buildId, workflowName);
				}

				unifiedProvider?.refresh();
				updateStatusBar();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to trigger build: ${err?.message || String(err)}`);
			}
		}),

		// Cancel build
		vscode.commands.registerCommand('xcodecloud.cancelBuild', async (buildNode?: BuildRunNode) => {
			if (!client || !buildNode?.buildRunId) { return; }

			const confirm = await vscode.window.showWarningMessage(
				`Are you sure you want to cancel build #${buildNode.runNumber}?`,
				{ modal: true },
				'Cancel Build'
			);

			if (confirm !== 'Cancel Build') { return; }

			try {
				await client.cancelBuildRun(buildNode.buildRunId);
				vscode.window.showInformationMessage(`Build #${buildNode.runNumber} canceled.`);
				unifiedProvider?.refresh();
				updateStatusBar();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to cancel build: ${err?.message || String(err)}`);
			}
		}),

		// View workflow details
		vscode.commands.registerCommand('xcodecloud.viewWorkflowDetails', async (workflowNode?: WorkflowNode) => {
			if (!workflowNode?.workflowId) {
				vscode.window.showWarningMessage('Select a workflow to view its details.');
				return;
			}

			workflowDetailsProvider?.setWorkflow(workflowNode.workflowId, workflowNode.workflowName);
			// Focus the workflow details view
			await vscode.commands.executeCommand('xcodecloudWorkflowDetails.focus');
		}),

		// Open in browser (App Store Connect)
		vscode.commands.registerCommand('xcodecloud.openInBrowser', async () => {
			// App Store Connect URL for Xcode Cloud
			const url = 'https://appstoreconnect.apple.com/access/integrations/ci';
			vscode.env.openExternal(vscode.Uri.parse(url));
		}),

		// Toggle sort order
		vscode.commands.registerCommand('xcodecloud.toggleSortOrder', () => {
			if (unifiedProvider) {
				unifiedProvider.toggleSortOrder();
				const order = unifiedProvider.sortOrder === 'desc' ? 'Newest first' : 'Oldest first';
				vscode.window.showInformationMessage(`Build runs sorted: ${order}`);
			}
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

	unifiedProvider?.refresh();
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