import type { Translate } from './i18n';
import type { CaptionErrorCode, Device, WorkerRequest, WorkerResponse } from './types';

export class CaptionError extends Error {
    constructor(
        message: string,
        readonly code: CaptionErrorCode,
    ) {
        super(message);
        this.name = 'CaptionError';
    }
}

/**
 * User-facing text for a failed caption. `warn` = a problem with this image
 * (not the tool), shown as a warning instead of an error.
 */
export function describeCaptionError(error: unknown, t: Translate): { text: string; warn: boolean } {
    const code = error instanceof CaptionError ? error.code : null;

    if (code === 'too-small') {
        return { text: t('tooSmall'), warn: true };
    }
    if (code === 'not-found') {
        return { text: t('notFound'), warn: true };
    }

    return { text: t('error', { message: (error as Error)?.message ?? String(error) }), warn: false };
}

export interface CaptionResult {
    text: string;
    ms: number;
}

export interface CaptionerOptions {
    model: string;
    modelHost: string;
    task: string;
    /** URL of the directory with the self-hosted ONNX Runtime files. */
    ortBase: string;
    onProgress?: (loaded: number, total: number) => void;
    /**
     * Longest wait for one caption. A worker that hangs (GPU device lost, out of
     * memory) would otherwise block the sequential queue forever.
     */
    timeoutMs?: number;
}

export const DEFAULT_CAPTION_TIMEOUT_MS = 180_000;

interface PendingCaption {
    resolve: (result: CaptionResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/** Minimal Worker surface, so tests can pass a fake. */
export interface WorkerLike {
    postMessage(message: WorkerRequest): void;
    addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
    addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
    terminate(): void;
}

/**
 * Main-thread client of `worker.ts`. One model instance, requests are
 * answered in order.
 */
export class Captioner {
    private readyPromise: Promise<Device> | null = null;
    private resolveReady: ((device: Device) => void) | null = null;
    private rejectReady: ((error: Error) => void) | null = null;
    private nextId = 1;
    private readonly pending = new Map<number, PendingCaption>();
    private worker: WorkerLike | null = null;
    /** Set once WebGPU failed; every later worker runs on WASM. */
    private forceWasm = false;
    device: Device | null = null;

    constructor(
        private readonly options: CaptionerOptions,
        private readonly createWorker: () => WorkerLike,
    ) {}

    get isReady(): boolean {
        return this.device !== null;
    }

    /** Starts the worker and loads the model. Safe to call repeatedly. */
    init(): Promise<Device> {
        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.readyPromise = new Promise<Device>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        this.startWorker();

        return this.readyPromise;
    }

    private startWorker(): void {
        const worker = this.createWorker();
        this.worker = worker;
        // Ignore anything a replaced (terminated) worker still delivers.
        worker.addEventListener('message', event => worker === this.worker && this.onMessage(event.data));
        worker.addEventListener(
            'error',
            event => worker === this.worker && this.reset(new CaptionError(event.message || 'Worker failed', 'model-failed')),
        );
        worker.postMessage({
            type: 'init',
            model: this.options.model,
            modelHost: this.options.modelHost,
            ortBase: this.options.ortBase,
            task: this.options.task,
            forceWasm: this.forceWasm,
        });
    }

    async caption(url: string): Promise<CaptionResult> {
        await this.init();

        const id = this.nextId++;
        return new Promise<CaptionResult>((resolve, reject) => {
            const timer = setTimeout(
                () => this.reset(new CaptionError('Captioning timed out', 'model-failed')),
                this.options.timeoutMs ?? DEFAULT_CAPTION_TIMEOUT_MS,
            );
            this.pending.set(id, { resolve, reject, timer });
            this.worker?.postMessage({ type: 'caption', id, url });
        });
    }

    dispose(): void {
        this.reset(new CaptionError('Captioner disposed', 'model-failed'));
    }

    private onMessage(message: WorkerResponse): void {
        switch (message.type) {
            case 'progress':
                this.options.onProgress?.(message.loaded, message.total);
                break;
            case 'ready':
                this.device = message.device;
                this.resolveReady?.(message.device);
                break;
            case 'result':
                this.settle(message.id)?.resolve({ text: message.text, ms: message.ms });
                break;
            case 'error': {
                const error = new CaptionError(message.message, message.code ?? 'model-failed');

                if (message.id === null && error.code === 'webgpu-failed' && !this.forceWasm) {
                    this.restartOnWasm();
                    break;
                }

                if (message.id === null) {
                    this.reset(error);
                    break;
                }

                this.settle(message.id)?.reject(error);

                // A failed inference poisons the worker (Transformers.js keeps
                // its inference chain rejected): replace it. On WebGPU that is
                // usually the GPU (device lost, out of memory), so use WASM next.
                if (error.code === 'model-failed') {
                    this.forceWasm ||= this.device === 'webgpu';
                    this.reset(error);
                }
                break;
            }
        }
    }

    /**
     * The model could not be loaded on WebGPU. Transformers.js can't retry in
     * the same worker, so start a fresh one on WASM; whoever waits for init()
     * keeps waiting and gets the WASM worker.
     */
    private restartOnWasm(): void {
        console.warn('[ai-alt] WebGPU failed, restarting the model on WASM');
        this.forceWasm = true;
        this.worker?.terminate();
        this.worker = null;
        this.startWorker();
    }

    private settle(id: number): PendingCaption | undefined {
        const pending = this.pending.get(id);
        if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(id);
        }

        return pending;
    }

    /**
     * Fatal: the model failed to load, the worker crashed or hung. Terminate
     * it and fail everything waiting; the next caption() starts a fresh worker.
     */
    private reset(error: Error): void {
        if (this.device === null) {
            this.rejectReady?.(error);
        }

        this.worker?.terminate();
        this.worker = null;
        this.readyPromise = null;
        this.resolveReady = null;
        this.rejectReady = null;
        this.device = null;

        for (const id of [...this.pending.keys()]) {
            this.settle(id)?.reject(error);
        }
    }
}

export function workerUrl(assetBase: string, version?: string): string {
    const query = version ? `?v=${encodeURIComponent(version)}` : '';

    return `${assetBase}/ai-alt.worker.js${query}`;
}

export function createModuleWorker(url: string): WorkerLike {
    return new Worker(url, { type: 'module', name: 'ai-alt' });
}
