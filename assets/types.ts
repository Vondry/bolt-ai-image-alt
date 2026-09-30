export type FallbackMode = 'empty' | 'english';

export interface FieldMeta {
    type: string;
    localized: boolean;
}

export interface BatchContentType {
    slug: string;
    name: string;
}

export interface BatchConfig {
    missingUrl: string;
    saveUrl: string;
    csrfToken: string;
    contentTypes: BatchContentType[];
}

/** JSON rendered by the PHP side into `#ai-alt-config`. */
export interface AiAltConfig {
    enabled: boolean;
    autoOnUpload: boolean;
    prewarmModel: boolean;
    model: string;
    task: string;
    modelHost: string;
    thumbnail: string;
    maxLength: number;
    fallbackWithoutTranslator: FallbackMode;
    contentType?: string;
    defaultLocale: string | null;
    fieldMeta: Record<string, FieldMeta>;
    assetBase: string;
    /** Bolt's base path, `''` or e.g. `/cms`. */
    basePath?: string;
    /** Base URL of Bolt's thumbnail route; `/thumbs` unless Bolt runs in a subdirectory. */
    thumbsBase?: string;
    assetVersion?: string;
    uiLocale: string;
    batch?: BatchConfig;
}

export type Device = 'webgpu' | 'wasm';

/** Main thread → worker. */
export type WorkerRequest =
    | {
          type: 'init';
          model: string;
          modelHost: string;
          ortBase: string;
          task: string;
          /** Skip WebGPU: set when a previous worker failed on it. */
          forceWasm?: boolean;
      }
    | { type: 'caption'; id: number; url: string };

/** Worker → main thread. */
export type WorkerResponse =
    | { type: 'progress'; loaded: number; total: number }
    | { type: 'ready'; device: Device }
    | { type: 'result'; id: number; text: string; ms: number }
    | { type: 'error'; id: number | null; message: string; code?: CaptionErrorCode };

/**
 * - `too-small`, `not-found`, `fetch-failed`: a problem with this one image; the worker stays usable.
 * - `model-failed`: loading or inference failed; the worker must be replaced.
 * - `webgpu-failed`: the model could not be loaded on WebGPU; retry in a fresh worker on WASM.
 */
export type CaptionErrorCode = 'too-small' | 'not-found' | 'fetch-failed' | 'model-failed' | 'webgpu-failed';
