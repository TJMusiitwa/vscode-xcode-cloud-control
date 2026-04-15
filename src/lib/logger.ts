import * as vscode from 'vscode';

export class Logger {
    private channel: vscode.OutputChannel;

    constructor(name: string) {
        this.channel = vscode.window.createOutputChannel(name);
    }

    log(msg: string): void {
        this.channel.appendLine(`[INFO] ${msg}`);
    }

    warn(msg: string): void {
        this.channel.appendLine(`[WARN] ${msg}`);
    }

    error(msg: string): void {
        this.channel.appendLine(`[ERROR] ${msg}`);
    }

    show(): void {
        this.channel.show(true);
    }

    dispose(): void {
        this.channel.dispose();
    }
}

export const logger = new Logger('Xcode Cloud');
