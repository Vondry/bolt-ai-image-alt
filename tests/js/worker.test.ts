import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from '../../assets/types';

const transformers = vi.hoisted(() => {
    const env = {
        allowLocalModels: true,
        remoteHost: 'https://huggingface.co/',
        remotePathTemplate: '{model}/resolve/{revision}/',
        backends: { onnx: { wasm: {} as { wasmPaths?: unknown } } },
    };
    const processor = Object.assign(
        vi.fn(async () => ({ input_ids: [1], pixel_values: [2] })),
        {
            tokenizer: { batch_decode: vi.fn(() => ['</s><s>a yellow excavator</s>']) },
            post_process_generation: vi.fn((text: string, task: string) => ({ [task]: text.replace(/<\/?s>/g, '') })),
        },
    );
    const model = { generate: vi.fn(async () => [[0, 1]]) };

    return {
        env,
        processor,
        model,
        fromPretrained: vi.fn(async (..._args: unknown[]) => model),
        processorFromPretrained: vi.fn(async (..._args: unknown[]) => processor),
        image: { width: 640, height: 480 },
    };
});

vi.mock('@huggingface/transformers', () => ({
    env: transformers.env,
    Florence2ForConditionalGeneration: { from_pretrained: transformers.fromPretrained },
    AutoProcessor: { from_pretrained: transformers.processorFromPretrained },
    RawImage: { fromBlob: vi.fn(async () => transformers.image) },
}));

// Copy of bolt/core assets/static/images/404-image.png (identical in 6.1 and 6.2).
const PLACEHOLDER_PATH = resolve(process.cwd(), 'tests/js/fixtures/bolt-404-image.png');

function setGpu(requestAdapter: () => Promise<unknown>): void {
    Object.defineProperty(navigator, 'gpu', { value: { requestAdapter }, configurable: true });
}

const posted: WorkerResponse[] = [];
let worker: typeof import('../../assets/worker');

function send(data: unknown): void {
    self.dispatchEvent(new MessageEvent('message', { data }));
}

async function waitFor(predicate: () => boolean): Promise<void> {
    await vi.waitFor(() => expect(predicate()).toBe(true));
}

beforeAll(async () => {
    vi.spyOn(self, 'postMessage').mockImplementation(((message: WorkerResponse) => posted.push(message)) as typeof self.postMessage);
    worker = await import('../../assets/worker');
});

beforeEach(() => {
    posted.length = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(new Blob(['img']), { status: 200 })),
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
});

