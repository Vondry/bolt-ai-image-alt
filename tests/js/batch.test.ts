import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchRunner, bootBatch, type MissingItem } from '../../assets/batch';
import { CaptionError } from '../../assets/captioner';
import type { AltOutcome } from '../../assets/generate';
import { createTranslator } from '../../assets/i18n';
import type { BatchConfig } from '../../assets/types';
import { config, deferred, flush } from './helpers';

const batchConfig: BatchConfig = {
    missingUrl: '/bolt/ai-alt/missing',
    saveUrl: '/bolt/ai-alt/save',
    csrfToken: 'tok',
    contentTypes: [
        { slug: 'pages', name: 'Pages' },
        { slug: 'entries', name: 'Entries' },
    ],
};

function item(n: number, overrides: Partial<MissingItem> = {}): MissingItem {
    return {
        key: `${n}:image:-:cs`,
        contentId: n,
        contentType: 'pages',
        title: `Page ${n}`,
        field: 'image',
        fieldLabel: 'Image',
        index: null,
        locale: 'cs',
        textLocale: 'cs',
        filename: `p${n}.jpg`,
        editUrl: `/bolt/edit/${n}`,
        ...overrides,
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(
    options: {
        generate?: (url: string) => Promise<AltOutcome>;
        save?: (body: Record<string, unknown>) => Response;
        pages?: MissingItem[][];
    } = {},
) {
    document.body.innerHTML = '<div id="ai-alt-batch"></div>';
    const container = document.getElementById('ai-alt-batch')!;
    const pages = options.pages ?? [[item(1), item(2)]];
    const total = pages.flat().length;
    const saved: Record<string, unknown>[] = [];

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            const body = JSON.parse(init.body as string) as Record<string, unknown>;
            saved.push(body);
            return options.save ? options.save(body) : jsonResponse({ status: 'saved' });
        }
        const offset = Number(new URL(url).searchParams.get('offset'));
        return jsonResponse({ items: pages[offset / 2000] ?? [], total });
    });

    const generate = vi.fn(
        options.generate ?? (async (url: string): Promise<AltOutcome> => ({ status: 'ok', alt: `Alt for ${url}`, english: 'x', ms: 2000 })),
    );
    const primeTranslator = vi.fn();
    const localize = vi.fn(async (english: string): Promise<AltOutcome> => ({ status: 'ok', alt: `[cs] ${english}`, english, ms: 0 }));
    const runner = new BatchRunner(container, batchConfig, config(), {
        provider: { generate, localize },
        primeTranslator,
        fetch: fetchMock as unknown as typeof fetch,
        t: createTranslator('en'),
    });

    const row = (n: number) => container.querySelector<HTMLTableRowElement>(`tr[data-key="${n}:image:-:cs"]`)!;

    return { runner, container, fetchMock, generate, localize, primeTranslator, saved, row };
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('BatchRunner', () => {
    it('renders the toolbar and loads missing items', async () => {
        const s = setup();
        const options = () => [...s.container.querySelectorAll('option')].map(option => option.textContent);
        expect(options()).toEqual(['All content types', 'Pages', 'Entries']);
        await s.runner.load();

        // Counts come from the loaded list (no second scan on the server).
        expect(options()).toEqual(['All content types (2)', 'Pages (2)', 'Entries (0)']);
        expect(s.container.querySelectorAll('tbody tr')).toHaveLength(2);
        expect(s.row(1).querySelector('a')?.getAttribute('href')).toBe('/bolt/edit/1');
        expect(s.row(1).querySelector('img')?.getAttribute('src')).toBe('/thumbs/120×90×crop/p1.jpg');
        expect(s.container.querySelector('.ai-alt-batch__progress')?.textContent).toBe('0 / 2');
        expect(s.container.querySelector('.ai-alt-batch__note')?.textContent).toContain('Runs in this tab');

        const [url, init] = s.fetchMock.mock.calls[0]!;
        expect(url).toBe('http://localhost:3000/bolt/ai-alt/missing?offset=0&limit=2000');
        expect(init).toMatchObject({ credentials: 'same-origin' });
    });

    it('pages through large result sets and filters by content type', async () => {
        const first = Array.from({ length: 2000 }, (_, i) => item(i + 1));
        const s = setup({ pages: [first, [item(2001)]] });
        await s.runner.load();
        expect(s.runner.rows).toHaveLength(2001);
        expect(s.fetchMock).toHaveBeenCalledTimes(2);
    });

    it('filters by content type without reloading, keeping row state', async () => {
        const s = setup({ pages: [[item(1), item(2, { contentType: 'entries', key: '2:image:-:cs' })]] });
        await s.runner.load();
        s.runner.skip(s.runner.rows[0]!);

        const select = s.container.querySelector('select')!;
        select.value = 'entries';
        select.dispatchEvent(new Event('change'));
        expect(s.runner.rows.map(row => row.item.contentId)).toEqual([2]);
        expect(s.container.querySelectorAll('tbody tr')).toHaveLength(1);

        select.value = '';
        select.dispatchEvent(new Event('change'));
        expect(s.runner.rows).toHaveLength(2);
        expect(s.row(1).dataset.status).toBe('skipped');
        expect(s.fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stops paging on an empty page', async () => {
        const s = setup();
        s.fetchMock.mockImplementationOnce(async () => jsonResponse({ items: [], total: 10 }));
        await s.runner.load();
        expect(s.runner.rows).toHaveLength(0);
        expect(s.container.querySelector('tbody')?.textContent).toBe('All images have an ALT text.');
    });

    it('fails loudly when the list cannot be loaded', async () => {
        const s = setup();
        s.fetchMock.mockImplementationOnce(async () => jsonResponse({}, 403));
        await expect(s.runner.load()).rejects.toThrow('HTTP 403');
    });

    it('proposes alts for review by default and saves on accept', async () => {
        const s = setup();
        await s.runner.load();

        s.container.querySelector<HTMLButtonElement>('.btn-primary')!.click();
        expect(s.primeTranslator).toHaveBeenCalledWith(['cs']);
        await flush(20);
        await vi.waitFor(() => expect(s.runner.running).toBe(false));

        expect(s.generate).toHaveBeenCalledWith('/thumbs/768×768×max/p1.jpg', { language: 'cs' });
        expect(s.row(1).dataset.status).toBe('proposed');
        expect(s.row(1).querySelector('input')!.value).toBe('Alt for /thumbs/768×768×max/p1.jpg');
        expect(s.saved).toHaveLength(0);

        const input = s.row(1).querySelector('input')!;
        input.value = 'Edited proposal';
        s.row(1).querySelector<HTMLButtonElement>('.btn-primary')!.click();
        await vi.waitFor(() => expect(s.row(1).dataset.status).toBe('saved'));

        expect(s.saved[0]).toEqual({ contentId: 1, field: 'image', index: null, locale: 'cs', filename: 'p1.jpg', alt: 'Edited proposal' });
        const [, init] = s.fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
        expect((init!.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok');
        expect(input.disabled).toBe(true);
        expect(s.container.querySelector('.ai-alt-batch__progress')?.textContent).toBe('1 / 2');
    });

    it('auto-saves when review is off', async () => {
        const s = setup();
        await s.runner.load();
        const review = s.container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
        review.checked = false;
        review.dispatchEvent(new Event('change'));

        await s.runner.run();

        expect(s.saved.map(body => body.contentId)).toEqual([1, 2]);
        expect(s.row(2).dataset.status).toBe('saved');
    });

    it('does not save an empty proposal', async () => {
        const s = setup();
        await s.runner.load();
        await s.runner.save(s.runner.rows[0]!);
        expect(s.saved).toHaveLength(0);
    });

    it('marks conflicts and server errors', async () => {
        const s = setup({
            save: body =>
                body.contentId === 1 ? jsonResponse({ status: 'error' }, 409) : jsonResponse({ status: 'error', message: 'Nope' }, 403),
        });
        await s.runner.load();
        s.runner.reviewBeforeSave = false;
        await s.runner.run();

        expect(s.row(1).dataset.status).toBe('conflict');
        expect(s.row(1).textContent).toContain('Already filled');
        expect(s.row(2).dataset.status).toBe('error');
        expect(s.row(2).textContent).toContain('Nope');
    });

    it('handles error responses without a JSON body and network failures', async () => {
        let call = 0;
        const s = setup({
            save: () => {
                call++;
                if (call === 1) {
                    return new Response('<html>', { status: 500 });
                }
                throw new Error('offline');
            },
        });
        await s.runner.load();
        s.runner.reviewBeforeSave = false;
        await s.runner.run();

        expect(s.row(1).textContent).toContain('HTTP 500');
        expect(s.row(2).textContent).toContain('offline');
    });

    it('offers the English caption when no translation is possible and never auto-saves it', async () => {
        const s = setup({ generate: async () => ({ status: 'untranslated', english: 'A dog', ms: 0 }) });
        await s.runner.load();
        s.runner.reviewBeforeSave = false;
        await s.runner.run();

        expect(s.row(1).querySelector('input')!.value).toBe('A dog');
        expect(s.row(1).textContent).toContain('Translation not available');
        expect(s.saved).toHaveLength(0);
    });

    it('labels English fallbacks and gesture requests', async () => {
        let n = 0;
        const s = setup({
            generate: async () =>
                n++ === 0
                    ? { status: 'english', alt: 'A dog', english: 'A dog', ms: 5 }
                    : { status: 'needs-gesture', english: 'A cat', ms: 5 },
        });
        await s.runner.load();
        await s.runner.run();

        expect(s.row(1).textContent).toContain('EN – please translate');
        expect(s.row(2).textContent).toContain('Click anywhere to allow translation');
    });

    it('shows caption errors per row and continues', async () => {
        const s = setup({
            generate: async url => {
                throw url.includes('p1') ? new CaptionError('small', 'too-small') : new Error('model crashed');
            },
        });
        await s.runner.load();
        await s.runner.run();

        expect(s.row(1).textContent).toContain('Image too small');
        expect(s.row(2).textContent).toContain('model crashed');
        expect(s.row(2).dataset.status).toBe('error');
    });

    it('skips rows', async () => {
        const s = setup();
        await s.runner.load();
        s.row(2).querySelector<HTMLButtonElement>('.btn-tertiary')!.click();
        await s.runner.run();

        expect(s.row(2).dataset.status).toBe('skipped');
        expect(s.generate).toHaveBeenCalledTimes(1);
    });

    it('pauses and resumes', async () => {
        const gates = [deferred<AltOutcome>(), deferred<AltOutcome>()];
        let n = 0;
        const s = setup({ generate: () => gates[n++]!.promise });
        await s.runner.load();
        const start = s.container.querySelector<HTMLButtonElement>('.ai-alt-batch__toolbar .btn-primary')!;

        start.click();
        await flush();
        expect(start.textContent).toBe('Pause');

        start.click();
        expect(start.textContent).toBe('Resume');
        gates[0]!.resolve({ status: 'ok', alt: 'one', english: 'one', ms: 1000 });
        await flush(20);
        expect(s.generate).toHaveBeenCalledTimes(1);

        start.click();
        expect(start.textContent).toBe('Pause');
        await flush(20);
        expect(s.generate).toHaveBeenCalledTimes(2);

        gates[1]!.resolve({ status: 'ok', alt: 'two', english: 'two', ms: 1000 });
        await vi.waitFor(() => expect(start.textContent).toBe('Start'));
    });

    it('estimates the remaining time from measured timings', async () => {
        const s = setup({ pages: [[item(1), item(2), item(3)]] });
        await s.runner.load();
        expect(s.runner.etaMs()).toBeNull();

        const gates = [deferred<AltOutcome>(), deferred<AltOutcome>(), deferred<AltOutcome>()];
        let n = 0;
        s.generate.mockImplementation(() => gates[n++]!.promise);
        const progress = () => s.container.querySelector('.ai-alt-batch__progress')?.textContent;
        const run = s.runner.run();

        gates[0]!.resolve({ status: 'ok', alt: 'a', english: 'a', ms: 90_000 });
        await flush(20);
        // One measured image (90 s), two left.
        expect(s.runner.etaMs()).toBe(180_000);
        expect(progress()).toBe('0 / 3 · about 3 min left');

        gates[1]!.resolve({ status: 'ok', alt: 'b', english: 'b', ms: 20_000 });
        await flush(20);
        // Average 55 s, one left.
        expect(progress()).toBe('0 / 3 · about 55 s left');

        gates[2]!.resolve({ status: 'ok', alt: 'c', english: 'c', ms: 0 });
        await run;
        expect(progress()).toBe('0 / 3');
    });
});

describe('BatchRunner loading', () => {
    it('keeps only the latest load when a slow one finishes later', async () => {
        const s = setup();
        const slow = deferred<Response>();
        s.fetchMock.mockImplementationOnce(() => slow.promise);
        s.fetchMock.mockImplementationOnce(async () => jsonResponse({ items: [item(9, { contentType: 'entries' })], total: 1 }));

        const first = s.runner.load();
        const start = s.container.querySelector<HTMLButtonElement>('.ai-alt-batch__toolbar .btn-primary')!;
        expect(start.disabled).toBe(true);

        const select = s.container.querySelector('select')!;
        select.value = 'entries';
        const second = s.runner.load();
        await second;
        expect(start.disabled).toBe(false);

        slow.resolve(jsonResponse({ items: [item(1), item(2)], total: 2 }));
        await first;

        expect(s.runner.rows.map(row => row.item.contentId)).toEqual([9]);
        expect(start.disabled).toBe(false);
    });

    it('shows a failed load on the page and offers nothing to start', async () => {
        const s = setup();
        await s.runner.load();
        s.fetchMock.mockImplementationOnce(async () => jsonResponse({}, 500));

        await expect(s.runner.load()).rejects.toThrow('HTTP 500');

        const progress = s.container.querySelector<HTMLElement>('.ai-alt-batch__progress')!;
        expect(progress.textContent).toBe('Could not load the list: HTTP 500');
        expect(progress.dataset.state).toBe('error');
        expect(s.runner.rows).toHaveLength(0);
        expect(s.container.querySelectorAll('tbody tr')).toHaveLength(0);
        expect(s.container.querySelector<HTMLButtonElement>('.ai-alt-batch__toolbar .btn-primary')!.disabled).toBe(true);

        // A later successful load recovers.
        await s.runner.load();
        expect(progress.dataset.state).toBeUndefined();
        expect(s.runner.rows).toHaveLength(2);
    });

    it('uses the thumbnail base path for previews and captions', async () => {
        document.body.innerHTML = '<div id="ai-alt-batch"></div>';
        const generate = vi.fn(async (): Promise<AltOutcome> => ({ status: 'ok', alt: 'x', english: 'x', ms: 1 }));
        const runner = new BatchRunner(document.getElementById('ai-alt-batch')!, batchConfig, config({ thumbsBase: '/cms/thumbs' }), {
            provider: { generate, localize: vi.fn() },
            primeTranslator: vi.fn(),
            fetch: vi.fn(async () => jsonResponse({ items: [item(1)], total: 1 })),
            t: createTranslator('en'),
        });
        await runner.load();
        await runner.run();

        expect(document.querySelector('img')?.getAttribute('src')).toBe('/cms/thumbs/120×90×crop/p1.jpg');
        expect(generate).toHaveBeenCalledWith('/cms/thumbs/768×768×max/p1.jpg', { language: 'cs' });
    });
});

describe('BatchRunner review fixes', () => {
    it('does not overwrite or auto-save a row skipped while it was generating', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup({ generate: () => gate.promise });
        await s.runner.load();
        s.runner.reviewBeforeSave = false;
        const run = s.runner.run();
        await flush();

        expect(s.row(1).dataset.status).toBe('generating');
        expect(s.row(1).querySelector<HTMLButtonElement>('.btn-tertiary')!.disabled).toBe(false);
        s.row(1).querySelector<HTMLButtonElement>('.btn-tertiary')!.click();
        gate.resolve({ status: 'ok', alt: 'late', english: 'late', ms: 10 });
        s.row(2).querySelector<HTMLButtonElement>('.btn-tertiary')!.click();
        await run;

        expect(s.row(1).dataset.status).toBe('skipped');
        expect(s.row(1).querySelector('input')!.value).toBe('');
        expect(s.saved).toHaveLength(0);
    });

    it('keeps a skipped row skipped when its caption fails', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup({ generate: () => gate.promise, pages: [[item(1)]] });
        await s.runner.load();
        const run = s.runner.run();
        await flush();

        s.runner.skip(s.runner.rows[0]!);
        gate.reject(new Error('model crashed'));
        await run;

        expect(s.row(1).dataset.status).toBe('skipped');
    });

    it('translates rows that waited for a click, and Save uses the translation', async () => {
        const s = setup({ generate: async () => ({ status: 'needs-gesture', english: 'A dog', ms: 5 }), pages: [[item(1), item(2)]] });
        await s.runner.load();
        await s.runner.run();
        expect(s.row(1).textContent).toContain('Click anywhere to allow translation');
        expect(s.row(1).querySelector('input')!.value).toBe('A dog');

        // Clicking Save directly: the capture-phase handler starts the translation first.
        s.row(1).querySelector<HTMLButtonElement>('.btn-primary')!.click();
        await vi.waitFor(() => expect(s.row(1).dataset.status).toBe('saved'));

        expect(s.primeTranslator).toHaveBeenCalledWith(['cs']);
        expect(s.localize).toHaveBeenCalledWith('A dog', 'cs');
        expect(s.saved[0]).toMatchObject({ contentId: 1, alt: '[cs] A dog' });
        expect(s.row(2).querySelector('input')!.value).toBe('[cs] A dog');
        expect(s.row(2).textContent).toContain('AI – please review');

        // Nothing left to translate: later clicks do nothing.
        document.body.click();
        expect(s.localize).toHaveBeenCalledTimes(2);
    });

    it('keeps waiting while the language pack downloads and keeps what the reviewer typed', async () => {
        const s = setup({ generate: async () => ({ status: 'needs-gesture', english: 'A dog', ms: 5 }), pages: [[item(1), item(2)]] });
        s.localize
            .mockResolvedValueOnce({ status: 'needs-gesture', english: 'A dog', ms: 0 })
            .mockResolvedValueOnce({ status: 'needs-gesture', english: 'A dog', ms: 0 });
        await s.runner.load();
        await s.runner.run();

        document.body.click();
        await flush(10);
        expect(s.row(1).textContent).toContain('Click anywhere to allow translation');

        s.row(1).querySelector('input')!.value = 'Pes, ručně';
        document.body.click();
        await flush(10);

        expect(s.row(1).querySelector('input')!.value).toBe('Pes, ručně');
        expect(s.row(2).querySelector('input')!.value).toBe('[cs] A dog');
    });

    it('marks rows untranslatable when translation fails after the click', async () => {
        const s = setup({ generate: async () => ({ status: 'needs-gesture', english: 'A dog', ms: 5 }), pages: [[item(1), item(2)]] });
        s.localize
            .mockRejectedValueOnce(new Error('no pack'))
            .mockResolvedValueOnce({ status: 'english', alt: 'A dog', english: 'A dog', ms: 0 });
        await s.runner.load();
        await s.runner.run();

        document.body.click();
        await flush(10);

        expect(s.row(1).textContent).toContain('Translation not available');
        expect(s.row(2).textContent).toContain('EN – please translate');
    });

    it('ignores a translation that finishes after the row was skipped', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup({ generate: async () => ({ status: 'needs-gesture', english: 'A dog', ms: 5 }), pages: [[item(1)]] });
        s.localize.mockImplementationOnce(() => gate.promise);
        await s.runner.load();
        await s.runner.run();

        document.body.click();
        s.runner.skip(s.runner.rows[0]!);
        gate.resolve({ status: 'ok', alt: 'Pes', english: 'A dog', ms: 0 });
        await flush(10);

        expect(s.row(1).dataset.status).toBe('skipped');
        expect(s.row(1).querySelector('input')!.value).toBe('A dog');
    });

    it('explains missing image files', async () => {
        const s = setup({
            generate: async () => Promise.reject(new CaptionError('Image file not found', 'not-found')),
            pages: [[item(1)]],
        });
        await s.runner.load();
        await s.runner.run();

        expect(s.row(1).textContent).toContain('Image file not found');
        expect(s.row(1).dataset.status).toBe('error');
    });
});

