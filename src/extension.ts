import * as vscode from 'vscode';
import { AppStoreConnectClient } from './lib/appstoreconnect/client';
import { BuildMonitor } from './lib/buildMonitor';
import { ensureCredentials } from './lib/credentials';
import { BuildActionNode, BuildRunNode, UnifiedWorkflowTreeDataProvider, WorkflowNode } from './lib/views/UnifiedWorkflowTree';
import { WorkflowDetailsTreeDataProvider } from './lib/views/WorkflowDetailsTree';
import { WorkflowEditorPanel } from './lib/views/WorkflowEditorPanel';

let client: AppStoreConnectClient | null = null;
let unifiedProvider: UnifiedWorkflowTreeDataProvider | null = null;
let workflowDetailsProvider: WorkflowDetailsTreeDataProvider | null = null;
let buildMonitor: BuildMonitor | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let logsOutputChannel: vscode.OutputChannel | null = null;

export async function activate(context: vscode.ExtensionContext) {
	client = new AppStoreConnectClient(context.secrets);

	// Create output channel for build logs
	logsOutputChannel = vscode.window.createOutputChannel('Xcode Cloud Logs');

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

	// Create and register tree providers
	const workflowsTreeView = vscode.window.createTreeView('xcodecloudWorkflowRuns', {
		treeDataProvider: unifiedProvider,
		showCollapseAll: true
	});

	context.subscriptions.push(
		statusBarItem,
		logsOutputChannel,
		workflowsTreeView,
		vscode.window.registerTreeDataProvider('xcodecloudWorkflowDetails', workflowDetailsProvider),

		// Listen for selection changes to update details
		workflowsTreeView.onDidChangeSelection(e => {
			const selected = e.selection[0];
			if (selected && selected.nodeType === 'workflow') {
				workflowDetailsProvider?.setWorkflow(selected.workflowId, selected.workflowName);
			} else if (selected && selected.nodeType === 'buildRun') {
				// Also update details when a build run is selected (shows its parent workflow)
				workflowDetailsProvider?.setWorkflow(selected.workflowId);
			}
		}),

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

		// View build logs
		vscode.commands.registerCommand('xcodecloud.viewBuildLogs', async (buildActionNode?: BuildActionNode) => {
			if (!client || !logsOutputChannel) { return; }

			try {
				let actionId: string | undefined;
				let actionName: string | undefined;

				if (buildActionNode?.actionId) {
					actionId = buildActionNode.actionId;
					actionName = buildActionNode.actionName;
				} else {
					// If no node provided, let user select from tree
					vscode.window.showWarningMessage('Select a build action to view its logs.');
					return;
				}

				// Show output channel
				logsOutputChannel.clear();
				logsOutputChannel.show(true);
				logsOutputChannel.appendLine(`Fetching logs for: ${actionName || 'Build Action'}`);
				logsOutputChannel.appendLine(`Action ID: ${actionId}`);
				logsOutputChannel.appendLine('='.repeat(80));
				logsOutputChannel.appendLine('');

				// Fetch artifacts for this build action
				const artifactsResponse = await client.getBuildActionArtifacts(actionId);
				const artifacts = artifactsResponse?.data || [];

				if (artifacts.length === 0) {
					logsOutputChannel.appendLine('No artifacts (logs) found for this build action.');
					logsOutputChannel.appendLine('');
					logsOutputChannel.appendLine('Note: Logs may not be available for actions that are:');
					logsOutputChannel.appendLine('  - Still running or pending');
					logsOutputChannel.appendLine('  - Skipped or canceled');
					logsOutputChannel.appendLine('  - Too old (logs are retained for a limited time)');
					return;
				}

				// Find log artifacts (typically named like "build-log", "test-log", etc.)
				const logArtifacts = artifacts.filter((artifact: any) => {
					const fileType = artifact?.attributes?.fileType || '';
					const name = artifact?.attributes?.fileName || '';
					return fileType.toLowerCase() === 'log' || name.toLowerCase().includes('log');
				});

				if (logArtifacts.length === 0) {
					logsOutputChannel.appendLine(`Found ${artifacts.length} artifact(s), but none are log files.`);
					logsOutputChannel.appendLine('');
					logsOutputChannel.appendLine('Available artifacts:');
					for (const artifact of artifacts) {
						const name = artifact?.attributes?.fileName || 'Unknown';
						const type = artifact?.attributes?.fileType || 'Unknown';
						logsOutputChannel.appendLine(`  - ${name} (${type})`);
					}
					return;
				}

				// Download and display each log artifact
				for (const artifact of logArtifacts) {
					const artifactId = artifact.id;
					const fileName = artifact?.attributes?.fileName || 'log';
					const sizeBytes = artifact?.attributes?.fileSizeBytes || 0;

					if (!logsOutputChannel) { return; }
					logsOutputChannel.appendLine(`\n📄 ${fileName} (${formatFileSize(sizeBytes)})`);
					logsOutputChannel.appendLine('-'.repeat(80));

					try {
						// Get download URL
						const artifactDetails = await client.getArtifact(artifactId);
						const downloadUrl = artifactDetails?.data?.attributes?.downloadUrl;

						if (!downloadUrl) {
							logsOutputChannel.appendLine('Error: Download URL not available for this artifact.');
							continue;
						}

						// Download log content
						logsOutputChannel.appendLine('Downloading...');
						const logContent = await client.downloadArtifactContent(downloadUrl);

						// Display log content
						logsOutputChannel.appendLine('');
						logsOutputChannel.appendLine(logContent);
						logsOutputChannel.appendLine('');
						logsOutputChannel.appendLine('-'.repeat(80));

					} catch (err: any) {
						logsOutputChannel.appendLine(`Error downloading ${fileName}: ${err?.message || String(err)}`);
					}
				}

				logsOutputChannel.appendLine('');
				logsOutputChannel.appendLine('='.repeat(80));
				logsOutputChannel.appendLine('✅ Logs loaded successfully');

			} catch (err: any) {
				logsOutputChannel?.appendLine('');
				logsOutputChannel?.appendLine('❌ Error fetching logs:');
				logsOutputChannel?.appendLine(err?.message || String(err));
				vscode.window.showErrorMessage(`Failed to fetch logs: ${err?.message || String(err)}`);
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

		// Create workflow
		vscode.commands.registerCommand('xcodecloud.createWorkflow', async () => {
			if (!client) { return; }

			try {
				// First, pick a product to create the workflow for
				const products = await client.listProducts();
				const productItems = (products?.data || []).map((p: any) => ({
					label: p?.attributes?.name || p.id,
					productId: p.id
				}));

				if (productItems.length === 0) {
					vscode.window.showWarningMessage('No Xcode Cloud products found. Create a product in App Store Connect first.');
					return;
				}

				const selectedProduct = await vscode.window.showQuickPick(productItems, {
					placeHolder: 'Select a product to create the workflow for'
				}) as any;

				if (!selectedProduct) { return; }

				WorkflowEditorPanel.createOrShow(
					context.extensionUri,
					client,
					'create',
					undefined,
					undefined,
					selectedProduct.productId
				);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to create workflow: ${err?.message || String(err)}`);
			}
		}),

		// Edit workflow
		vscode.commands.registerCommand('xcodecloud.editWorkflow', async (workflowNode?: WorkflowNode) => {
			if (!client) { return; }

			const workflowId = workflowNode?.workflowId || (await unifiedProvider?.pickWorkflowId());
			if (!workflowId) { return; }

			const workflowName = workflowNode?.workflowName || `Workflow ${workflowId.slice(-6)}`;

			WorkflowEditorPanel.createOrShow(
				context.extensionUri,
				client,
				'edit',
				workflowId,
				workflowName
			);
		}),

		// Delete workflow (with modal confirmation)
		vscode.commands.registerCommand('xcodecloud.deleteWorkflow', async (workflowNode?: WorkflowNode) => {
			if (!client) { return; }

			const workflowId = workflowNode?.workflowId || (await unifiedProvider?.pickWorkflowId());
			if (!workflowId) { return; }

			const workflowName = workflowNode?.workflowName || `Workflow ${workflowId.slice(-6)}`;

			// Show modal confirmation dialog
			const confirm = await vscode.window.showWarningMessage(
				`Are you sure you want to delete "${workflowName}"?\n\nThis will permanently delete the workflow and all its associated build runs. This action cannot be undone.`,
				{ modal: true, detail: 'This will delete all build history for this workflow.' },
				'Delete Workflow'
			);

			if (confirm !== 'Delete Workflow') { return; }

			try {
				await client.deleteWorkflow(workflowId);
				vscode.window.showInformationMessage(`Workflow "${workflowName}" deleted successfully.`);
				unifiedProvider?.refresh();
				workflowDetailsProvider?.clear();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to delete workflow: ${err?.message || String(err)}`);
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
	logsOutputChannel?.dispose();
}

function formatFileSize(bytes: number): string {
	if (bytes === 0) { return '0 B'; }
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}