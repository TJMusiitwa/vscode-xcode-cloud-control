import { formatDurationMs } from '../shared/formatting';

export function formatDuration(ms: number): string {
    return formatDurationMs(ms);
}

export function formatTimestamp(isoString: string): string {
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) { return ''; }
        return date.toLocaleTimeString();
    } catch {
        return '';
    }
}

export function computeStatistics(timeline: any[]): { total: number; passed: number; failed: number; skipped: number } {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    const traverse = (nodes: any[]) => {
        for (const node of nodes) {
            if (node.type === 'task') {
                total++;
                if (node.status === 'SUCCEEDED') { passed++; }
                else if (node.status === 'FAILED') { failed++; }
                else if (node.status === 'SKIPPED') { skipped++; }
            }
            if (node.children) {
                traverse(node.children);
            }
        }
    };

    traverse(timeline);
    return { total, passed, failed, skipped };
}

export function flattenTimeline(timeline: any[]): any[] {
    const flat: any[] = [];
    const traverse = (nodes: any[]) => {
        for (const node of nodes) {
            flat.push(node);
            if (node.children) {
                traverse(node.children);
            }
        }
    };
    traverse(timeline);
    return flat;
}

export function findNodeById(timeline: any[], id: string): any | undefined {
    for (const node of timeline) {
        if (node.id === id) { return node; }
        if (node.children) {
            const found = findNodeById(node.children, id);
            if (found) { return found; }
        }
    }
    return undefined;
}
