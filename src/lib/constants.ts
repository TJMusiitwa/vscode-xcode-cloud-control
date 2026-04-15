export const POLL_INTERVAL_MS_ACTIVE = 15_000;
export const POLL_INTERVAL_MS_IDLE = 30_000;
export const BUILD_DISCOVERY_LIMIT = 10;
export const WORKFLOW_FETCH_LIMIT = 50;
export const RECENT_BUILDS_LIMIT = 5;
export const JWT_EXPIRY_SECONDS = 18 * 60;
export const BASE_URL = 'https://api.appstoreconnect.apple.com/v1';

export const STATUS = {
    COMPLETE: 'COMPLETE',
    RUNNING: 'RUNNING',
    PENDING: 'PENDING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
    CANCELED: 'CANCELED',
    SKIPPED: 'SKIPPED'
} as const;
