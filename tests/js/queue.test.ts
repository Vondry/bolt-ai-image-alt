import { describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../../assets/queue';
import { deferred, flush } from './helpers';

describe('JobQueue', () => {
    it('runs jobs strictly one at a time, in order', async () => {
        const running: string[] = [];
        const gates = new Map<string, ReturnType<typeof deferred<void>>>();
        const queue = new JobQueue<string>(async payload => {
            running.push(payload);
            const gate = deferred<void>();
            gates.set(payload, gate);
            await gate.promise;
        });

        queue.enqueue('a', 'a');
        queue.enqueue('b', 'b');
        await flush();
        expect(running).toEqual(['a']);
        expect(queue.size).toBe(2);

        gates.get('a')!.resolve();
        await flush();
        expect(running).toEqual(['a', 'b']);

        gates.get('b')!.resolve();
        await queue.onIdle();
        expect(queue.size).toBe(0);
    });

    it('de-duplicates by key while queued or running', async () => {
        const gate = deferred<void>();
        const worker = vi.fn((_payload: number) => gate.promise);
        const queue = new JobQueue<number>(worker);

        expect(queue.enqueue('x', 1)).toBe(true);
        expect(queue.enqueue('x', 2)).toBe(false);
        expect(queue.has('x')).toBe(true);

        gate.resolve();
        await queue.onIdle();
        expect(queue.has('x')).toBe(false);
        expect(queue.enqueue('x', 3)).toBe(true);
        await queue.onIdle();
        expect(worker).toHaveBeenCalledTimes(2);
    });

    it('keeps going after a failing job', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const done: number[] = [];
        const queue = new JobQueue<number>(async n => {
            if (n === 1) {
                throw new Error('fail');
            }
            done.push(n);
        });

        queue.enqueue('1', 1);
        queue.enqueue('2', 2);
        await queue.onIdle();

        expect(done).toEqual([2]);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('removes queued jobs', async () => {
        const gate = deferred<void>();
        const worker = vi.fn((_payload: string) => gate.promise);
        const queue = new JobQueue<string>(worker);

        queue.enqueue('a', 'a');
        queue.enqueue('b', 'b');
        queue.enqueue('c', 'c');
        expect(queue.remove(key => key !== 'c')).toBe(1);
        expect(queue.size).toBe(2);

        gate.resolve();
        await queue.onIdle();
        expect(worker.mock.calls.map(call => call[0])).toEqual(['a', 'c']);
    });

    it('onIdle resolves immediately when empty', async () => {
        await expect(new JobQueue(async () => undefined).onIdle()).resolves.toBeUndefined();
    });
});
