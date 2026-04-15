import * as vscode from 'vscode';
import { formatDuration, formatStatus, getStatusIcon } from '../shared/formatting';

// =======================
// Node Types
// =======================

export type TreeNode = WorkflowNode | BuildRunNode | BuildActionNode | TestResultNode | IssueNode;

export class WorkflowNode extends vscode.TreeItem {
    readonly nodeType = 'workflow' as const;

    constructor(
        public readonly workflowId: string,
        public readonly workflowName: string,
        public readonly productName: string,
        public readonly isEnabled: boolean,
        public readonly appId?: string
    ) {
        super(workflowName, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = productName;
        this.contextValue = 'workflow';
        this.iconPath = new vscode.ThemeIcon('gear');
        this.tooltip = new vscode.MarkdownString(
            `**${workflowName}**\n\n` +
            `Product: ${productName}\n\n` +
            `Status: ${isEnabled ? 'Enabled' : 'Disabled'}`
        );
        this.command = {
            command: 'xcodecloud.viewWorkflowDetails',
            title: 'View Workflow Details',
            arguments: [this]
        };
    }
}

export class BuildRunNode extends vscode.TreeItem {
    readonly nodeType = 'buildRun' as const;

    constructor(
        public readonly buildRunId: string,
        public readonly workflowId: string,
        public readonly runNumber: number | string,
        public readonly executionProgress: string,
        public readonly completionStatus: string,
        public readonly startedDate?: string,
        public readonly finishedDate?: string,
        public readonly appId?: string
    ) {
        super(`#${runNumber}`, vscode.TreeItemCollapsibleState.Collapsed);

        const isActive = ['PENDING', 'RUNNING'].includes(executionProgress.toUpperCase());
        this.contextValue = isActive ? 'buildRunActive' : 'buildRunComplete';
        this.description = formatStatus(this.executionProgress, this.completionStatus);
        this.iconPath = getStatusIcon(this.executionProgress, this.completionStatus);
        this.tooltip = this.buildTooltip();
    }

    private buildTooltip(): vscode.MarkdownString {
        const parts = [`**Build #${this.runNumber}**`];
        parts.push(`Status: ${formatStatus(this.executionProgress, this.completionStatus)}`);
        if (this.startedDate) {
            parts.push(`Started: ${new Date(this.startedDate).toLocaleString()}`);
        }
        if (this.finishedDate) {
            parts.push(`Finished: ${new Date(this.finishedDate).toLocaleString()}`);
        }
        if (this.startedDate && this.finishedDate) {
            const duration = (new Date(this.finishedDate).getTime() - new Date(this.startedDate).getTime()) / 1000;
            parts.push(`Duration: ${formatDuration(duration)}`);
        }
        return new vscode.MarkdownString(parts.join('\n\n'));
    }
}

export class BuildActionNode extends vscode.TreeItem {
    readonly nodeType = 'buildAction' as const;

    constructor(
        public readonly actionId: string,
        public readonly buildRunId: string,
        public readonly actionName: string,
        public readonly actionType: string,
        public readonly executionProgress: string,
        public readonly completionStatus: string,
        public readonly startedDate?: string,
        public readonly finishedDate?: string
    ) {
        // All completed actions are collapsible to show issues; TEST actions also show test results
        const isTestAction = actionType.toUpperCase() === 'TEST';
        const isComplete = executionProgress.toUpperCase() === 'COMPLETE';
        const collapsibleState = isComplete
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        super(actionName, collapsibleState);

        this.contextValue = isTestAction ? 'buildActionTest' : 'buildAction';
        this.description = formatStatus(this.executionProgress, this.completionStatus);
        this.iconPath = getStatusIcon(this.executionProgress, this.completionStatus);
        this.tooltip = this.buildTooltip();
    }

