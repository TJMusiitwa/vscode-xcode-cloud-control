import * as vscode from 'vscode';
import { formatDuration } from './utils';

export class TimelineTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private data: any[] | null = null;
    private isLoading = false;
    private loadingMessage = '';
    private errorMessage = '';
    private isFallbackMode = false;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setLoading(loading: boolean, message = 'Loading timeline...'): void {
        this.isLoading = loading;
        this.loadingMessage = message;
        this.errorMessage = '';
        if (loading) { this.data = null; }
        this.refresh();
    }

    setError(message: string): void {
        this.isLoading = false;
        this.errorMessage = message;
        this.data = null;
        this.refresh();
    }

    setTimeline(data: any[], isFallbackMode = false): void {
        this.isLoading = false;
        this.errorMessage = '';
        this.data = data;
        this.isFallbackMode = isFallbackMode;
        this.refresh();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
        if (this.isLoading) {
            if (element) { return []; }
            return [new TimelineMessageItem(this.loadingMessage, 'sync~spin')];
        }

        if (this.errorMessage) {
            if (element) { return []; }
            return [new TimelineMessageItem(this.errorMessage, 'error')];
        }

        if (!this.data) {
            if (element) { return []; }
            return [new TimelineMessageItem('Select a completed build run to view its timeline', 'info')];
        }

        if (!element) {
            const rootItems: vscode.TreeItem[] = [];
            if (this.isFallbackMode) {
                rootItems.push(new TimelineMessageItem('Running on Windows/Linux — timeline shows API-level actions only. Install Xcode on macOS for detailed phase breakdown.', 'warning'));
            }
            return rootItems.concat(this.data.map(d => new TimelineNode(d)));
        }

        if (element instanceof TimelineNode && element.data.children) {
            return element.data.children.map((c: any) => new TimelineNode(c));
        }

        return [];
    }
}

class TimelineMessageItem extends vscode.TreeItem {
    constructor(label: string, iconId: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(iconId);
        this.contextValue = 'timelineMessage';
    }
}

class TimelineNode extends vscode.TreeItem {
    constructor(public readonly data: any) {
        super(
            data.name || 'Unknown',
            data.children && data.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        this.id = data.id;
        this.contextValue = data.type === 'action' ? 'timelineAction' : 'timelineTask';

        let iconId = 'circle-outline';
        if (data.status === 'SUCCEEDED') { iconId = 'pass'; this.iconPath = new vscode.ThemeIcon(iconId, new vscode.ThemeColor('testing.iconPassed')); }
        else if (data.status === 'FAILED') { iconId = 'error'; this.iconPath = new vscode.ThemeIcon(iconId, new vscode.ThemeColor('testing.iconFailed')); }
        else if (data.status === 'SKIPPED') { iconId = 'debug-step-over'; this.iconPath = new vscode.ThemeIcon(iconId); }
        else { this.iconPath = new vscode.ThemeIcon(iconId); }

        if (data.durationMs !== undefined) {
            this.description = formatDuration(data.durationMs);
        }

        this.tooltip = this.buildTooltip(data);
    }

    private buildTooltip(data: any): vscode.MarkdownString {
        const parts = [`**${data.name}**`];
        parts.push(`Type: ${data.type}`);
        parts.push(`Status: ${data.status}`);
        if (data.durationMs !== undefined) {
            parts.push(`Duration: ${formatDuration(data.durationMs)}`);
        }
        return new vscode.MarkdownString(parts.join('\n\n'));
    }
}
