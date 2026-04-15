import * as vscode from 'vscode';

export class Logger {
    private channel: vscode.OutputChannel;

    constructor(name: string) {
        this.channel = vscode.window.createOutputChannel(name);
    }

    private timestamp(): string {
        return new Date().toISOString().replace('T', ' ').substring(0, 23);
    }

    log(msg: string): void {
        this.channel.appendLine(`[${this.timestamp()}] [INFO]  ${msg}`);
    }

    warn(msg: string): void {
        this.channel.appendLine(`[${this.timestamp()}] [WARN]  ${msg}`);
    }

    error(msg: string): void {
        this.channel.appendLine(`[${this.timestamp()}] [ERROR] ${msg}`);
    }

    /** Log an outgoing API request. */
    request(method: string, path: string): void {
        this.channel.appendLine(`[${this.timestamp()}] [API →] ${method} ${path}`);
    }

    /** Log the result of an API response. */
    response(method: string, path: string, statusCode: number, durationMs: number): void {
        const level = statusCode >= 400 ? '[API ✗]' : '[API ✓]';
        this.channel.appendLine(`[${this.timestamp()}] ${level} ${method} ${path} → ${statusCode} (${durationMs}ms)`);
    }

    show(): void {
        this.channel.show(true);
    }

    dispose(): void {
        this.channel.dispose();
    }
}

export const logger = new Logger('Xcode Cloud');
