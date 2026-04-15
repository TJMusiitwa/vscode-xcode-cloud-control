import * as assert from 'assert';
import * as vscode from 'vscode';
import { formatDuration, formatDurationMs, formatStatus, getStatusIcon } from '../lib/shared/formatting';

suite('Formatting Tests', () => {
    test('formatDuration handles edge cases', () => {
        assert.strictEqual(formatDuration(0), '0s');
        assert.strictEqual(formatDuration(59), '59s');
        assert.strictEqual(formatDuration(60), '1m');
        assert.strictEqual(formatDuration(90), '1m 30s');
        assert.strictEqual(formatDuration(3599), '59m 59s');
        assert.strictEqual(formatDuration(3600), '1h');
        assert.strictEqual(formatDuration(3660), '1h 1m');
        assert.strictEqual(formatDuration(7200), '2h');
    });

    test('formatDurationMs delegates to formatDuration correctly', () => {
        assert.strictEqual(formatDurationMs(1500), '2s'); // 1.5 rounded to 2
        assert.strictEqual(formatDurationMs(60000), '1m');
    });

    test('formatStatus maps combinations correctly', () => {
        assert.strictEqual(formatStatus('PENDING', ''), 'Pending');
        assert.strictEqual(formatStatus('RUNNING', ''), 'Running');
        assert.strictEqual(formatStatus('COMPLETE', 'SUCCEEDED'), 'Succeeded');
        assert.strictEqual(formatStatus('COMPLETE', 'FAILED'), 'Failed');
        assert.strictEqual(formatStatus('COMPLETE', 'CANCELED'), 'Canceled');
        assert.strictEqual(formatStatus('COMPLETE', 'SKIPPED'), 'Skipped');
        assert.strictEqual(formatStatus('UNKNOWN', 'UNKNOWN'), 'UNKNOWN');
    });

    test('getStatusIcon returns correct ThemeIcon', () => {
        const iconPending = getStatusIcon('PENDING', '');
        assert.strictEqual((iconPending as vscode.ThemeIcon).id, 'clock');

        const iconRunning = getStatusIcon('RUNNING', '');
        assert.strictEqual((iconRunning as vscode.ThemeIcon).id, 'sync~spin');

        const iconPass = getStatusIcon('COMPLETE', 'SUCCEEDED');
        assert.strictEqual((iconPass as vscode.ThemeIcon).id, 'check');

        const iconFail = getStatusIcon('COMPLETE', 'FAILED');
        assert.strictEqual((iconFail as vscode.ThemeIcon).id, 'error');

        const iconCanceled = getStatusIcon('COMPLETE', 'CANCELED');
        assert.strictEqual((iconCanceled as vscode.ThemeIcon).id, 'stop');

        const iconSkipped = getStatusIcon('COMPLETE', 'SKIPPED');
        assert.strictEqual((iconSkipped as vscode.ThemeIcon).id, 'debug-step-over');
    });
});
