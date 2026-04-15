import * as vscode from 'vscode';
import { AppStoreConnectClient } from './lib/appstoreconnect/client';
import { BuildMonitor } from './lib/buildMonitor';
import { ensureCredentials } from './lib/credentials';
import { TimelineGenerator, TimelineLoader, TimelineTreeDataProvider } from './lib/timeline';
import { BuildRunNode, UnifiedWorkflowTreeDataProvider, WorkflowNode } from './lib/views/UnifiedWorkflowTree';
import { WorkflowDetailsTreeDataProvider } from './lib/views/WorkflowDetailsTree';
import { WorkflowEditorPanel } from './lib/views/WorkflowEditorPanel';

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

	// Create and register tree providers
	const workflowsTreeView = vscode.window.createTreeView('xcodecloudWorkflowRuns', {
		treeDataProvider: unifiedProvider,
		showCollapseAll: true
	});

	const timelineProvider = new TimelineTreeDataProvider();
	const timelineTreeView = vscode.window.createTreeView('xcodecloudBuildTimeline', {
		treeDataProvider: timelineProvider,
		showCollapseAll: true
	});

	context.subscriptions.push(
		statusBarItem,
		workflowsTreeView,
		timelineTreeView,
		vscode.window.registerTreeDataProvider('xcodecloudWorkflowDetails', workflowDetailsProvider),

		// Listen for selection changes to update details
		workflowsTreeView.onDidChangeSelection(e => {
			const selected = e.selection[0];
			if (selected && selected.nodeType === 'workflow') {
				workflowDetailsProvider?.setWorkflow(selected.workflowId, selected.workflowName);
			} else if (selected && selected.nodeType === 'buildRun') {
				// Also update details when a build run is selected (shows its parent workflow)
				workflowDetailsProvider?.setWorkflow(selected.workflowId);

				// Auto-load timeline if it's complete
				if (selected.contextValue === 'buildRunComplete') {
					vscode.commands.executeCommand('xcodecloud.loadTimeline', selected);
				}
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
					buildMonitor?.trackBuild(buildId, workflowName, buildRun?.attributes?.number);
				}

				// Expand the workflow in the tree so the new build run is immediately visible.
				// We expand before refresh so that when the tree data reloads, the node is
				// already open and the new build run appears at the top without a manual click.
				if (workflowNode) {
					await workflowsTreeView.reveal(workflowNode, { expand: 1, select: true, focus: false });
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

		// Load Build Timeline
		vscode.commands.registerCommand('xcodecloud.loadTimeline', async (buildRunNode?: BuildRunNode) => {
			if (!client || !buildRunNode?.buildRunId) { return; }

			const config = vscode.workspace.getConfiguration('xcodecloud');
			const enableDetailed = config.get<boolean>('enableDetailedTimeline', true);

			timelineProvider.setLoading(true);
			await vscode.commands.executeCommand('setContext', 'xcodecloud.timelineLoaded', true);
			await vscode.commands.executeCommand('xcodecloudBuildTimeline.focus');

			const generator = new TimelineGenerator(client);
			try {
				const isDetailed = await generator.canFetchDetailedTasks(enableDetailed);
				const raw = await generator.generateTimeline(
					{ buildRunId: buildRunNode.buildRunId, workflowName: `Build #${buildRunNode.runNumber}` },
					{ fetchDetailedTasks: isDetailed, onProgress: msg => timelineProvider.setLoading(true, msg) }
				);
				const loader = new TimelineLoader();
				const result = loader.load(raw);

				if (result.success && result.data) {
					timelineProvider.setTimeline(result.data, !isDetailed);
				} else {
					timelineProvider.setError(result.errors[0]?.message ?? 'Failed to load timeline');
				}
			} catch (err: any) {
				timelineProvider.setError(`Error: ${err?.message || String(err)}`);
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

		// React to settings changes at runtime
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('xcodecloud.pollIntervalSeconds')) {
				buildMonitor?.restart();
			}
			if (e.affectsConfiguration('xcodecloud.enableDetailedTimeline')) {
				// Reset the timeline so the next load respects the new setting
				timelineProvider.setTimeline([]);
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