import * as assert from 'assert';
import { JwtProvider } from '../lib/appstoreconnect/auth';

class MockSecrets {
    private map = new Map<string, string>();
    async get(key: string): Promise<string | undefined> { return this.map.get(key); }
    async store(key: string, value: string): Promise<void> { this.map.set(key, value); }
}

suite('JwtProvider', () => {
    test('throws when credentials missing', async () => {
        const secrets = new MockSecrets();
        const jwt = new JwtProvider(secrets as any);
        await assert.rejects(jwt.getToken());
    });

    test('returns cached token when present and valid', async () => {
        const secrets = new MockSecrets();
        const jwt = new JwtProvider(secrets as any);
        // Inject a cached token that expires in > 60s to hit cache path
        (jwt as any).cachedToken = { token: 'cached.token.value', exp: Math.floor(Date.now() / 1000) + 300 };
        const token = await jwt.getToken();
        assert.strictEqual(token, 'cached.token.value');
    });
});
