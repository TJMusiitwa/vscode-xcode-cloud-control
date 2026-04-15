import { importPKCS8, SignJWT } from 'jose';
import * as vscode from 'vscode';
import { JWT_EXPIRY_SECONDS } from '../constants';
import { CredentialKeys } from '../credentials';

const AUDIENCE = 'appstoreconnect-v1';
const ALG = 'ES256';

export class JwtProvider {
    private secretStorage: vscode.SecretStorage;
    private cachedToken: { token: string; exp: number } | null = null;

    constructor(secretStorage: vscode.SecretStorage) {
        this.secretStorage = secretStorage;
    }

    async getToken(): Promise<string> {
        const now = Math.floor(Date.now() / 1000);
        if (this.cachedToken && now < this.cachedToken.exp - 60) {
            return this.cachedToken.token;
        }
        const issuerId = await this.secretStorage.get(CredentialKeys.ISSUER_ID);
        const keyId = await this.secretStorage.get(CredentialKeys.KEY_ID);
        const privateKey = await this.secretStorage.get(CredentialKeys.PRIVATE_KEY);

        if (!issuerId || !keyId || !privateKey) {
            throw new Error('Missing App Store Connect credentials. Run: Xcode Cloud: Configure App Store Connect Credentials');
        }

        const ecPrivateKey = await importPKCS8(privateKey, ALG);
        const iat = Math.floor(Date.now() / 1000);
        const exp = iat + JWT_EXPIRY_SECONDS; // must be <= 20 minutes per Apple docs

        const token = await new SignJWT({})
            .setProtectedHeader({ alg: ALG, kid: keyId, typ: 'JWT' })
            .setIssuer(issuerId)
            .setAudience(AUDIENCE)
            .setIssuedAt(iat)
            .setExpirationTime(exp)
            .sign(ecPrivateKey);

        this.cachedToken = { token, exp };
        return token;
    }
}