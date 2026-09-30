import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptionError } from '../../assets/captioner';
import { EditorController, GENERATED_MARKER, isRelevantMutation, type EditorDeps } from '../../assets/editor';
import type { AltOutcome } from '../../assets/generate';
import { createTranslator } from '../../assets/i18n';
import type { AiAltConfig } from '../../assets/types';
import { config, deferred, flush, imageFieldHtml } from './helpers';

const t = createTranslator('en');

function ok(alt: string): AltOutcome {
    return { status: 'ok', alt, english: alt, ms: 10 };
}

interface Setup {
    controller: EditorController;
    deps: EditorDeps & {
        provider: { generate: ReturnType<typeof vi.fn>; localize: ReturnType<typeof vi.fn> };
        warmUp: ReturnType<typeof vi.fn>;
        primeTranslator: ReturnType<typeof vi.fn>;
    };
    input(prefix: string, part: 'alt' | 'filename'): HTMLInputElement;
    chip(prefix: string): HTMLElement;
    button(prefix: string): HTMLButtonElement;
}

function setup(
    html: string,
    overrides: Partial<AiAltConfig> = {},
    generate?: (url: string, ctx: { language: string }) => Promise<AltOutcome>,
): Setup {
    document.body.innerHTML = `<form id="editcontent"><input type="hidden" name="_edit_locale" value="en">${html}</form>`;

    const deps = {
        provider: {
            generate: vi.fn(generate ?? (async () => ok('A yellow excavator'))),
            localize: vi.fn(async (english: string) => ok(`[cs] ${english}`)),
        },
        warmUp: vi.fn(async () => 'wasm'),
        primeTranslator: vi.fn(),
        isModelReady: () => true,
        t,
        pollInterval: 50,
        scheduleIdle: (callback: () => void) => callback(),
    };

    const controller = new EditorController(document.body, config(overrides), deps);
    const input = (prefix: string, part: 'alt' | 'filename') =>
        document.querySelector<HTMLInputElement>(`input[name="${prefix}[${part}]"]`)!;
    const controls = (prefix: string) => input(prefix, 'alt').nextElementSibling as HTMLElement;

    return {
        controller,
        deps,
        input,
        chip: prefix => controls(prefix).querySelector<HTMLElement>('.ai-alt-chip')!,
        button: prefix => controls(prefix).querySelector<HTMLButtonElement>('.ai-alt-button')!,
    };
}

/** What Vue does after an upload: set the filename property. */
function upload(s: Setup, prefix: string, filename: string): void {
    s.input(prefix, 'filename').value = filename;
    s.controller.checkChanges();
}

async function settle(s: Setup): Promise<void> {
    await flush();
    await (s.controller as unknown as { queue: { onIdle(): Promise<void> } }).queue.onIdle();
    await flush();
}

let active: EditorController | null = null;

beforeEach(() => {
    vi.useRealTimers();
});

afterEach(() => {
    active?.stop();
    active = null;
    document.body.innerHTML = '';
});