    private buildTooltip(): vscode.MarkdownString {
        const parts = [`**${this.actionName}**`];
        if (this.actionType) { parts.push(`Type: ${this.actionType}`); }
        parts.push(`Status: ${formatStatus(this.executionProgress, this.completionStatus)}`);
        if (this.startedDate) {
            parts.push(`Started: ${new Date(this.startedDate).toLocaleString()}`);
        }
        if (this.finishedDate) {
            parts.push(`Finished: ${new Date(this.finishedDate).toLocaleString()}`);
        }
        if (this.startedDate && this.finishedDate) {
            const duration = (new Date(this.finishedDate).getTime() - new Date(this.startedDate).getTime()) / 1000;
            parts.push(`Duration: ${formatDuration(duration)}`);
        }
        return new vscode.MarkdownString(parts.join('\n\n'));
    }
}

export class TestResultNode extends vscode.TreeItem {
    readonly nodeType = 'testResult' as const;

    constructor(
        public readonly testId: string,
        public readonly className: string,
        public readonly testName: string,
        public readonly status: 'passed' | 'failed' | 'skipped' | 'expectedFailure' | 'unknown',
        public readonly duration?: number,
        public readonly destinationName?: string,
        public readonly message?: string
    ) {
        // Display test name as label, or class name if no test name
        super(testName || className, vscode.TreeItemCollapsibleState.None);

        this.contextValue = 'testResult';
        this.description = this.formatStatus();
        this.iconPath = this.getStatusIcon();
        this.tooltip = this.buildTooltip();
    }

    private formatStatus(): string {
        const parts: string[] = [];
        if (this.duration !== undefined) {
            parts.push(formatDuration(this.duration));
        }
        return parts.join(' • ') || this.status;
    }

    private getStatusIcon(): vscode.ThemeIcon {
        switch (this.status) {
            case 'passed':
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case 'skipped':
                return new vscode.ThemeIcon('debug-step-over');
            case 'expectedFailure':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private buildTooltip(): vscode.MarkdownString {
        const parts = [`**${this.testName || 'Test'}**`];
        if (this.className) { parts.push(`Class: \`${this.className}\``); }
        parts.push(`Status: ${this.status}`);
        if (this.duration !== undefined) {
            parts.push(`Duration: ${formatDuration(this.duration)}`);
        }
        if (this.destinationName) {
            parts.push(`Device: ${this.destinationName}`);
        }
        if (this.message) {
            parts.push(`\n---\n\n${this.message}`);
        }
        return new vscode.MarkdownString(parts.join('\n\n'));
    }
}

export class IssueNode extends vscode.TreeItem {
    readonly nodeType = 'issue' as const;

    constructor(
        public readonly issueId: string,
        public readonly issueType: 'ANALYZER_WARNING' | 'ERROR' | 'TEST_FAILURE' | 'WARNING',
        public readonly message: string,
        public readonly selfLink?: string,
        public readonly filePath?: string,
        public readonly lineNumber?: number
    ) {
        super(message || 'Unknown Issue', vscode.TreeItemCollapsibleState.None);

        this.contextValue = 'issue';
        this.description = this.formatIssueType();
        this.iconPath = this.getIssueIcon();
        this.tooltip = this.buildTooltip();
    }

    private formatIssueType(): string {
        // Convert ANALYZER_WARNING -> Analyzer Warning, etc.
        return this.issueType.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    private getIssueIcon(): vscode.ThemeIcon {
        switch (this.issueType) {
            case 'ERROR':
            case 'TEST_FAILURE':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case 'WARNING':
            case 'ANALYZER_WARNING':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
            default:
                return new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground'));
        }
    }

    private buildTooltip(): vscode.MarkdownString {
        const parts = [`**${this.formatIssueType()}**`];
        if (this.message) { parts.push(`\n---\n\n${this.message}`); }
        if (this.filePath) {
            const location = this.lineNumber ? `${this.filePath}:${this.lineNumber}` : this.filePath;
            parts.push(`\nLocation: \`${location}\``);
        }
        return new vscode.MarkdownString(parts.join('\n\n'));
    }
}

// =======================
// Unified TreeDataProvider
// =======================
