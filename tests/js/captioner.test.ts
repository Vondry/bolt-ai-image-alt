import { describe, expect, it, vi } from 'vitest';
import {
    CaptionError,
    Captioner,
    createModuleWorker,
    DEFAULT_CAPTION_TIMEOUT_MS,
    describeCaptionError,
    workerUrl,
} from '../../assets/captioner';
import { createTranslator } from '../../assets/i18n';
import { FakeWorker, flush } from './helpers';

function setup(onProgress = vi.fn()) {
    const workers: FakeWorker[] = [];
    const captioner = new Captioner({ model: 'm', modelHost: 'https://hf', task: '<CAPTION>', ortBase: '/ort', onProgress }, () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
    });

    return { captioner, workers, onProgress };
}

describe('Captioner', () => {
    it('initialises the worker once and reports the device', async () => {
        const { captioner, workers } = setup();

        const ready = captioner.init();
        expect(captioner.init()).toBe(ready);
        expect(workers).toHaveLength(1);
        expect(workers[0]!.sent[0]).toEqual({
            type: 'init',
            model: 'm',
            modelHost: 'https://hf',
            ortBase: '/ort',
            forceWasm: false,
        });
        expect(captioner.isReady).toBe(false);

        workers[0]!.emit({ type: 'ready', device: 'webgpu' });
        await expect(ready).resolves.toBe('webgpu');
        expect(captioner.isReady).toBe(true);
        expect(captioner.device).toBe('webgpu');
    });

    it('forwards download progress', () => {
        const { captioner, workers, onProgress } = setup();
        void captioner.init();

        workers[0]!.emit({ type: 'progress', loaded: 5, total: 10 });
        expect(onProgress).toHaveBeenCalledWith(5, 10);
    });

    it('matches results and errors to requests', async () => {
        const { captioner, workers } = setup();
        void captioner.init();
        workers[0]!.emit({ type: 'ready', device: 'wasm' });

        const first = captioner.caption('/thumbs/a.jpg');
        const second = captioner.caption('/thumbs/b.jpg', '<DETAILED_CAPTION>');
        await flush();

        expect(workers[0]!.sent.slice(1)).toEqual([
            { type: 'caption', id: 1, url: '/thumbs/a.jpg', task: '<CAPTION>' },
            { type: 'caption', id: 2, url: '/thumbs/b.jpg', task: '<DETAILED_CAPTION>' },
        ]);

        workers[0]!.emit({ type: 'error', id: 2, message: 'Image too small', code: 'too-small' });
        workers[0]!.emit({ type: 'result', id: 1, text: 'a dog', ms: 800 });
        workers[0]!.emit({ type: 'result', id: 99, text: 'unknown', ms: 1 });

        await expect(first).resolves.toEqual({ text: 'a dog', ms: 800 });
        await expect(second).rejects.toMatchObject({ name: 'CaptionError', code: 'too-small' });
    });

    it('defaults error codes to model-failed', async () => {
        const { captioner, workers } = setup();
        void captioner.init();
        workers[0]!.emit({ type: 'ready', device: 'wasm' });
        const job = captioner.caption('/x');
        await flush();
        workers[0]!.emit({ type: 'error', id: 1, message: 'boom' });

        await expect(job).rejects.toMatchObject({ code: 'model-failed', message: 'boom' });
    });

    it('rejects everything when the model fails to load and allows a retry', async () => {
        const { captioner, workers } = setup();
        const ready = captioner.init();
        const job = captioner.caption('/x');

        workers[0]!.emit({ type: 'error', id: null, message: 'no WebGPU', code: 'model-failed' });

        await expect(ready).rejects.toBeInstanceOf(CaptionError);
        await expect(job).rejects.toThrow('no WebGPU');
        expect(workers[0]!.terminated).toBe(true);

        const retry = captioner.init();
        expect(workers).toHaveLength(2);
        workers[1]!.emit({ type: 'ready', device: 'wasm' });
        await expect(retry).resolves.toBe('wasm');
    });

    it('fails pending jobs when the worker crashes', async () => {
        const { captioner, workers } = setup();
        void captioner.init();
        workers[0]!.emit({ type: 'ready', device: 'wasm' });
        const job = captioner.caption('/x');
        await flush();

        workers[0]!.fail('');
        await expect(job).rejects.toThrow('Worker failed');

        // A crash after the model was ready is fatal too: start over with a fresh worker.
        expect(workers[0]!.terminated).toBe(true);
        expect(captioner.isReady).toBe(false);
        const next = captioner.caption('/y');
        expect(workers).toHaveLength(2);
        workers[1]!.emit({ type: 'ready', device: 'wasm' });
        await flush();
        workers[1]!.emit({ type: 'result', id: 2, text: 'a cat', ms: 5 });
        await expect(next).resolves.toEqual({ text: 'a cat', ms: 5 });
    });

    it('times out a caption that never answers, so the queue cannot hang', async () => {
        vi.useFakeTimers();
        const { captioner, workers } = setup();
        void captioner.init();
        workers[0]!.emit({ type: 'ready', device: 'webgpu' });
        const job = captioner.caption('/x');
        const assertion = expect(job).rejects.toMatchObject({ code: 'model-failed', message: 'Captioning timed out' });
        await vi.advanceTimersByTimeAsync(DEFAULT_CAPTION_TIMEOUT_MS);

        await assertion;
        expect(workers[0]!.terminated).toBe(true);
        expect(captioner.device).toBeNull();

        // Late answers from the replaced worker are ignored.
        workers[0]!.emit({ type: 'ready', device: 'webgpu' });
        expect(captioner.isReady).toBe(false);
        vi.useRealTimers();
    });

    it('does not time out answered captions', async () => {
        vi.useFakeTimers();
        const workers: FakeWorker[] = [];
        const captioner = new Captioner({ model: 'm', modelHost: 'h', task: 't', ortBase: '/ort', timeoutMs: 1000 }, () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        });
        void captioner.init();
        workers[0]!.emit({ type: 'ready', device: 'wasm' });
        const job = captioner.caption('/x');
        await vi.advanceTimersByTimeAsync(10);
        workers[0]!.emit({ type: 'result', id: 1, text: 'ok', ms: 10 });
        await expect(job).resolves.toEqual({ text: 'ok', ms: 10 });

        await vi.advanceTimersByTimeAsync(5000);
        expect(workers[0]!.terminated).toBe(false);
        vi.useRealTimers();
    });

    it('rejects pending jobs on dispose', async () => {
        const { captioner, workers } = setup();
        void captioner.init();
        workers[0]!.emit({ type: 'ready', device: 'wasm' });
        const job = captioner.caption('/x');
        await flush();

        captioner.dispose();
        await expect(job).rejects.toThrow('disposed');
        expect(workers[0]!.terminated).toBe(true);
    });
});

