import * as assert from 'assert';
import { filterLogArtifacts } from '../lib/views/BuildLogsPanel';

suite('filterLogArtifacts', () => {
    test('keeps log file types and extensions', () => {
        const artifacts = [
            { id: '1', attributes: { fileType: 'LOG', fileName: 'build.log' } },
            { id: '2', attributes: { fileType: 'ARCHIVE', fileName: 'archive.xcresult' } },
            { id: '3', attributes: { fileType: 'TEXT', fileName: 'notes.txt' } }
        ];

        const filtered = filterLogArtifacts(artifacts);
        assert.deepStrictEqual(filtered.map(a => a.id), ['1', '3']);
    });
});
