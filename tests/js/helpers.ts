import { vi } from 'vitest';
import type { WorkerLike } from '../../assets/captioner';
import type { AiAltConfig, WorkerRequest, WorkerResponse } from '../../assets/types';

/** In-memory stand-in for the captioning Web Worker. */
export class FakeWorker implements WorkerLike {
    readonly sent: WorkerRequest[] = [];
    terminated = false;
    private messageListeners: ((event: MessageEvent<WorkerResponse>) => void)[] = [];
    private errorListeners: ((event: ErrorEvent) => void)[] = [];

    postMessage(message: WorkerRequest): void {
        this.sent.push(message);
    }

    addEventListener(type: 'message' | 'error', listener: never): void {
        if (type === 'message') {
            this.messageListeners.push(listener);
        } else {
            this.errorListeners.push(listener);
        }
    }

    terminate(): void {
        this.terminated = true;
    }

    emit(message: WorkerResponse): void {
        this.messageListeners.forEach(listener => listener({ data: message } as MessageEvent<WorkerResponse>));
    }

    fail(message: string): void {
        this.errorListeners.forEach(listener => listener({ message } as ErrorEvent));
    }
}

export function config(overrides: Partial<AiAltConfig> = {}): AiAltConfig {
    return {
        enabled: true,
        autoOnUpload: true,
        prewarmModel: true,
        model: 'onnx-community/Florence-2-base-ft',
        task: '<CAPTION>',
        modelHost: 'https://huggingface.co',
        thumbnail: '768×768×max',
        maxLength: 125,
        fallbackWithoutTranslator: 'empty',
        contentType: 'pages',
        defaultLocale: 'cs',
        fieldMeta: {
            image: { type: 'image', localized: false },
            gallery: { type: 'imagelist', localized: true },
        },
        assetBase: '/extensions/ai-alt',
        assetVersion: '1',
        uiLocale: 'en',
        ...overrides,
    };
}

/** Markup as rendered by Bolt's Image.vue (only the parts we touch). */
export function imageFieldHtml(prefix: string, filename = '', alt = ''): string {
    return `
        <div class="editor__image">
            <div class="editor__image--preview"><a class="editor__image--preview-image" style=""></a></div>
            <input type="hidden" name="${prefix}[media]" value="">
            <input type="text" class="form-control" name="${prefix}[filename]" value="${filename}">
            <div class="input-group"><div class="col-sm-10">
                <input type="text" class="form-control" name="${prefix}[alt]" value="${alt}">
            </div></div>
        </div>`;
}

export async function flush(times = 5): Promise<void> {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

export const noop = vi.fn();
