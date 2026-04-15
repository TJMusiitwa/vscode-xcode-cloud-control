import * as assert from 'assert';
import { formatDuration, formatTimestamp, computeStatistics, flattenTimeline, findNodeById } from '../lib/timeline/utils';

suite('Timeline Utils Tests', () => {
    test('formatDuration formats ms to seconds correctly', () => {
        assert.strictEqual(formatDuration(15000), '15s');
        assert.strictEqual(formatDuration(65000), '1m 5s');
        assert.strictEqual(formatDuration(3600000), '1h');
        assert.strictEqual(formatDuration(3665000), '1h 1m');
    });

    test('formatTimestamp handles valid and invalid ISO strings', () => {
        const valid = formatTimestamp('2025-01-01T14:30:00Z');
        assert.ok(valid.length > 0);
        assert.strictEqual(formatTimestamp('invalid'), '');
        assert.strictEqual(formatTimestamp(''), '');
    });

    test('computeStatistics calculates totals correctly', () => {
        const timeline = [
            { type: 'action', status: 'SUCCEEDED', children: [
                { type: 'task', status: 'SUCCEEDED' },
                { type: 'task', status: 'FAILED' }
            ]},
            { type: 'action', status: 'FAILED', children: [
                { type: 'task', status: 'SKIPPED' },
                { type: 'task', status: 'UNKNOWN' }
            ]}
        ];
        const stats = computeStatistics(timeline);
        assert.deepStrictEqual(stats, { total: 4, passed: 1, failed: 1, skipped: 1 });
    });

    test('flattenTimeline depth-first ordering', () => {
        const timeline = [
            { id: '1', children: [{ id: '1.1' }, { id: '1.2', children: [{ id: '1.2.1' }] }] },
            { id: '2' }
        ];
        const flat = flattenTimeline(timeline);
        assert.deepStrictEqual(flat.map(n => n.id), ['1', '1.1', '1.2', '1.2.1', '2']);
    });

    test('findNodeById hit and miss cases', () => {
        const timeline = [
            { id: '1', children: [{ id: '1.1' }, { id: '1.2', children: [{ id: '1.2.1' }] }] },
            { id: '2' }
        ];
        assert.strictEqual(findNodeById(timeline, '1.2.1')?.id, '1.2.1');
        assert.strictEqual(findNodeById(timeline, '2')?.id, '2');
        assert.strictEqual(findNodeById(timeline, 'nonexistent'), undefined);
    });
});
