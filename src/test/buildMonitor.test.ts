import * as assert from 'assert';
import { AppStoreConnectClient } from '../lib/appstoreconnect/client';
import { BuildMonitor } from '../lib/buildMonitor';

class MockClient extends AppStoreConnectClient {
    constructor() {
        super({} as any);
    }
}

suite('BuildMonitor Tests', () => {
    test('trackBuild adds build to internal map', () => {
        const client = new MockClient();
        const monitor = new BuildMonitor(client);
        monitor.trackBuild('build-1', 'Workflow 1');

        // Use an any cast to bypass private property modifier for testing
        const tracked = (monitor as any).trackedBuilds;
        assert.strictEqual(tracked.size, 1);
        assert.strictEqual(tracked.get('build-1').id, 'build-1');
        assert.strictEqual(tracked.get('build-1').workflowName, 'Workflow 1');
        assert.strictEqual(tracked.get('build-1').status, 'PENDING');
    });

    test('adaptive polling changes interval based on active tracks', () => {
        const client = new MockClient();
        const monitor = new BuildMonitor(client);

        // Initial state should be idle
        assert.strictEqual((monitor as any).getAdaptiveInterval(), 30000); // Default configured interval

        // After adding a build, it should be active
        monitor.trackBuild('build-1', 'Workflow 1');
        assert.strictEqual((monitor as any).getAdaptiveInterval(), 15000); // Active interval

        // After stopping/disposing it should clean up
        monitor.dispose();
        assert.strictEqual((monitor as any).trackedBuilds.size, 0);
    });

    test('discoverActiveBuilds adds running builds to tracked map', async () => {
        const client = new MockClient();
        // Mock listAllRecentBuilds
        client.listAllRecentBuilds = async () => {
            return {
                data: [
                    { id: 'running-1', attributes: { executionProgress: 'RUNNING' } },
                    { id: 'pending-1', attributes: { executionProgress: 'PENDING' } },
                    { id: 'complete-1', attributes: { executionProgress: 'COMPLETE' } },
                ]
            };
        };

        const monitor = new BuildMonitor(client);
        await (monitor as any).discoverActiveBuilds();

        const tracked = (monitor as any).trackedBuilds;
        assert.strictEqual(tracked.size, 2);
        assert.ok(tracked.has('running-1'));
        assert.ok(tracked.has('pending-1'));
        assert.ok(!tracked.has('complete-1'));
    });
});
