import * as vscode from 'vscode';
import { AppStoreConnectClient } from '../appstoreconnect/client';

/**
 * Tree data provider for displaying workflow details
 */
export class WorkflowDetailsTreeDataProvider implements vscode.TreeDataProvider<WorkflowDetailItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private selectedWorkflowId: string | null = null;
    private selectedWorkflowName: string | null = null;

    constructor(private client: AppStoreConnectClient) { }

    /**
     * Set the workflow to display details for
     */
    setWorkflow(workflowId: string, name?: string) {
        this.selectedWorkflowId = workflowId;
        this.selectedWorkflowName = name || `Workflow ${workflowId.slice(-6)}`;
        this.refresh();
    }

    /**
     * Clear the selected workflow
     */
    clear() {
        this.selectedWorkflowId = null;
        this.selectedWorkflowName = null;
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkflowDetailItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WorkflowDetailItem): Promise<WorkflowDetailItem[]> {
        // If no workflow selected, show placeholder
        if (!this.selectedWorkflowId) {
            return [new WorkflowDetailItem(
                'placeholder',
                'Select a workflow to view details',
                '',
                'info',
                true
            )];
        }

        // Root level - show workflow details sections
        if (!element) {
            return this._getWorkflowDetails();
        }

        // Nested children based on section
        if (element.section === 'actions') {
            return this._getWorkflowActions();
        }

        return [];
    }

    private async _getWorkflowDetails(): Promise<WorkflowDetailItem[]> {
        if (!this.selectedWorkflowId) { return []; }

        try {
            const response = await this.client.getWorkflow(this.selectedWorkflowId);
            const workflow = response?.data;
            const attrs = workflow?.attributes || {};

            const items: WorkflowDetailItem[] = [];

            // Workflow name header
            items.push(new WorkflowDetailItem(
                'name',
                this.selectedWorkflowName || 'Workflow',
                '',
                'workflow',
                false,
                undefined,
                'header'
            ));

            // Status
            const isEnabled = attrs.isEnabled;
            items.push(new WorkflowDetailItem(
                'status',
                'Status',
                isEnabled ? 'Enabled' : 'Disabled',
                isEnabled ? 'enabled' : 'disabled'
            ));

            // Description
            if (attrs.description) {
                items.push(new WorkflowDetailItem(
                    'description',
                    'Description',
                    attrs.description,
                    'text'
                ));
            }

            // Branch start condition
            if (attrs.branchStartCondition) {
                const branch = attrs.branchStartCondition;
                items.push(new WorkflowDetailItem(
                    'branch',
                    'Branch Pattern',
                    branch.patterns?.join(', ') || 'All branches',
                    'branch'
                ));
            }

            // Tag start condition
            if (attrs.tagStartCondition) {
                const tag = attrs.tagStartCondition;
                items.push(new WorkflowDetailItem(
                    'tag',
                    'Tag Pattern',
                    tag.patterns?.join(', ') || 'All tags',
                    'tag'
                ));
            }

            // Pull request start condition
            if (attrs.pullRequestStartCondition) {
                items.push(new WorkflowDetailItem(
                    'pullRequest',
                    'Pull Requests',
                    'Enabled',
                    'pr'
                ));
            }

            // Scheduled start condition
            if (attrs.scheduledStartCondition) {
                const schedule = attrs.scheduledStartCondition;
                items.push(new WorkflowDetailItem(
                    'schedule',
                    'Schedule',
                    formatSchedule(schedule),
                    'schedule'
                ));
            }

            // Manual start
            if (attrs.manualBranchStartCondition || attrs.manualTagStartCondition || attrs.manualPullRequestStartCondition) {
                items.push(new WorkflowDetailItem(
                    'manual',
                    'Manual Start',
                    'Enabled',
                    'manual'
                ));
            }

            // Clean build
            if (attrs.clean !== undefined) {
                items.push(new WorkflowDetailItem(
                    'clean',
                    'Clean Build',
                    attrs.clean ? 'Yes' : 'No',
                    'info'
                ));
            }

            // Container file path
            if (attrs.containerFilePath) {
                items.push(new WorkflowDetailItem(
                    'container',
                    'Container File',
                    attrs.containerFilePath,
                    'file'
                ));
            }

            // Actions section (expandable)
            items.push(new WorkflowDetailItem(
                'actions',
                'Actions',
                'Click to expand',
                'folder',
                false,
                vscode.TreeItemCollapsibleState.Collapsed,
                'actions'
            ));

            // Last modified
            if (attrs.lastModifiedDate) {
                items.push(new WorkflowDetailItem(
                    'modified',
                    'Last Modified',
                    new Date(attrs.lastModifiedDate).toLocaleString(),
                    'date'
                ));
            }

            return items;
        } catch (err: any) {
            return [new WorkflowDetailItem(
                'error',
                'Error loading workflow',
                err?.message || 'Unknown error',
                'error',
                true
            )];
        }
    }

    private async _getWorkflowActions(): Promise<WorkflowDetailItem[]> {
        if (!this.selectedWorkflowId) { return []; }

        try {
            const response = await this.client.getWorkflow(this.selectedWorkflowId);
            const workflow = response?.data;
            const attrs = workflow?.attributes || {};
            const actions = attrs.actions || [];

            if (actions.length === 0) {
                return [new WorkflowDetailItem(
                    'no-actions',
                    'No actions configured',
                    '',
                    'info',
                    true
                )];
            }

            return actions.map((action: any, index: number) => {
                const name = action.name || `Action ${index + 1}`;
                const actionType = action.actionType || 'Unknown';
                return new WorkflowDetailItem(
                    `action-${index}`,
                    name,
                    actionType,
                    getActionTypeIcon(actionType)
                );
            });
        } catch {
            return [];
        }
    }
}