describe('BatchRunner save races', () => {
    it('does not save a row skipped while its Save waited for the translation', async () => {
        const gate = deferred<AltOutcome>();
        const s = setup({ generate: async () => ({ status: 'needs-gesture', english: 'A dog', ms: 5 }), pages: [[item(1)]] });
        s.localize.mockImplementationOnce(() => gate.promise);
        await s.runner.load();
        await s.runner.run();

        s.row(1).querySelector<HTMLButtonElement>('.btn-primary')!.click();
        s.row(1).querySelector<HTMLButtonElement>('.btn-tertiary')!.click();
        gate.resolve({ status: 'ok', alt: 'Pes', english: 'A dog', ms: 0 });
        await flush(20);

        expect(s.row(1).dataset.status).toBe('skipped');
        expect(s.saved).toHaveLength(0);
    });

    it('sends one request for a double click', async () => {
        const s = setup({ pages: [[item(1)]] });
        await s.runner.load();
        await s.runner.run();

        const save = s.row(1).querySelector<HTMLButtonElement>('.btn-primary')!;
        save.click();
        void s.runner.save(s.runner.rows[0]!);
        await vi.waitFor(() => expect(s.row(1).dataset.status).toBe('saved'));

        expect(s.saved).toHaveLength(1);
    });

    it('sends saves one at a time', async () => {
        const s = setup({ pages: [[item(1), item(2)]] });
        await s.runner.load();
        await s.runner.run();

        const first = deferred<Response>();
        let inFlight = 0;
        let maxInFlight = 0;
        s.fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
            s.saved.push(JSON.parse(init!.body as string) as Record<string, unknown>);
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            const response = s.saved.length === 1 ? await first.promise : jsonResponse({ status: 'saved' });
            inFlight--;
            return response;
        });

        s.row(1).querySelector<HTMLButtonElement>('.btn-primary')!.click();
        s.row(2).querySelector<HTMLButtonElement>('.btn-primary')!.click();
        await flush(10);
        expect(s.saved).toHaveLength(1);

        first.resolve(jsonResponse({ status: 'saved' }));
        await vi.waitFor(() => expect(s.row(2).dataset.status).toBe('saved'));

        expect(s.row(1).dataset.status).toBe('saved');
        expect(maxInFlight).toBe(1);
    });

    it('lets a failed save be retried', async () => {
        let calls = 0;
        const s = setup({
            pages: [[item(1)]],
            save: () => (calls++ === 0 ? jsonResponse({ message: 'DB locked' }, 500) : jsonResponse({ status: 'saved' })),
        });
        await s.runner.load();
        await s.runner.run();

        await s.runner.save(s.runner.rows[0]!);
        expect(s.row(1).dataset.status).toBe('error');
        await s.runner.save(s.runner.rows[0]!);
        expect(s.row(1).dataset.status).toBe('saved');
    });
});

describe('bootBatch', () => {
    it('does nothing without config or container', () => {
        document.body.innerHTML = '';
        expect(bootBatch()).toBeNull();
    });

    it('boots from the page config', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ items: [item(1)], total: 1 }));
        vi.stubGlobal('fetch', fetchMock);
        document.body.innerHTML = `<div id="ai-alt-batch"></div><script type="application/json" id="ai-alt-config">${JSON.stringify(
            config({ batch: batchConfig }),
        )}</script>`;

        const runner = bootBatch();
        expect(runner).toBeInstanceOf(BatchRunner);
        await vi.waitFor(() => expect(runner!.rows).toHaveLength(1));
        vi.unstubAllGlobals();
    });

    it('logs load failures', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({}, 500)),
        );
        document.body.innerHTML = `<div id="ai-alt-batch"></div><script type="application/json" id="ai-alt-config">${JSON.stringify(
            config({ batch: batchConfig }),
        )}</script>`;

        bootBatch();
        await vi.waitFor(() => expect(error).toHaveBeenCalledWith('[ai-alt] could not load missing alts', expect.any(Error)));
        vi.unstubAllGlobals();
        error.mockRestore();
    });
});
