export class TimelineLoader {
    load(rawTimeline: any[]): { success: boolean; data?: any[]; errors: { message: string }[] } {
        if (!Array.isArray(rawTimeline)) {
            return { success: false, errors: [{ message: 'Timeline data must be an array' }] };
        }

        // In a real scenario we'd do parsing/validation here
        // For our purpose we just pass it through
        return { success: true, data: rawTimeline, errors: [] };
    }
}
