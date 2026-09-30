import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from '../../assets/types';

const fromPretrained = vi.hoisted(() => vi.fn());

vi.mock('@huggingface/transformers', () => ({
    env: { backends: { onnx: {} } },
    Florence2ForConditionalGeneration: { from_pretrained: fromPretrained },
    AutoProcessor: { from_pretrained: vi.fn(async () => ({})) },
    RawImage: { fromBlob: vi.fn() },
}));

const posted: WorkerResponse[] = [];

beforeAll(async () => {
    vi.spyOn(self, 'postMessage').mockImplementation(((message: WorkerResponse) => posted.push(message)) as typeof self.postMessage);
    await import('../../assets/worker');
});

describe('worker model loading failure', () => {
    it('reports model-failed and allows a retry', async () => {
        fromPretrained.mockRejectedValueOnce(new Error('Network error while downloading')).mockResolvedValueOnce({});
        const init = { type: 'init', model: 'm', modelHost: 'https://huggingface.co', ortBase: '/ort' };

        self.dispatchEvent(new MessageEvent('message', { data: init }));
        await vi.waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toEqual({ type: 'error', id: null, message: 'Network error while downloading', code: 'model-failed' });

        self.dispatchEvent(new MessageEvent('message', { data: init }));
        await vi.waitFor(() => expect(posted).toHaveLength(2));
        expect(posted[1]).toEqual({ type: 'ready', device: 'wasm' });
        expect(fromPretrained).toHaveBeenCalledTimes(2);
    });
});
