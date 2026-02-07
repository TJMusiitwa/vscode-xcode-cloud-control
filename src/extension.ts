import * as vscode from 'vscode';
import { AppStoreConnectClient } from './lib/appstoreconnect/client';
import { BuildMonitor } from './lib/buildMonitor';
import { ensureCredentials } from './lib/credentials';
import { BuildActionNode, BuildRunNode, UnifiedWorkflowTreeDataProvider, WorkflowNode } from './lib/views/UnifiedWorkflowTree';
import { filterLogArtifacts } from './lib/views/BuildLogsPanel';
import { WorkflowDetailsTreeDataProvider } from './lib/views/WorkflowDetailsTree';
import { WorkflowEditorPanel } from './lib/views/WorkflowEditorPanel';

let client: AppStoreConnectClient | null = null;
let unifiedProvider: UnifiedWorkflowTreeDataProvider | null = null;
let workflowDetailsProvider: WorkflowDetailsTreeDataProvider | null = null;
let buildMonitor: BuildMonitor | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let logChannel: vscode.OutputChannel | null = null;

export async function activate(context: vscode.ExtensionContext) {
	client = new AppStoreConnectClient(context.secrets);

	unifiedProvider = new UnifiedWorkflowTreeDataProvider(client);
	workflowDetailsProvider = new WorkflowDetailsTreeDataProvider(client);
	const ensureLogChannel = () => {
		if (!logChannel) {
			logChannel = vscode.window.createOutputChannel('Xcode Cloud Logs');
			context.subscriptions.push(logChannel);
		}
		return logChannel;
	};

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

		// View build logs (artifacts)
		vscode.commands.registerCommand('xcodecloud.viewBuildLogs', async (node?: BuildRunNode | BuildActionNode) => {
			if (!client) { return; }
			const activeClient = client;

			const pickBuildRun = async (): Promise<{ id: string; label: string } | undefined> => {
				const recent = await activeClient.listAllRecentBuilds({ limit: 20 });
				const items = (recent?.data || []).map((run: any) => {
					const attrs = run?.attributes || {};
					const label = `#${attrs.number || run.id.slice(-6)}`;
					const status = attrs.executionProgress || attrs.completionStatus || '';
					return { label, description: status, id: run.id };
				});
				if (items.length === 0) {
					vscode.window.showWarningMessage('No recent builds found.');
					return undefined;
				}
				return vscode.window.showQuickPick(items, { placeHolder: 'Select a build run' }) as any;
			};

			const pickAction = async (buildRunId: string, preselectName?: string): Promise<{ id: string; label: string } | undefined> => {
				const resp = await activeClient.getBuildActions(buildRunId);
				const actions = resp?.data || [];
				if (actions.length === 0) {
					vscode.window.showWarningMessage('No build actions available yet for this run.');
					return undefined;
				}
				const items = actions.map((action: any) => {
					const attrs = action?.attributes || {};
					const label = attrs.name || 'Unknown Action';
					const description = attrs.executionProgress || attrs.completionStatus || '';
					return { label, description, id: action.id };
				});
				if (preselectName) {
					const found = items.find((i: { label: string }) => i.label === preselectName);
					if (found) { return found; }
				}
				return vscode.window.showQuickPick(items, { placeHolder: 'Select a build action' }) as any;
			};

			const pickLogArtifact = async (actionId: string) => {
				const artifactsResp = await activeClient.getBuildActionArtifacts(actionId);
				const candidates = filterLogArtifacts(artifactsResp?.data || []);
				if (candidates.length === 0) {
					vscode.window.showWarningMessage('No log artifacts are available for this action yet.');
					return undefined;
				}
				if (candidates.length === 1) { return candidates[0]; }

					const items = candidates.map((artifact: any) => ({
						label: artifact?.attributes?.fileName || 'Log artifact',
						description: artifact?.attributes?.fileType || '',
						id: artifact.id
					}));
					const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Select a log artifact' }) as any;
					if (!choice) { return undefined; }
					return candidates.find((c: any) => c.id === choice?.id) || candidates[0];
				};

			try {
				let buildRunId = node && 'buildRunId' in node ? node.buildRunId : undefined;
				let buildLabel = node && 'runNumber' in node ? `#${node.runNumber}` : undefined;

				if (!buildRunId) {
					const picked = await pickBuildRun();
					if (!picked) { return; }
					buildRunId = picked.id;
					buildLabel = picked.label;
				}

				let action: { id: string; label: string } | undefined;
				if (node && 'actionId' in node) {
					action = { id: node.actionId, label: node.actionName };
				} else if (buildRunId) {
					action = await pickAction(buildRunId);
				}

				if (!action || !buildRunId) { return; }

				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Fetching Xcode Cloud build logs...'
					}, async () => {
						const artifact = await pickLogArtifact(action!.id);
						if (!artifact) { return; }

						const downloaded = await activeClient.downloadArtifactContent(artifact.id);
						const channel = ensureLogChannel();
					channel.clear();
					channel.appendLine(`Build: ${buildLabel || buildRunId}`);
					channel.appendLine(`Action: ${action!.label}`);
					channel.appendLine(`Artifact: ${downloaded.fileName || artifact?.attributes?.fileName || artifact.id}`);
					channel.appendLine(`Fetched: ${new Date().toLocaleString()}`);
					channel.appendLine('------------------------------');
					channel.append(downloaded.content || '');
					channel.show(true);
				});
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to load build logs: ${err?.message || String(err)}`);
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
}