function formatSchedule(schedule: any): string {
    if (!schedule) { return 'Not scheduled'; }

    const frequency = schedule.frequency;
    const days = schedule.days?.join(', ') || '';
    const hour = schedule.hour ?? 0;
    const minute = schedule.minute ?? 0;
    const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

    if (frequency === 'WEEKLY') {
        return `Weekly on ${days} at ${time}`;
    } else if (frequency === 'DAILY') {
        return `Daily at ${time}`;
    } else if (frequency === 'HOURLY') {
        return `Hourly`;
    }

    return frequency || 'Custom schedule';
}

function getActionTypeIcon(actionType: string): string {
    const type = actionType.toUpperCase();
    if (type.includes('BUILD')) { return 'build'; }
    if (type.includes('TEST')) { return 'test'; }
    if (type.includes('ANALYZE')) { return 'analyze'; }
    if (type.includes('ARCHIVE')) { return 'archive'; }
    return 'action';
}

export class WorkflowDetailItem extends vscode.TreeItem {
    constructor(
        public readonly id: string,
        label: string,
        value: string,
        iconType: string,
        isPlaceholder: boolean = false,
        collapsibleState?: vscode.TreeItemCollapsibleState,
        public readonly section?: string
    ) {
        super(label, collapsibleState ?? vscode.TreeItemCollapsibleState.None);

        this.description = value;
        this.contextValue = isPlaceholder ? 'placeholder' : 'workflowDetail';

        // Set icon based on type
        switch (iconType) {
            case 'workflow':
            case 'header':
                this.iconPath = new vscode.ThemeIcon('gear');
                break;
            case 'enabled':
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
                break;
            case 'disabled':
                this.iconPath = new vscode.ThemeIcon('circle-slash');
                break;
            case 'branch':
                this.iconPath = new vscode.ThemeIcon('git-branch');
                break;
            case 'tag':
                this.iconPath = new vscode.ThemeIcon('tag');
                break;
            case 'pr':
                this.iconPath = new vscode.ThemeIcon('git-pull-request');
                break;
            case 'schedule':
                this.iconPath = new vscode.ThemeIcon('clock');
                break;
            case 'manual':
                this.iconPath = new vscode.ThemeIcon('play');
                break;
            case 'file':
                this.iconPath = new vscode.ThemeIcon('file-code');
                break;
            case 'folder':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'date':
                this.iconPath = new vscode.ThemeIcon('calendar');
                break;
            case 'build':
                this.iconPath = new vscode.ThemeIcon('package');
                break;
            case 'test':
                this.iconPath = new vscode.ThemeIcon('beaker');
                break;
            case 'analyze':
                this.iconPath = new vscode.ThemeIcon('search');
                break;
            case 'archive':
                this.iconPath = new vscode.ThemeIcon('archive');
                break;
            case 'action':
                this.iconPath = new vscode.ThemeIcon('zap');
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
                break;
            case 'text':
            case 'info':
            default:
                this.iconPath = new vscode.ThemeIcon('info');
                break;
        }
    }
}
