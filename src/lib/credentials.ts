import * as vscode from 'vscode';

const SECRET_ISSUER_ID = 'asc.issuerId';
const SECRET_KEY_ID = 'asc.keyId';
const SECRET_PRIVATE_KEY = 'asc.privateKey';

export async function ensureCredentials(secretStorage: vscode.SecretStorage) {
    const issuerId = await secretStorage.get(SECRET_ISSUER_ID);
    const keyId = await secretStorage.get(SECRET_KEY_ID);
    const privateKey = await secretStorage.get(SECRET_PRIVATE_KEY);

    const inputIssuer = await vscode.window.showInputBox({
        prompt: 'App Store Connect Issuer ID',
        value: issuerId || '',
        ignoreFocusOut: true
    });
    if (!inputIssuer) { return; }

    const inputKeyId = await vscode.window.showInputBox({
        prompt: 'App Store Connect Key ID',
        value: keyId || '',
        ignoreFocusOut: true
    });
    if (!inputKeyId) { return; }

    const inputPrivateKey = await vscode.window.showInputBox({
        prompt: 'Paste App Store Connect Private Key (.p8) contents',
        value: privateKey || '',
        ignoreFocusOut: true,
        password: true
    });
    if (!inputPrivateKey) { return; }

    await secretStorage.store(SECRET_ISSUER_ID, inputIssuer.trim());
    await secretStorage.store(SECRET_KEY_ID, inputKeyId.trim());
    await secretStorage.store(SECRET_PRIVATE_KEY, inputPrivateKey.trim());
}

export const CredentialKeys = {
    ISSUER_ID: SECRET_ISSUER_ID,
    KEY_ID: SECRET_KEY_ID,
    PRIVATE_KEY: SECRET_PRIVATE_KEY
};