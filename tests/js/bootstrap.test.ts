import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServices, readConfig } from '../../assets/bootstrap';
import { boot } from '../../assets/main';
import { EditorController } from '../../assets/editor';
import { showNotice } from '../../assets/ui';
import { config, FakeWorker } from './helpers';

function renderConfig(json: string): void {
    document.body.innerHTML = `<script type="application/json" id="ai-alt-config">${json}</script>`;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('readConfig', () => {
    it('parses the embedded JSON', () => {
        renderConfig(JSON.stringify(config()));
        expect(readConfig()?.model).toBe('onnx-community/Florence-2-base-ft');
    });

    it('returns null when missing or invalid', () => {
        expect(readConfig()).toBeNull();

        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderConfig('{nope');
        expect(readConfig()).toBeNull();
        expect(error).toHaveBeenCalled();
        error.mockRestore();

        renderConfig('null');
        expect(readConfig()).toBeNull();
    });
});

describe('createServices', () => {
    it('points the worker and ONNX Runtime at the self-hosted assets', async () => {
        const workers: { url: string; worker: FakeWorker }[] = [];
        vi.stubGlobal(
            'Worker',
            class extends FakeWorker {
                constructor(url: string) {
                    super();
                    workers.push({ url, worker: this });
                }
            },
        );

        const services = createServices(config({ modelHost: '/models' }));
        void services.captioner.init();

        expect(workers[0]!.url).toBe('/extensions/ai-alt/ai-alt.worker.js?v=1');
        expect(workers[0]!.worker.sent[0]).toMatchObject({
            type: 'init',
            modelHost: 'http://localhost:3000/models',
            ortBase: 'http://localhost:3000/extensions/ai-alt/ort',
        });
        expect(services.t('generate')).toBe('Generate ALT');
        expect(services.translator.supported).toBe(false);
    });

    it('keeps absolute model hosts', () => {
        const workers: FakeWorker[] = [];
        vi.stubGlobal(
            'Worker',
            class extends FakeWorker {
                constructor() {
                    super();
                    workers.push(this);
                }
            },
        );

        void createServices(config()).captioner.init();
        expect(workers[0]!.sent[0]).toMatchObject({ modelHost: 'https://huggingface.co' });
    });
});

describe('boot (edit page)', () => {
    it('starts the editor controller when enabled', () => {
        renderConfig(JSON.stringify(config()));
        const controller = boot();
        expect(controller).toBeInstanceOf(EditorController);
        controller?.stop();
    });

    it('does nothing when disabled or unconfigured', () => {
        expect(boot()).toBeNull();
        renderConfig(JSON.stringify(config({ enabled: false })));
        expect(boot()).toBeNull();
    });

    it('forwards model download progress to the chips', () => {
        const workers: FakeWorker[] = [];
        vi.stubGlobal(
            'Worker',
            class extends FakeWorker {
                constructor() {
                    super();
                    workers.push(this);
                }
            },
        );
        renderConfig(JSON.stringify(config({ prewarmModel: false })));
        document.body.insertAdjacentHTML(
            'beforeend',
            '<form><input name="fields[image][filename]" value="a.jpg"><input name="fields[image][alt]" value=""></form>',
        );
        const controller = boot()!;
        const report = vi.spyOn(controller, 'reportProgress');

        document.querySelector<HTMLButtonElement>('.ai-alt-button')!.click();
        workers[0]!.emit({ type: 'progress', loaded: 1, total: 4 });

        expect(report).toHaveBeenCalledWith(1, 4);
        controller.stop();
    });
});

describe('showNotice', () => {
    it('removes itself after the timeout', () => {
        vi.useFakeTimers();
        const notice = showNotice(document, 'Hello', 100);
        expect(notice.isConnected).toBe(true);
        vi.advanceTimersByTime(100);
        expect(notice.isConnected).toBe(false);
        vi.useRealTimers();
    });
});