describe('EditorController', () => {
    it('injects a button and a status chip next to every alt input', () => {
        const s = setup(imageFieldHtml('fields[image]', 'a.jpg') + imageFieldHtml('fields[gallery][0]'));
        s.controller.scan();

        expect(document.querySelectorAll('.ai-alt-controls')).toHaveLength(2);
        expect(s.button('fields[image]').textContent).toContain('Generate ALT');
        expect(s.chip('fields[image]').hidden).toBe(true);
        expect(s.controller.fields).toHaveLength(2);

        s.controller.scan();
        expect(document.querySelectorAll('.ai-alt-controls')).toHaveLength(2);
    });

    it('does not auto-generate for images already present on load', async () => {
        const s = setup(imageFieldHtml('fields[image]', 'existing.jpg'));
        s.controller.scan();
        await settle(s);

        expect(s.deps.provider.generate).not.toHaveBeenCalled();
    });

    it('fills an empty alt after an upload and marks it as AI-generated', async () => {
        const s = setup(imageFieldHtml('fields[image]'));
        s.controller.scan();
        const inputEvents = vi.fn();
        s.input('fields[image]', 'alt').addEventListener('input', inputEvents);

        upload(s, 'fields[image]', '2024/05/bagr 1.jpg');
        expect(s.chip('fields[image]').textContent).toBe('Generating…');
        expect(s.button('fields[image]').disabled).toBe(true);
        await settle(s);

        expect(s.deps.provider.generate).toHaveBeenCalledWith('/thumbs/768×768×max/2024/05/bagr%201.jpg', { language: 'cs' });
        const alt = s.input('fields[image]', 'alt');
        expect(alt.value).toBe('A yellow excavator');
        expect(alt.dataset.aiAlt).toBe(GENERATED_MARKER);
        expect(inputEvents).toHaveBeenCalledTimes(1);
        expect(s.chip('fields[image]').textContent).toBe('AI – please review');
        expect(s.chip('fields[image]').dataset.state).toBe('ok');
        expect(s.button('fields[image]').disabled).toBe(false);
    });

    it('uses the edit locale for localized fields', async () => {
        const s = setup(imageFieldHtml('fields[gallery][0]'));
        s.controller.scan();
        upload(s, 'fields[gallery][0]', 'g.jpg');
        await settle(s);

        expect(s.deps.provider.generate).toHaveBeenCalledWith(expect.any(String), { language: 'en' });
    });

    it('never overwrites an alt the editor already has', async () => {
        const s = setup(imageFieldHtml('fields[image]', '', 'Typed'));
        s.controller.scan();
        upload(s, 'fields[image]', 'new.jpg');
        await settle(s);

        expect(s.deps.provider.generate).not.toHaveBeenCalled();
        expect(s.input('fields[image]', 'alt').value).toBe('Typed');
    });

    it('skips the result when the editor typed during generation', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup(imageFieldHtml('fields[image]'), {}, () => gate.promise);
        s.controller.scan();
        upload(s, 'fields[image]', 'new.jpg');
        await flush();

        const alt = s.input('fields[image]', 'alt');
        alt.value = 'Editor was faster';
        alt.dispatchEvent(new Event('input', { bubbles: true }));
        gate.resolve(ok('AI text'));
        await settle(s);

        expect(alt.value).toBe('Editor was faster');
        expect(alt.dataset.aiAlt).toBeUndefined();
        expect(s.chip('fields[image]').hidden).toBe(true);
    });

    it('skips a job whose image was replaced while queued', async () => {
        const gate = deferred<AltOutcome>();
        let calls = 0;
        const s = setup(imageFieldHtml('fields[image]') + imageFieldHtml('fields[gallery][0]'), {}, () =>
            calls++ === 0 ? gate.promise : Promise.resolve(ok('x')),
        );
        s.controller.scan();

        upload(s, 'fields[image]', 'a.jpg');
        upload(s, 'fields[gallery][0]', 'b.jpg');
        expect(s.chip('fields[gallery][0]').textContent).toBe('Queued');

        // Removed before its turn (Vue clears the filename).
        s.input('fields[gallery][0]', 'filename').value = '';
        gate.resolve(ok('first'));
        await settle(s);

        expect(s.deps.provider.generate).toHaveBeenCalledTimes(1);
    });

    it('discards the result when the image changed during generation', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup(imageFieldHtml('fields[image]'), {}, () => gate.promise);
        s.controller.scan();
        upload(s, 'fields[image]', 'a.jpg');
        await flush();

        s.input('fields[image]', 'filename').value = 'other.jpg';
        gate.resolve(ok('for a.jpg'));
        await flush();

        expect(s.input('fields[image]', 'alt').value).toBe('');
    });

    it('does nothing automatically when auto mode is off', async () => {
        const s = setup(imageFieldHtml('fields[image]'), { autoOnUpload: false });
        s.controller.start();
        active = s.controller;
        upload(s, 'fields[image]', 'a.jpg');
        await settle(s);

        expect(s.deps.provider.generate).not.toHaveBeenCalled();
        expect(s.deps.warmUp).not.toHaveBeenCalled();
    });

    it('generates on button click, primes the translator and replaces existing text', async () => {
        const s = setup(imageFieldHtml('fields[image]', 'a.jpg', 'Old text'));
        s.controller.scan();

        s.button('fields[image]').click();
        expect(s.deps.primeTranslator).toHaveBeenCalledWith(['cs']);
        await settle(s);

        expect(s.input('fields[image]', 'alt').value).toBe('A yellow excavator');
    });

    it('ignores a click without an image and explains SVGs', async () => {
        const s = setup(imageFieldHtml('fields[image]') + imageFieldHtml('fields[gallery][0]', 'logo.svg'));
        s.controller.scan();

        s.button('fields[image]').click();
        s.button('fields[gallery][0]').click();
        await settle(s);

        expect(s.deps.provider.generate).not.toHaveBeenCalled();
        expect(s.chip('fields[gallery][0]').textContent).toBe('Image format not supported');
    });

    it('silently skips uploaded SVGs in auto mode', async () => {
        const s = setup(imageFieldHtml('fields[image]'));
        s.controller.scan();
        upload(s, 'fields[image]', 'icon.svg');
        await settle(s);

        expect(s.deps.provider.generate).not.toHaveBeenCalled();
        expect(s.chip('fields[image]').hidden).toBe(true);
    });

    it('clears the AI marker when the editor edits the text', async () => {
        const s = setup(imageFieldHtml('fields[image]'));
        s.controller.scan();
        upload(s, 'fields[image]', 'a.jpg');
        await settle(s);

        const alt = s.input('fields[image]', 'alt');
        alt.value = 'Edited';
        alt.dispatchEvent(new Event('input', { bubbles: true }));

        expect(alt.dataset.aiAlt).toBeUndefined();
        expect(s.chip('fields[image]').hidden).toBe(true);
    });

    it.each<[AltOutcome, string, string, string]>([
        [{ status: 'english', alt: 'A dog', english: 'A dog', ms: 1 }, 'A dog', 'EN – please translate', 'warn'],
        [{ status: 'untranslated', english: 'A dog', ms: 1 }, '', 'Translation not available in this browser', 'warn'],
    ])('handles %o', async (outcome, value, chip, state) => {
        const s = setup(imageFieldHtml('fields[image]'), {}, async () => outcome);
        s.controller.scan();
        upload(s, 'fields[image]', 'a.jpg');
        await settle(s);

        expect(s.input('fields[image]', 'alt').value).toBe(value);
        expect(s.chip('fields[image]').textContent).toBe(chip);
        expect(s.chip('fields[image]').dataset.state).toBe(state);
    });

    it('finishes the translation after the first click when a gesture was needed', async () => {
        const s = setup(imageFieldHtml('fields[image]'), {}, async () => ({ status: 'needs-gesture', english: 'A dog', ms: 1 }));
        s.controller.start();
        active = s.controller;
        upload(s, 'fields[image]', 'a.jpg');
        await settle(s);
        expect(s.chip('fields[image]').textContent).toBe('Click anywhere to allow translation');

        document.body.click();
        await flush(10);

        expect(s.deps.primeTranslator).toHaveBeenCalledWith(['cs']);
        expect(s.deps.provider.localize).toHaveBeenCalledWith('A dog', 'cs');
        expect(s.input('fields[image]', 'alt').value).toBe('[cs] A dog');

        // Later clicks do nothing.
        document.body.click();
        expect(s.deps.provider.localize).toHaveBeenCalledTimes(1);
    });

    it('keeps waiting when the language pack is still not ready after a click', async () => {
        const s = setup(imageFieldHtml('fields[image]'), {}, async () => ({ status: 'needs-gesture', english: 'A dog', ms: 1 }));
        s.deps.provider.localize.mockResolvedValueOnce({ status: 'needs-gesture', english: 'A dog', ms: 0 });
        s.controller.start();
        active = s.controller;
        upload(s, 'fields[image]', 'a.jpg');
        await settle(s);

        document.body.click();
        await flush(10);
        expect(s.chip('fields[image]').textContent).toBe('Click anywhere to allow translation');

        document.body.click();
        await flush(10);
        expect(s.input('fields[image]', 'alt').value).toBe('[cs] A dog');
    });

    it('shows translation errors after a click', async () => {
        const s = setup(imageFieldHtml('fields[image]'), {}, async () => ({ status: 'needs-gesture', english: 'A dog', ms: 1 }));
        s.deps.provider.localize.mockRejectedValueOnce(new Error('offline'));
        s.controller.start();
        active = s.controller;
        upload(s, 'fields[image]', 'a.jpg');
        await settle(s);

        document.body.click();
        await flush(10);
        expect(s.chip('fields[image]').textContent).toBe('Error: Error: offline');
    });

    it('reports too small images and errors', async () => {
        const s = setup(imageFieldHtml('fields[image]') + imageFieldHtml('fields[gallery][0]'), {}, async url => {
            if (url.includes('gone')) {
                throw new CaptionError('Image file not found', 'not-found');
            }
            throw url.includes('tiny') ? new CaptionError('small', 'too-small') : new Error('Network down');
        });
        s.controller.scan();
        upload(s, 'fields[image]', 'tiny.png');
        upload(s, 'fields[gallery][0]', 'big.png');
        await settle(s);

        expect(s.chip('fields[image]').textContent).toBe('Image too small');
        expect(s.chip('fields[image]').dataset.state).toBe('warn');
        expect(s.chip('fields[gallery][0]').textContent).toBe('Error: Network down');
        expect(s.chip('fields[gallery][0]').dataset.state).toBe('error');

        s.input('fields[gallery][0]', 'filename').value = '';
        s.controller.checkChanges();
        upload(s, 'fields[gallery][0]', 'gone.png');
        await settle(s);
        expect(s.chip('fields[gallery][0]').textContent).toBe('Image file not found');
        expect(s.chip('fields[gallery][0]').dataset.state).toBe('warn');
    });

    it('shows download progress while the model loads', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup(imageFieldHtml('fields[image]'), {}, () => gate.promise);
        (s.deps as { isModelReady: () => boolean }).isModelReady = () => false;
        s.controller.scan();
        upload(s, 'fields[image]', 'a.jpg');
        await flush();
        expect(s.chip('fields[image]').textContent).toBe('Loading model…');

        s.controller.reportProgress(50, 200);
        expect(s.chip('fields[image]').textContent).toBe('Loading model… 25 %');
        s.controller.reportProgress(0, 0);
        expect(s.chip('fields[image]').textContent).toBe('Loading model… 0 %');

        gate.resolve(ok('x'));
        await settle(s);
    });

    it('warns on save while jobs are pending, without blocking it', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup(imageFieldHtml('fields[image]'), {}, () => gate.promise);
        s.controller.start();
        active = s.controller;
        upload(s, 'fields[image]', 'a.jpg');

        const form = document.getElementById('editcontent') as HTMLFormElement;
        const submitted = new Event('submit', { bubbles: true, cancelable: true });
        form.dispatchEvent(submitted);

        expect(submitted.defaultPrevented).toBe(false);
        expect(s.controller.pendingJobs).toBe(1);
        expect(document.querySelector('.ai-alt-notice')?.textContent).toBe(
            '1 ALT text(s) are still being generated. They will not be saved.',
        );

        gate.resolve(ok('x'));
        await settle(s);
        document.querySelector('.ai-alt-notice')?.remove();
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(document.querySelector('.ai-alt-notice')).toBeNull();
    });

    it('pre-warms the model once image fields exist', async () => {
        const s = setup('');
        s.controller.start();
        active = s.controller;
        expect(s.deps.warmUp).not.toHaveBeenCalled();

        document.getElementById('editcontent')!.insertAdjacentHTML('beforeend', imageFieldHtml('fields[image]'));
        await flush();
        expect(s.deps.warmUp).toHaveBeenCalledTimes(1);

        document.getElementById('editcontent')!.insertAdjacentHTML('beforeend', imageFieldHtml('fields[gallery][0]'));
        await flush();
        expect(s.deps.warmUp).toHaveBeenCalledTimes(1);
    });

    it('logs a failed pre-warm', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const s = setup(imageFieldHtml('fields[image]'));
        s.deps.warmUp.mockRejectedValueOnce(new Error('no model'));
        s.controller.start();
        active = s.controller;
        await flush();

        expect(warn).toHaveBeenCalledWith('[ai-alt] model pre-warm failed', expect.any(Error));
        warn.mockRestore();
    });

    it('uses requestIdleCallback (or a timeout) for the pre-warm by default', async () => {
        vi.useFakeTimers();
        const s = setup(imageFieldHtml('fields[image]'));
        delete (s.deps as { scheduleIdle?: unknown }).scheduleIdle;
        s.controller.start();
        active = s.controller;

        expect(s.deps.warmUp).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1500);
        expect(s.deps.warmUp).toHaveBeenCalledTimes(1);
        vi.useRealTimers();

        const ric = vi.fn((callback: () => void) => callback());
        vi.stubGlobal('requestIdleCallback', ric);
        const second = setup(imageFieldHtml('fields[image]'));
        delete (second.deps as { scheduleIdle?: unknown }).scheduleIdle;
        second.controller.start();
        expect(ric).toHaveBeenCalled();
        expect(second.deps.warmUp).toHaveBeenCalledTimes(1);
        second.controller.stop();
        vi.unstubAllGlobals();
    });

    it('picks up imagelist items added later and uploads detected by polling', async () => {
        vi.useFakeTimers();
        const s = setup(imageFieldHtml('fields[gallery][0]', 'a.jpg', 'A'));
        s.controller.start();
        active = s.controller;

        document.getElementById('editcontent')!.insertAdjacentHTML('beforeend', imageFieldHtml('fields[gallery][1]'));
        await vi.advanceTimersByTimeAsync(0);
        expect(document.querySelectorAll('.ai-alt-controls')).toHaveLength(2);

        // Vue sets the filename property: no DOM mutation, caught by the poll.
        s.input('fields[gallery][1]', 'filename').value = 'b.jpg';
        await vi.advanceTimersByTimeAsync(60);
        vi.useRealTimers();
        await settle(s);

        expect(s.deps.provider.generate).toHaveBeenCalledTimes(1);
        expect(s.input('fields[gallery][1]', 'alt').value).toBe('A yellow excavator');
    });

    it('reacts to preview style changes (Vue re-render after upload)', async () => {
        const s = setup(imageFieldHtml('fields[image]'));
        s.controller.start();
        active = s.controller;

        s.input('fields[image]', 'filename').value = 'a.jpg';
        document.querySelector('.editor__image--preview-image')!.setAttribute('style', "background-image: url('/thumbs/400×300/a.jpg')");
        await flush();
        await settle(s);

        expect(s.deps.provider.generate).toHaveBeenCalledTimes(1);
    });

    it('re-attaches its controls when Vue re-renders around them and forgets removed fields', async () => {
        const s = setup(imageFieldHtml('fields[image]'));
        s.controller.start();
        active = s.controller;

        const controls = document.querySelector('.ai-alt-controls')!;
        controls.remove();
        await flush();
        expect(document.querySelector('.ai-alt-controls')).toBe(controls);

        document.querySelector('.editor__image')!.remove();
        await flush();
        expect(s.controller.fields).toHaveLength(0);
    });

    it('stop() removes listeners and observers', async () => {
        const s = setup(imageFieldHtml('fields[image]'));
        s.controller.start();
        s.controller.stop();

        document.getElementById('editcontent')!.insertAdjacentHTML('beforeend', imageFieldHtml('fields[gallery][0]'));
        await flush();
        expect(document.querySelectorAll('.ai-alt-controls')).toHaveLength(1);
    });

    it('does not rescan the page for its own status updates', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup(imageFieldHtml('fields[image]'), {}, () => gate.promise);
        s.controller.start();
        active = s.controller;
        await flush();
        const scan = vi.spyOn(s.controller, 'scan');

        upload(s, 'fields[image]', 'a.jpg');
        for (let i = 0; i < 20; i++) {
            s.controller.reportProgress(i, 100);
        }
        await flush();
        expect(scan).not.toHaveBeenCalled();

        gate.resolve(ok('x'));
        await settle(s);
        // Writing the alt (value property) and the final chip are ours too.
        expect(scan).not.toHaveBeenCalled();
    });

    it('only repaints progress chips when the percentage changes', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup(imageFieldHtml('fields[image]'), {}, () => gate.promise);
        (s.deps as { isModelReady: () => boolean }).isModelReady = () => false;
        s.controller.scan();
        upload(s, 'fields[image]', 'a.jpg');
        await flush();

        const setChip = vi.spyOn(s.controller.fields[0]!.ui, 'setChip');
        s.controller.reportProgress(100, 1000);
        s.controller.reportProgress(101, 1000);
        s.controller.reportProgress(109, 1000);
        s.controller.reportProgress(110, 1000);

        expect(setChip.mock.calls.map(call => call[1])).toEqual(['Loading model… 10 %', 'Loading model… 11 %']);
        gate.resolve(ok('x'));
        await settle(s);
    });

    it('uses the thumbnail base path (Bolt in a subdirectory)', async () => {
        const s = setup(imageFieldHtml('fields[image]'), { thumbsBase: '/cms/thumbs' });
        s.controller.scan();
        upload(s, 'fields[image]', 'a.jpg');
        await settle(s);

        expect(s.deps.provider.generate).toHaveBeenCalledWith('/cms/thumbs/768×768×max/a.jpg', { language: 'cs' });
    });
});

