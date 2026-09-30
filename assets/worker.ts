/// <reference lib="webworker" />
/**
 * Module Web Worker: Florence-2 captioning via Transformers.js.
 * Runs off the main thread so the editor stays responsive.
 */
import { Florence2ForConditionalGeneration, AutoProcessor, RawImage, env } from '@huggingface/transformers';
import type { CaptionErrorCode, Device, WorkerRequest, WorkerResponse } from './types';
import { isTooSmall, trimTrailing } from './postprocess';

type Processor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> & {
    construct_prompts(text: string): string[];
    post_process_generation(text: string, task: string, size: [number, number]): Record<string, unknown>;
    tokenizer: { batch_decode(ids: unknown, options: { skip_special_tokens: boolean }): string[] };
};

type ModelOptions = NonNullable<Parameters<typeof Florence2ForConditionalGeneration.from_pretrained>[1]>;

interface Loaded {
    model: Awaited<ReturnType<typeof Florence2ForConditionalGeneration.from_pretrained>>;
    processor: Processor;
    device: Device;
    task: string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
let loading: Promise<Loaded> | null = null;

function post(message: WorkerResponse): void {
    scope.postMessage(message);
}

export interface DeviceInfo {
    device: Device;
    /** WebGPU adapter supports `shader-f16`; without it fp16 weights fail to load. */
    fp16: boolean;
}

const WASM: DeviceInfo = { device: 'wasm', fp16: false };

interface GpuAdapterLike {
    features?: { has(feature: string): boolean };
}

export async function detectDevice(): Promise<DeviceInfo> {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> } }).gpu;
    if (!gpu) {
        return WASM;
    }

    try {
        const adapter = await gpu.requestAdapter();
        return adapter ? { device: 'webgpu', fp16: adapter.features?.has('shader-f16') ?? false } : WASM;
    } catch {
        return WASM;
    }
}

export type DType = string | Record<string, string>;

/**
 * WebGPU with f16: fp16 vision/embeddings + q4 encoder/decoder (fast, small).
 * WebGPU without f16 (older Intel/Windows GPUs, some Linux/Android): same but fp32.
 * WASM: q8 everywhere.
 */
// Transformers.js takes one dtype for all model parts or one per part.
// eslint-disable-next-line sonarjs/function-return-type
export function dtypeFor(info: DeviceInfo): DType {
    if (info.device === 'wasm') {
        return 'q8';
    }

    const float = info.fp16 ? 'fp16' : 'fp32';

    return { embed_tokens: float, vision_encoder: float, encoder_model: 'q4', decoder_model_merged: 'q4' };
}

/** Bolt's `/thumbs` route answers missing files with this image and HTTP 200. */
export const BOLT_PLACEHOLDER = {
    size: 29276,
    sha256: '412c6b2ffe1dc4a537d11792b4cf2c0332588315f75084e89cbe18d5e260f292',
};

export async function isBoltPlaceholder(bytes: ArrayBuffer): Promise<boolean> {
    if (bytes.byteLength !== BOLT_PLACEHOLDER.size) {
        return false;
    }

    // crypto.subtle only exists in secure contexts; the size alone is a good enough signal otherwise.
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        return true;
    }

    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');

    return hex === BOLT_PLACEHOLDER.sha256;
}

/** Safari < 26 without WebGPU can't run the asyncify build of ONNX Runtime. */
export function ortFlavour(userAgent: string, device: Device): string {
    const version = userAgent.includes('Safari') ? /Version\/(\d+)/.exec(userAgent) : null;
    const oldSafari = version !== null && !/Chrome|Chromium|Edg\//.test(userAgent) && Number(version[1]) < 26;

    return oldSafari && device === 'wasm' ? '' : '.asyncify';
}

const HUB_PATH_TEMPLATE = '{model}/resolve/{revision}/';

/**
 * A bare origin (`https://huggingface.co`, or a mirror such as
 * `https://hf-mirror.com`) serves the Hub layout `{model}/resolve/{revision}/…`.
 * A URL with a path (`/ai-alt-models`, `https://cdn.example.com/models`) is a
 * plain copy of the model files: `{model}/…`.
 */
