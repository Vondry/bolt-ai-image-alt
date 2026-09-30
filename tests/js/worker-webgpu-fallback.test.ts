import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from '../../assets/types';

const fromPretrained = vi.hoisted(() => vi.fn());
const requestAdapter = vi.hoisted(() => vi.fn(async () => ({ features: new Set<string>() })));

vi.mock('@huggingface/transformers', () => ({
    env: { backends: { onnx: { wasm: {} } } },
    Florence2ForConditionalGeneration: { from_pretrained: fromPretrained },
    AutoProcessor: { from_pretrained: vi.fn(async () => ({})) },
    RawImage: { fromBlob: vi.fn() },
}));

const posted: WorkerResponse[] = [];
const init = { type: 'init', model: 'm', modelHost: 'https://huggingface.co', ortBase: '/ort' };

beforeAll(async () => {
    vi.spyOn(self, 'postMessage').mockImplementation(((message: WorkerResponse) => posted.push(message)) as typeof self.postMessage);
    Object.defineProperty(navigator, 'gpu', { value: { requestAdapter }, configurable: true });
    await import('../../assets/worker');
});

describe('worker on a WebGPU adapter without shader-f16', () => {
    it('requests fp32 weights and reports webgpu-failed instead of retrying in-process', async () => {
        // Transformers.js keeps its session chain rejected after a failure, so an
        // in-process retry could never succeed; the main thread starts a new worker.
        fromPretrained.mockRejectedValueOnce(new Error('WebGPU: unsupported op'));

        self.dispatchEvent(new MessageEvent('message', { data: init }));
        await vi.waitFor(() => expect(posted).toHaveLength(1));

        expect(fromPretrained).toHaveBeenCalledTimes(1);
        expect(fromPretrained.mock.calls[0]![1]).toMatchObject({
            device: 'webgpu',
            dtype: { embed_tokens: 'fp32', vision_encoder: 'fp32', encoder_model: 'q4', decoder_model_merged: 'q4' },
        });
        expect(posted[0]).toEqual({ type: 'error', id: null, message: 'WebGPU: unsupported op', code: 'webgpu-failed' });
    });

    it('skips WebGPU detection when told to use WASM', async () => {
        requestAdapter.mockClear();
        fromPretrained.mockResolvedValueOnce({});

        self.dispatchEvent(new MessageEvent('message', { data: { ...init, forceWasm: true } }));
        await vi.waitFor(() => expect(posted).toHaveLength(2));

        expect(requestAdapter).not.toHaveBeenCalled();
        expect(fromPretrained.mock.calls.at(-1)![1]).toMatchObject({ device: 'wasm', dtype: 'q8' });
        expect(posted[1]).toEqual({ type: 'ready', device: 'wasm' });
    });
});