describe('worker helpers', () => {
    it('detects WebGPU and shader-f16 support', async () => {
        const wasm = { device: 'wasm', fp16: false };
        expect(await worker.detectDevice()).toEqual(wasm);

        setGpu(async () => ({ features: new Set(['shader-f16']) }));
        expect(await worker.detectDevice()).toEqual({ device: 'webgpu', fp16: true });

        setGpu(async () => ({ features: new Set<string>() }));
        expect(await worker.detectDevice()).toEqual({ device: 'webgpu', fp16: false });

        setGpu(async () => ({}));
        expect(await worker.detectDevice()).toEqual({ device: 'webgpu', fp16: false });

        setGpu(async () => null);
        expect(await worker.detectDevice()).toEqual(wasm);

        setGpu(async () => Promise.reject(new Error('x')));
        expect(await worker.detectDevice()).toEqual(wasm);
    });

    it('only asks for fp16 weights when the GPU supports them', () => {
        expect(worker.dtypeFor({ device: 'webgpu', fp16: true })).toEqual({
            embed_tokens: 'fp16',
            vision_encoder: 'fp16',
            encoder_model: 'q4',
            decoder_model_merged: 'q4',
        });
        expect(worker.dtypeFor({ device: 'webgpu', fp16: false })).toEqual({
            embed_tokens: 'fp32',
            vision_encoder: 'fp32',
            encoder_model: 'q4',
            decoder_model_merged: 'q4',
        });
        expect(worker.dtypeFor({ device: 'wasm', fp16: false })).toBe('q8');
    });

    it("recognises Bolt's 404 placeholder image", async () => {
        const file = readFileSync(PLACEHOLDER_PATH);
        const placeholder = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        expect(placeholder.byteLength).toBe(worker.BOLT_PLACEHOLDER.size);
        expect(await worker.isBoltPlaceholder(placeholder)).toBe(true);

        // Same size, different bytes.
        expect(await worker.isBoltPlaceholder(new ArrayBuffer(worker.BOLT_PLACEHOLDER.size))).toBe(false);
        expect(await worker.isBoltPlaceholder(new TextEncoder().encode('a real photo').buffer)).toBe(false);
    });

    it('falls back to the size check without crypto.subtle (insecure context)', async () => {
        vi.stubGlobal('crypto', {});
        expect(await worker.isBoltPlaceholder(new ArrayBuffer(worker.BOLT_PLACEHOLDER.size))).toBe(true);
    });

    it('picks the ONNX Runtime build', () => {
        const chrome = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
        const safari18 = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';
        const safari26 = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

        expect(worker.ortFlavour(chrome, 'wasm')).toBe('.asyncify');
        expect(worker.ortFlavour(safari18, 'wasm')).toBe('');
        expect(worker.ortFlavour(safari18, 'webgpu')).toBe('.asyncify');
        expect(worker.ortFlavour(safari26, 'wasm')).toBe('.asyncify');
    });

    it('configures self-hosted runtime and model paths', () => {
        worker.configureEnvironment('https://huggingface.co', 'https://site.test/extensions/ai-alt/ort', 'webgpu');
        expect(transformers.env.allowLocalModels).toBe(false);
        expect(transformers.env.remoteHost).toBe('https://huggingface.co/');
        expect(transformers.env.remotePathTemplate).toBe('{model}/resolve/{revision}/');
        expect(transformers.env.backends.onnx.wasm.wasmPaths).toEqual({
            mjs: 'https://site.test/extensions/ai-alt/ort/ort-wasm-simd-threaded.asyncify.mjs',
            wasm: 'https://site.test/extensions/ai-alt/ort/ort-wasm-simd-threaded.asyncify.wasm',
        });

        worker.configureEnvironment('https://site.test/models/', '/ort', 'wasm');
        expect(transformers.env.remoteHost).toBe('https://site.test/models/');
        expect(transformers.env.remotePathTemplate).toBe('{model}/');

        // Switching back restores the Hub layout (env is global).
        worker.configureEnvironment('https://hf-mirror.com', '/ort', 'wasm');
        expect(transformers.env.remotePathTemplate).toBe('{model}/resolve/{revision}/');
    });

    it('tells the Hub layout from plain self-hosted files', () => {
        const base = 'https://site.test/bolt/edit/1';
        expect(worker.usesHubLayout('https://huggingface.co', base)).toBe(true);
        expect(worker.usesHubLayout('https://huggingface.co/', base)).toBe(true);
        expect(worker.usesHubLayout('https://hf-mirror.com', base)).toBe(true);
        expect(worker.usesHubLayout('/ai-alt-models', base)).toBe(false);
        expect(worker.usesHubLayout('https://cdn.example.com/models/', base)).toBe(false);
        expect(worker.usesHubLayout('https://nothuggingface.co/models', base)).toBe(false);
    });
});