describe('isRelevantMutation', () => {
    function record(init: Partial<MutationRecord> & { target: Node }): MutationRecord {
        return {
            type: 'childList',
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
            attributeName: null,
            ...init,
        } as MutationRecord;
    }

    it('ignores changes inside our controls and notices', () => {
        document.body.innerHTML =
            '<div class="ai-alt-controls"><span class="ai-alt-chip">x</span></div><div class="ai-alt-notice">n</div><div id="vue"></div>';
        const chip = document.querySelector('.ai-alt-chip')!;
        expect(isRelevantMutation(record({ target: chip }))).toBe(false);
        expect(isRelevantMutation(record({ target: chip.firstChild! }))).toBe(false);
        expect(isRelevantMutation(record({ target: document.querySelector('.ai-alt-notice')! }))).toBe(false);
    });

    it('ignores inserting our own nodes but not their removal', () => {
        document.body.innerHTML = '<div id="vue"></div><div class="ai-alt-controls"></div>';
        const ours = document.querySelector('.ai-alt-controls')!;
        const target = document.getElementById('vue')!;
        expect(isRelevantMutation(record({ target, addedNodes: [ours] as unknown as NodeList }))).toBe(false);
        expect(isRelevantMutation(record({ target, removedNodes: [ours] as unknown as NodeList }))).toBe(true);
        expect(isRelevantMutation(record({ target, addedNodes: [document.createElement('input')] as unknown as NodeList }))).toBe(true);
    });

    it('reacts to preview style changes only', () => {
        document.body.innerHTML = '<a class="editor__image--preview-image"></a>';
        const target = document.querySelector('a')!;
        expect(isRelevantMutation(record({ type: 'attributes', target, attributeName: 'style' }))).toBe(true);
        expect(isRelevantMutation(record({ type: 'attributes', target, attributeName: 'class' }))).toBe(false);
    });
});
