import * as vscode from 'vscode';

export type Stub = { restore: () => void };

export function stubQuickPick<T extends vscode.QuickPickItem>(result?: T): Stub {
    const original = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => result as any;
    return { restore: () => { vscode.window.showQuickPick = original; } };
}

export function stubInfoMessage(): { calls: string[]; stub: Stub } {
    const original = vscode.window.showInformationMessage;
    const calls: string[] = [];
    (vscode.window as any).showInformationMessage = async (msg: string) => {
        calls.push(msg);
        return undefined as any;
    };
    return { calls, stub: { restore: () => { vscode.window.showInformationMessage = original; } } };
}

export function stubWarnMessage(): { calls: string[]; stub: Stub } {
    const original = vscode.window.showWarningMessage;
    const calls: string[] = [];
    (vscode.window as any).showWarningMessage = async (msg: string) => {
        calls.push(msg);
        return undefined as any;
    };
    return { calls, stub: { restore: () => { vscode.window.showWarningMessage = original; } } };
}

export function stubErrorMessage(): { calls: string[]; stub: Stub } {
    const original = vscode.window.showErrorMessage;
    const calls: string[] = [];
    (vscode.window as any).showErrorMessage = async (msg: string) => {
        calls.push(msg);
        return undefined as any;
    };
    return { calls, stub: { restore: () => { vscode.window.showErrorMessage = original; } } };
}

export function restoreAll(stubs: Stub[]) {
    for (const s of stubs) {s.restore();}
}