describe('worker messages', () => {
    it('reports an error for captions before init', async () => {
        send({ type: 'caption', id: 1, url: '/thumbs/a.jpg', task: '<CAPTION>' });
        await waitFor(() => posted.length > 0);
        expect(posted[0]).toMatchObject({ type: 'error', id: 1, message: 'Model not initialised' });
    });

    it('loads the model once, reports progress and captions images', async () => {
        transformers.fromPretrained.mockImplementationOnce(async (_model: unknown, options: unknown) => {
            const callback = (options as { progress_callback: (info: object) => void }).progress_callback;
            callback({ status: 'initiate', file: 'a.onnx' });
            callback({ status: 'progress', file: 'a.onnx', loaded: 10, total: 100 });
            callback({ status: 'progress', file: 'b.onnx', loaded: 50, total: 100 });
            callback({ status: 'progress', file: 'c.onnx' });
            return transformers.model;
        });

        send({
            type: 'init',
            model: 'onnx-community/Florence-2-base-ft',
            modelHost: 'https://huggingface.co',
            ortBase: '/ort',
        });
        await waitFor(() => posted.some(m => m.type === 'ready'));

        expect(posted.filter(m => m.type === 'progress').at(-2)).toEqual({ type: 'progress', loaded: 60, total: 200 });
        expect(posted.find(m => m.type === 'ready')).toEqual({ type: 'ready', device: 'wasm' });
        expect(transformers.fromPretrained).toHaveBeenCalledWith(
            'onnx-community/Florence-2-base-ft',
            expect.objectContaining({ dtype: 'q8', device: 'wasm' }),
        );

        send({ type: 'init', model: 'x', modelHost: 'https://huggingface.co', ortBase: '/ort' });
        await waitFor(() => posted.filter(m => m.type === 'ready').length === 2);
        expect(transformers.fromPretrained).toHaveBeenCalledTimes(1);

        posted.length = 0;
        send({ type: 'caption', id: 7, url: '/thumbs/768×768×max/a.jpg', task: '<CAPTION>' });
        await waitFor(() => posted.length > 0);

        expect(posted[0]).toMatchObject({ type: 'result', id: 7, text: 'a yellow excavator' });
        expect(fetch).toHaveBeenCalledWith('/thumbs/768×768×max/a.jpg', { credentials: 'same-origin' });
        expect(transformers.processor).toHaveBeenCalledWith(transformers.image, '<CAPTION>');
        expect(transformers.processor.post_process_generation).toHaveBeenCalledWith(
            '</s><s>a yellow excavator</s>',
            '<CAPTION>',
            [480, 640],
        );
        expect(transformers.model.generate).toHaveBeenLastCalledWith(expect.objectContaining({ max_new_tokens: 100 }));

        posted.length = 0;
        send({ type: 'caption', id: 13, url: '/thumbs/768×768×max/a.jpg', task: '<MORE_DETAILED_CAPTION>' });
        await waitFor(() => posted.length > 0);

        expect(transformers.processor).toHaveBeenLastCalledWith(transformers.image, '<MORE_DETAILED_CAPTION>');
        expect(transformers.model.generate).toHaveBeenLastCalledWith(expect.objectContaining({ max_new_tokens: 300 }));
    });

    it('rejects failed downloads and tiny images with codes', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 404 })),
        );
        send({ type: 'caption', id: 8, url: '/thumbs/missing.jpg', task: '<CAPTION>' });
        await waitFor(() => posted.length > 0);
        expect(posted[0]).toMatchObject({ type: 'error', id: 8, code: 'not-found', message: 'HTTP 404' });

        posted.length = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 500 })),
        );
        send({ type: 'caption', id: 10, url: '/thumbs/broken.jpg', task: '<CAPTION>' });
        await waitFor(() => posted.length > 0);
        expect(posted[0]).toMatchObject({ type: 'error', id: 10, code: 'fetch-failed', message: 'HTTP 500' });

        posted.length = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Blob(['img']))),
        );
        transformers.image = { width: 16, height: 16 };
        send({ type: 'caption', id: 9, url: '/thumbs/tiny.png', task: '<CAPTION>' });
        await waitFor(() => posted.length > 0);
        expect(posted[0]).toMatchObject({ type: 'error', id: 9, code: 'too-small' });
        transformers.image = { width: 640, height: 480 };
    });

    it("refuses to caption Bolt's placeholder for a missing file", async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(readFileSync(PLACEHOLDER_PATH), { status: 200 })),
        );
        send({ type: 'caption', id: 12, url: '/thumbs/768×768×max/deleted.jpg', task: '<CAPTION>' });
        await waitFor(() => posted.length > 0);

        expect(posted[0]).toMatchObject({ type: 'error', id: 12, code: 'not-found' });
    });

    it('returns an empty caption for non-text results', async () => {
        transformers.processor.post_process_generation.mockReturnValueOnce({ '<CAPTION>': { labels: [] } } as never);
        send({ type: 'caption', id: 10, url: '/thumbs/a.jpg', task: '<CAPTION>' });
        await waitFor(() => posted.length > 0);
        expect(posted[0]).toMatchObject({ type: 'result', id: 10, text: '' });
    });

    it('reports model errors as model-failed', async () => {
        transformers.model.generate.mockRejectedValueOnce(new Error('OOM'));
        send({ type: 'caption', id: 11, url: '/thumbs/a.jpg', task: '<CAPTION>' });
        await waitFor(() => posted.length > 0);
        expect(posted[0]).toMatchObject({ type: 'error', id: 11, code: 'model-failed', message: 'OOM' });
    });
});
