import * as vscode from 'vscode';
import { AppStoreConnectClient } from '../appstoreconnect/client';

export class WorkflowsTreeDataProvider implements vscode.TreeDataProvider<WorkflowItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private client: AppStoreConnectClient) { }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    async pickWorkflowId(): Promise<string | undefined> {
        const workflows = await this.client.listWorkflows();
        const items = (workflows?.data || []).map((wf: any) => ({
            label: wf?.attributes?.name || wf.id,
            description: wf.id,
            id: wf.id
        }));
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select workflow' });
        return (pick as any)?.id;
    }

    getTreeItem(element: WorkflowItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<WorkflowItem[]> {
        try {
            const workflows = await this.client.listWorkflows();
            return (workflows?.data || []).map((wf: any) => {
                const item = new WorkflowItem(
                    wf.id,
                    wf?.attributes?.name || wf.id,
                    wf?.attributes?.isEnabled ? 'Enabled' : 'Disabled'
                );
                item.command = {
                    command: 'xcodecloud.triggerBuild',
                    title: 'Trigger Build',
                    arguments: [item]
                };
                return item;
            });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load workflows: ${err?.message || String(err)}`);
            return [];
        }
    }
}

export class WorkflowItem extends vscode.TreeItem {
    constructor(public readonly id: string, label: string, status: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = status;
        this.contextValue = 'workflow';
        this.iconPath = new vscode.ThemeIcon('gear');
    }
}