describe('Captioner recovery', () => {
    it('restarts on WASM in a fresh worker when WebGPU fails to load, while init() keeps waiting', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { captioner, workers } = setup();
        const ready = captioner.init();

        workers[0]!.emit({ type: 'error', id: null, message: 'unsupported op', code: 'webgpu-failed' });

        expect(workers[0]!.terminated).toBe(true);
        expect(workers).toHaveLength(2);
        expect(workers[1]!.sent[0]).toMatchObject({ type: 'init', forceWasm: true });

        workers[1]!.emit({ type: 'ready', device: 'wasm' });
        await expect(ready).resolves.toBe('wasm');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('gives up when WASM fails too', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { captioner, workers } = setup();
        const ready = captioner.init();

        workers[0]!.emit({ type: 'error', id: null, message: 'unsupported op', code: 'webgpu-failed' });
        workers[1]!.emit({ type: 'error', id: null, message: 'still broken', code: 'webgpu-failed' });

        await expect(ready).rejects.toThrow('still broken');
        expect(workers).toHaveLength(2);
        vi.restoreAllMocks();
    });

    it('replaces the worker after a failed inference and moves off WebGPU', async () => {
        const { captioner, workers } = setup();
        void captioner.init();
        workers[0]!.emit({ type: 'ready', device: 'webgpu' });
        const job = captioner.caption('/a');
        await flush();

        workers[0]!.emit({ type: 'error', id: 1, message: 'GPU device lost', code: 'model-failed' });
        await expect(job).rejects.toThrow('GPU device lost');
        expect(workers[0]!.terminated).toBe(true);

        const next = captioner.caption('/b');
        expect(workers).toHaveLength(2);
        expect(workers[1]!.sent[0]).toMatchObject({ type: 'init', forceWasm: true });
        workers[1]!.emit({ type: 'ready', device: 'wasm' });
        await flush();
        workers[1]!.emit({ type: 'result', id: 2, text: 'ok', ms: 1 });
        await expect(next).resolves.toEqual({ text: 'ok', ms: 1 });
    });

    it('keeps the worker for problems with a single image', async () => {
        const { captioner, workers } = setup();
        void captioner.init();
        workers[0]!.emit({ type: 'ready', device: 'webgpu' });

        for (const code of ['fetch-failed', 'too-small', 'not-found'] as const) {
            const job = captioner.caption('/x');
            await flush();
            const id = (workers[0]!.sent.at(-1) as { id: number }).id;
            workers[0]!.emit({ type: 'error', id, message: code, code });
            await expect(job).rejects.toMatchObject({ code });
        }

        expect(workers).toHaveLength(1);
        expect(workers[0]!.terminated).toBe(false);
        expect(captioner.device).toBe('webgpu');
    });
});

describe('worker helpers', () => {
    it('builds the worker URL with cache busting', () => {
        expect(workerUrl('/extensions/ai-alt', '123')).toBe('/extensions/ai-alt/ai-alt.worker.js?v=123');
        expect(workerUrl('/extensions/ai-alt')).toBe('/extensions/ai-alt/ai-alt.worker.js');
    });

    it('creates a module worker', () => {
        const constructor = vi.fn();
        vi.stubGlobal(
            'Worker',
            class {
                constructor(url: string, options: WorkerOptions) {
                    constructor(url, options);
                }
            },
        );

        createModuleWorker('/w.js');
        expect(constructor).toHaveBeenCalledWith('/w.js', { type: 'module', name: 'ai-alt' });
        vi.unstubAllGlobals();
    });
});

describe('describeCaptionError', () => {
    const t = createTranslator('en');

    it('turns image problems into warnings and everything else into errors', () => {
        expect(describeCaptionError(new CaptionError('x', 'too-small'), t)).toEqual({ text: 'Image too small', warn: true });
        expect(describeCaptionError(new CaptionError('x', 'not-found'), t)).toEqual({ text: 'Image file not found', warn: true });
        expect(describeCaptionError(new CaptionError('OOM', 'model-failed'), t)).toEqual({ text: 'Error: OOM', warn: false });
        expect(describeCaptionError('plain', t)).toEqual({ text: 'Error: plain', warn: false });
    });
});
