import * as assert from 'assert';
import { IssueNode } from '../lib/views/UnifiedWorkflowTree';

suite('IssueNode', () => {
    test('shows ERROR type with correct icon context', () => {
        const node = new IssueNode(
            'issue-1',
            'ERROR',
            'Linker error: undefined symbol',
            'https://api.appstoreconnect.apple.com/v1/ciIssues/issue-1'
        );
        assert.strictEqual(node.contextValue, 'issue');
        assert.strictEqual(node.label, 'Linker error: undefined symbol');
    });

    test('shows WARNING type', () => {
        const node = new IssueNode(
            'issue-2',
            'WARNING',
            'Deprecated API usage',
            undefined,
            'Sources/MyFile.swift',
            42
        );
        assert.strictEqual(node.contextValue, 'issue');
    });

    test('shows ANALYZER_WARNING type', () => {
        const node = new IssueNode(
            'issue-3',
            'ANALYZER_WARNING',
            'Potential memory leak'
        );
        assert.strictEqual(node.contextValue, 'issue');
    });

    test('shows TEST_FAILURE type', () => {
        const node = new IssueNode(
            'issue-4',
            'TEST_FAILURE',
            'XCTAssertEqual failed'
        );
        assert.strictEqual(node.contextValue, 'issue');
    });

    test('handles missing message gracefully', () => {
        const node = new IssueNode('issue-5', 'ERROR', '');
        assert.strictEqual(node.label, 'Unknown Issue');
    });

    test('handles missing selfLink gracefully', () => {
        const node = new IssueNode(
            'issue-6',
            'WARNING',
            'Some warning message'
        );
        assert.strictEqual(node.contextValue, 'issue');
    });

    test('formats issue type correctly', () => {
        const node = new IssueNode(
            'issue-7',
            'ANALYZER_WARNING',
            'Test message'
        );
        // Description should be formatted issue type
        assert.strictEqual(node.description, 'Analyzer Warning');
    });
});
