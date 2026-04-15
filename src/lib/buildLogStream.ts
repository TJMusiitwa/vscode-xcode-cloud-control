import * as vscode from 'vscode';

export class BuildLogStream {
    private channels = new Map<string, vscode.OutputChannel>();

    openForBuild(buildRunId: string, runNumber: number, workflowName: string): vscode.OutputChannel {
        let channel = this.channels.get(buildRunId);
        if (!channel) {
            channel = vscode.window.createOutputChannel(`Xcode Cloud: Build #${runNumber}`);
            this.channels.set(buildRunId, channel);

            const startTime = new Date().toLocaleTimeString();
            channel.appendLine('════════════════════════════════════════');
            channel.appendLine(`  Xcode Cloud Build #${runNumber}  |  ${workflowName}`);
            channel.appendLine(`  Started: ${startTime}`);
            channel.appendLine('════════════════════════════════════════\n');
        }
        return channel;
    }

    appendActionStart(buildRunId: string, actionName: string, _actionType: string): void {
        const channel = this.channels.get(buildRunId);
        if (channel) {
            const time = new Date().toLocaleTimeString();
            channel.appendLine(`▶ [${time}] ${actionName.toUpperCase()} (Running...)`);
        }
    }

    appendActionComplete(buildRunId: string, actionName: string, status: string): void {
        const channel = this.channels.get(buildRunId);
        if (channel) {
            const time = new Date().toLocaleTimeString();
            const icon = status.toUpperCase() === 'SUCCEEDED' ? '✓' : (status.toUpperCase() === 'FAILED' ? '✗' : 'ℹ');
            channel.appendLine(`${icon} [${time}] ${actionName.toUpperCase()} — ${status}`);
        }
    }

    appendActionLogs(buildRunId: string, logContent: string): void {
        const channel = this.channels.get(buildRunId);
        if (channel) {
            channel.appendLine(logContent);
            channel.appendLine('');
        }
    }

    closeBuild(buildRunId: string): void {
        const channel = this.channels.get(buildRunId);
        if (channel) {
            const time = new Date().toLocaleTimeString();
            channel.appendLine(`\n════════ Build Completed at ${time} ════`);
            // We do not dispose it immediately so the user can still read the logs
        }
    }

    dispose(): void {
        for (const channel of this.channels.values()) {
            channel.dispose();
        }
        this.channels.clear();
    }
}
