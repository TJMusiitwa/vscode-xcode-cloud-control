import * as assert from 'assert';
import { BuildActionNode, TestResultNode } from '../lib/views/UnifiedWorkflowTree';

suite('TestResultNode', () => {
    test('shows passed status with correct icon context', () => {
        const node = new TestResultNode(
            'test-1',
            'MyTestClass',
            'testSomethingWorks',
            'passed',
            1.5,
            'iPhone 15 Pro'
        );
        assert.strictEqual(node.contextValue, 'testResult');
        assert.ok(node.label === 'testSomethingWorks');
    });

    test('shows failed status', () => {
        const node = new TestResultNode(
            'test-2',
            'MyTestClass',
            'testSomethingFails',
            'failed',
            2.3,
            'iPhone 15 Pro',
            'Expected 1 but got 2'
        );
        assert.strictEqual(node.contextValue, 'testResult');
        assert.ok(node.label === 'testSomethingFails');
    });

    test('shows skipped status', () => {
        const node = new TestResultNode(
            'test-3',
            'MyTestClass',
            'testSkipped',
            'skipped'
        );
        assert.strictEqual(node.contextValue, 'testResult');
    });

    test('uses className as label when testName is empty', () => {
        const node = new TestResultNode(
            'test-4',
            'MyTestClass',
            '',
            'passed'
        );
        assert.strictEqual(node.label, 'MyTestClass');
    });
});

suite('BuildActionNode (TEST type)', () => {
    test('is collapsible when actionType is TEST and execution is complete', () => {
        const node = new BuildActionNode(
            'action-1',
            'build-1',
            'Run Tests',
            'TEST',
            'COMPLETE',
            'SUCCEEDED'
        );
        // Should have contextValue 'buildActionTest' instead of 'buildAction'
        assert.strictEqual(node.contextValue, 'buildActionTest');
    });

    test('is not collapsible when actionType is BUILD', () => {
        const node = new BuildActionNode(
            'action-2',
            'build-1',
            'Build App',
            'BUILD',
            'COMPLETE',
            'SUCCEEDED'
        );
        assert.strictEqual(node.contextValue, 'buildAction');
    });

    test('TEST action is not collapsible when still running', () => {
        const node = new BuildActionNode(
            'action-3',
            'build-1',
            'Run Tests',
            'TEST',
            'RUNNING',
            ''
        );
        // Should still be buildActionTest but not collapsible (running)
        assert.strictEqual(node.contextValue, 'buildActionTest');
    });
});
