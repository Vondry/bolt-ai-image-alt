/**
 * Strictly sequential job queue (one inference at a time), de-duplicated by key.
 */
export class JobQueue<T> {
    private readonly jobs: { key: string; payload: T }[] = [];
    private readonly keys = new Set<string>();
    private running: string | null = null;
    private idleWaiters: (() => void)[] = [];

    constructor(private readonly worker: (payload: T, key: string) => Promise<void>) {}

    /** @returns false when a job with the same key is already queued or running */
    enqueue(key: string, payload: T): boolean {
        if (this.keys.has(key)) {
            return false;
        }

        this.keys.add(key);
        this.jobs.push({ key, payload });
        void this.drain();

        return true;
    }

    has(key: string): boolean {
        return this.keys.has(key);
    }

    /** Drop queued (not running) jobs matching the predicate. */
    remove(predicate: (key: string, payload: T) => boolean): number {
        let removed = 0;
        for (let i = this.jobs.length - 1; i >= 0; i--) {
            const job = this.jobs[i]!;
            if (predicate(job.key, job.payload)) {
                this.jobs.splice(i, 1);
                this.keys.delete(job.key);
                removed++;
            }
        }

        return removed;
    }

    /** Queued + running jobs. */
    get size(): number {
        return this.jobs.length + (this.running !== null ? 1 : 0);
    }

    onIdle(): Promise<void> {
        if (this.size === 0) {
            return Promise.resolve();
        }

        return new Promise(resolve => this.idleWaiters.push(resolve));
    }

    private async drain(): Promise<void> {
        if (this.running !== null) {
            return;
        }

        let job = this.jobs.shift();
        while (job) {
            this.running = job.key;
            try {
                await this.worker(job.payload, job.key);
            } catch (error) {
                console.error('[ai-alt] job failed', error);
            } finally {
                this.keys.delete(job.key);
                this.running = null;
            }
            job = this.jobs.shift();
        }

        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        waiters.forEach(resolve => resolve());
    }
}
