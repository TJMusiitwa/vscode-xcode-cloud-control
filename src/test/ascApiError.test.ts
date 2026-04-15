import * as assert from 'assert';
import { AscApiError } from '../lib/appstoreconnect/client';

suite('AscApiError Tests', () => {
    test('formats 401 error correctly', () => {
        const err = new AscApiError(401, '/ciWorkflows', 'Unauthorized');
        assert.strictEqual(err.message, 'Authentication failed. Re-run "Configure App Store Connect Credentials".');
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.endpoint, '/ciWorkflows');
        assert.strictEqual(err.name, 'AscApiError');
    });

    test('formats 403 error correctly', () => {
        const err = new AscApiError(403, '/ciWorkflows', 'Forbidden');
        assert.strictEqual(err.message, 'Insufficient permissions for this operation.');
    });

    test('formats 404 error correctly', () => {
        const err = new AscApiError(404, '/ciWorkflows/123', 'Not Found');
        assert.strictEqual(err.message, 'Resource not found. It may have been deleted.');
    });

    test('formats 429 error correctly', () => {
        const err = new AscApiError(429, '/ciWorkflows', 'Too Many Requests');
        assert.strictEqual(err.message, 'API rate limited. Slow down requests.');
    });

    test('formats 500+ errors correctly', () => {
        const err1 = new AscApiError(500, '/ciWorkflows', 'Internal Server Error');
        assert.strictEqual(err1.message, 'Apple server error. Try again in a moment.');

        const err2 = new AscApiError(503, '/ciWorkflows', 'Service Unavailable');
        assert.strictEqual(err2.message, 'Apple server error. Try again in a moment.');
    });

    test('formats other errors with raw message', () => {
        const err = new AscApiError(400, '/ciWorkflows', 'Bad Request: Invalid field');
        assert.strictEqual(err.message, 'API error 400: Bad Request: Invalid field');
    });
});