export function usesHubLayout(modelHost: string, base: string): boolean {
    return trimTrailing(new URL(modelHost, base).pathname, /\//) === '';
}

export function configureEnvironment(modelHost: string, ortBase: string, device: Device): void {
    const flavour = ortFlavour(navigator.userAgent, device);

    env.allowLocalModels = false;
    env.remoteHost = trimTrailing(modelHost, /\//) + '/';
    env.remotePathTemplate = usesHubLayout(modelHost, self.location.href) ? HUB_PATH_TEMPLATE : '{model}/';

    const wasm = env.backends.onnx.wasm;
    if (wasm) {
        // Self-hosted ONNX Runtime, no CDN at runtime.
        wasm.wasmPaths = {
            mjs: `${ortBase}/ort-wasm-simd-threaded${flavour}.mjs`,
            wasm: `${ortBase}/ort-wasm-simd-threaded${flavour}.wasm`,
        };
    }
}

type InitRequest = Extract<WorkerRequest, { type: 'init' }>;

/**
 * No in-process fallback to WASM: Transformers.js queues every session
 * creation and run on module-level promise chains (`webInitChain`,
 * `webInferenceChain`) that stay rejected after one failure. A retry in this
 * worker would fail with the same error, so the main thread starts a fresh
 * worker with `forceWasm` instead.
 */
async function load(request: InitRequest): Promise<Loaded> {
    const info = request.forceWasm ? WASM : await detectDevice();

    try {
        return await loadOn(request, info);
    } catch (error) {
        throw info.device === 'webgpu' ? withCode(error, 'webgpu-failed') : error;
    }
}

function withCode(error: unknown, code: CaptionErrorCode): Error & { code: CaptionErrorCode } {
    return Object.assign(error instanceof Error ? error : new Error(String(error)), { code });
}

async function loadOn(request: InitRequest, info: DeviceInfo): Promise<Loaded> {
    const { device } = info;
    configureEnvironment(request.modelHost, request.ortBase, device);

    const progress = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }): void => {
        if (info.status !== 'progress' || !info.file) {
            return;
        }
        progress.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const file of progress.values()) {
            loaded += file.loaded;
            total += file.total;
        }
        post({ type: 'progress', loaded, total });
    };

    const dtype = dtypeFor(info) as ModelOptions['dtype'];

    const [model, processor] = await Promise.all([
        Florence2ForConditionalGeneration.from_pretrained(request.model, {
            dtype,
            device,
            progress_callback,
        }),
        AutoProcessor.from_pretrained(request.model, { progress_callback }),
    ]);

    return { model, processor: processor as Processor, device, task: request.task };
}

async function readImage(url: string): Promise<RawImage> {
    let response: Response;
    try {
        response = await fetch(url, { credentials: 'same-origin' });
    } catch (error) {
        throw withCode(error, 'fetch-failed');
    }

    if (!response.ok) {
        throw withCode(new Error(`HTTP ${response.status}`), response.status === 404 ? 'not-found' : 'fetch-failed');
    }

    const bytes = await response.arrayBuffer();
    if (await isBoltPlaceholder(bytes)) {
        throw withCode(new Error('Image file not found'), 'not-found');
    }

    let image: RawImage;
    try {
        image = await RawImage.fromBlob(new Blob([bytes], { type: response.headers.get('Content-Type') ?? '' }));
    } catch (error) {
        // Undecodable file: this image's problem, the model is fine.
        throw withCode(error, 'fetch-failed');
    }

    if (isTooSmall(image.width, image.height)) {
        throw withCode(new Error('Image too small'), 'too-small');
    }

    return image;
}

async function caption(loaded: Loaded, url: string): Promise<string> {
    const image = await readImage(url);
    const { model, processor, task } = loaded;
    const inputs = await (processor as unknown as (image: RawImage, text: string) => Promise<Record<string, unknown>>)(image, task);
    const generated = await model.generate({ ...inputs, max_new_tokens: 100 });
    const text = processor.tokenizer.batch_decode(generated, { skip_special_tokens: false })[0] ?? '';
    const result = processor.post_process_generation(text, task, [image.height, image.width])[task];

    return typeof result === 'string' ? result : '';
}

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => void handle(event.data));

/** Never rejects: every failure is posted back as an `error` message. */
async function handle(request: WorkerRequest): Promise<void> {
    if (request.type === 'init') {
        loading ??= load(request);
        try {
            const loaded = await loading;
            post({ type: 'ready', device: loaded.device });
        } catch (error) {
            loading = null;
            const code = (error as { code?: CaptionErrorCode })?.code ?? 'model-failed';
            post({ type: 'error', id: null, message: String((error as Error)?.message ?? error), code });
        }
        return;
    }

    if (request.type === 'caption') {
        const started = performance.now();
        try {
            if (!loading) {
                throw new Error('Model not initialised');
            }
            const text = await caption(await loading, request.url);
            post({ type: 'result', id: request.id, text, ms: Math.round(performance.now() - started) });
        } catch (error) {
            const err = error as Error & { code?: CaptionErrorCode };
            post({ type: 'error', id: request.id, message: String(err?.message ?? error), code: err?.code ?? 'model-failed' });
        }
    }
}
