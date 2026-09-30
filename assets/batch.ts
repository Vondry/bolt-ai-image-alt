/**
 * Batch page (`/bolt/ai-alt/batch`): fills missing alts on existing
 * content, one image at a time, in this browser tab.
 */
import { createServices, readConfig } from './bootstrap';
import { describeCaptionError } from './captioner';
import type { AltOutcome, AltProvider } from './generate';
import type { Translate } from './i18n';
import { baseLanguage } from './locale';
import { thumbnailUrl } from './postprocess';
import type { AiAltConfig, BatchConfig } from './types';
import './ui.css';

export interface MissingItem {
    key: string;
    contentId: number;
    contentType: string;
    title: string;
    field: string;
    fieldLabel: string;
    index: number | null;
    locale: string;
    textLocale: string;
    filename: string;
    editUrl?: string;
}

export type RowStatus = 'pending' | 'generating' | 'proposed' | 'saving' | 'saved' | 'skipped' | 'conflict' | 'error';

export interface Row {
    item: MissingItem;
    status: RowStatus;
    proposal: string;
    element: HTMLTableRowElement;
    input: HTMLInputElement;
    statusCell: HTMLElement;
    acceptButton: HTMLButtonElement;
    skipButton: HTMLButtonElement;
    /** English caption waiting for a click that lets the Translator download its language pack. */
    awaitingTranslation: { english: string; language: string } | null;
    /** Running re-translation; `save()` waits for it. */
    translating: Promise<void> | null;
    /** A save() is in progress (possibly still waiting for the translation). */
    saving: boolean;
}

export interface BatchDeps {
    provider: AltProvider & { localize(english: string, language: string): Promise<AltOutcome> };
    primeTranslator: (languages: string[]) => void;
    fetch: typeof fetch;
    t: Translate;
}

/** Matches the server's maximum: one request (one scan of all content) for typical sites. */
const PAGE_SIZE = 2000;

export class BatchRunner {
    /** Rows shown for the selected ContentType. */
    rows: Row[] = [];
    private allRows: Row[] = [];
    running = false;
    paused = false;
    reviewBeforeSave = true;
    private readonly timings: number[] = [];
    private resumeWaiter: (() => void) | null = null;
    /**
     * Saves run one at a time: items of one imagelist share one stored value,
     * and overlapping writes to it would wait on (or, on SQLite, fail at)
     * the server's row lock.
     */
    private saveQueue: Promise<void> = Promise.resolve();
    private loadToken = 0;
    private readonly tbody: HTMLTableSectionElement;
    private readonly progress: HTMLElement;
    private readonly startButton: HTMLButtonElement;
    private readonly select: HTMLSelectElement;

    constructor(
        private readonly container: HTMLElement,
        private readonly batch: BatchConfig,
        private readonly config: Pick<AiAltConfig, 'thumbnail' | 'thumbsBase'>,
        private readonly deps: BatchDeps,
    ) {
        const doc = container.ownerDocument;
        const t = deps.t;

        const toolbar = el(doc, 'div', 'ai-alt-batch__toolbar');
        this.select = doc.createElement('select');
        this.select.className = 'form-select form-select-sm ai-alt-batch__select';
        this.select.append(new Option(t('batchAll'), ''));
        for (const contentType of batch.contentTypes) {
            this.select.append(new Option(contentType.name, contentType.slug));
        }
        // The full list is loaded once; switching ContentType only filters it.
        this.select.addEventListener('change', () => this.showRows());

        const reviewLabel = el(doc, 'label', 'form-check-label ai-alt-batch__review');
        const review = doc.createElement('input');
        review.type = 'checkbox';
        review.className = 'form-check-input';
        review.checked = this.reviewBeforeSave;
        review.addEventListener('change', () => {
            this.reviewBeforeSave = review.checked;
        });
        reviewLabel.append(review, doc.createTextNode(` ${t('batchReview')}`));

        this.startButton = doc.createElement('button');
        this.startButton.type = 'button';
        this.startButton.className = 'btn btn-primary btn-sm';
        this.startButton.textContent = t('batchStart');
        this.startButton.addEventListener('click', () => this.onStartClick());

        this.progress = el(doc, 'span', 'ai-alt-batch__progress');
        this.progress.setAttribute('role', 'status');
        toolbar.append(this.select, reviewLabel, this.startButton, this.progress);

        const note = el(doc, 'p', 'ai-alt-batch__note text-muted');
        note.textContent = t('batchNote');

        const table = el(doc, 'table', 'table table-sm ai-alt-batch__table');
        const head = table.createTHead().insertRow();
        for (const label of [t('batchImage'), t('batchContent'), t('batchField'), t('batchProposal'), '']) {
            const th = doc.createElement('th');
            th.textContent = label;
            head.append(th);
        }
        this.tbody = table.createTBody();

        container.replaceChildren(toolbar, note, table);

        // Capture phase: runs before a row's Save handler, so Save waits for the translation.
        doc.addEventListener('click', () => this.onUserGesture(), true);
    }

    /**
     * Fetches all missing items (every ContentType, one scan on the server)
     * and shows those of the selected ContentType. Only the latest load() may
     * fill the table. A failure is shown on the page and rethrown.
     */
    async load(): Promise<void> {
        const token = ++this.loadToken;

        // Starting on a half-loaded list would silently process nothing.
        this.startButton.disabled = true;
        let items: MissingItem[];
        try {
            items = await this.fetchAll(token);
        } catch (error) {
            if (token === this.loadToken) {
                this.showError(error);
            }
            throw error;
        }

        if (token === this.loadToken) {
            this.startButton.disabled = false;
            this.setItems(items);
        }
    }

    showError(error: unknown): void {
        this.allRows = [];
        this.rows = [];
        this.tbody.replaceChildren();
        this.progress.textContent = this.deps.t('batchLoadFailed', { message: String((error as Error)?.message ?? error) });
        this.progress.dataset.state = 'error';
        // Nothing to process.
        this.startButton.disabled = true;
    }

    private async fetchAll(token: number): Promise<MissingItem[]> {
        const items: MissingItem[] = [];
        let offset = 0;
        let total = Infinity;

        while (offset < total && token === this.loadToken) {
            const url = new URL(this.batch.missingUrl, globalThis.location?.href ?? 'http://localhost/');
            url.searchParams.set('offset', String(offset));
            url.searchParams.set('limit', String(PAGE_SIZE));

            const response = await this.deps.fetch(url.toString(), {
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const page = (await response.json()) as { items: MissingItem[]; total: number };
            items.push(...page.items);
            total = page.total;
            offset += PAGE_SIZE;
            if (page.items.length === 0) {
                break;
            }
        }

        return items;
    }

    setItems(items: MissingItem[]): void {
        this.allRows = items.map(item => this.createRow(item));
        delete this.progress.dataset.state;

        // ContentType counts, derived from the list instead of a second scan.
        for (const option of this.select.options) {
            const contentType = this.batch.contentTypes.find(ct => ct.slug === option.value);
            const count = contentType ? items.filter(item => item.contentType === contentType.slug).length : items.length;
            option.textContent = `${contentType?.name ?? this.deps.t('batchAll')} (${count})`;
        }

        this.showRows();
    }

    /** Rows of the selected ContentType; rows keep their state across filter changes. */
    showRows(): void {
        const contentType = this.select.value;
        this.rows = contentType === '' ? this.allRows : this.allRows.filter(row => row.item.contentType === contentType);
        this.tbody.replaceChildren(...this.rows.map(row => row.element));

        if (this.rows.length === 0) {
            const row = this.tbody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 5;
            cell.textContent = this.deps.t('batchEmpty');
        }

        this.updateProgress();
    }

    onStartClick(): void {
        if (!this.running) {
            // A click is a user gesture: let the Translator download language packs now.
            this.deps.primeTranslator([...new Set(this.rows.map(row => baseLanguage(row.item.textLocale)))]);
            void this.run();
            return;
        }

        this.paused = !this.paused;
        this.startButton.textContent = this.deps.t(this.paused ? 'batchResume' : 'batchPause');
        if (!this.paused) {
            this.resumeWaiter?.();
            this.resumeWaiter = null;
        }
    }

    async run(): Promise<void> {
        this.running = true;
        this.paused = false;
        this.startButton.textContent = this.deps.t('batchPause');
        this.select.disabled = true;

        for (const row of this.rows) {
            if (row.status !== 'pending') {
                continue;
            }
            if (this.paused) {
                await new Promise<void>(resolve => (this.resumeWaiter = resolve));
            }
            await this.generate(row);
        }

        this.running = false;
        this.select.disabled = false;
        this.startButton.textContent = this.deps.t('batchStart');
        this.updateProgress();
    }

    async generate(row: Row): Promise<void> {
        this.setStatus(row, 'generating');
        const language = baseLanguage(row.item.textLocale);

        let outcome: AltOutcome;
        try {
            outcome = await this.deps.provider.generate(thumbnailUrl(row.item.filename, this.config.thumbnail, this.config.thumbsBase), {
                language,
            });
        } catch (error) {
            if (row.status === 'generating') {
                this.setStatus(row, 'error', describeCaptionError(error, this.deps.t).text);
            }
            return;
        }

        // Skipped while the model was working: respect that, never save it.
        if (row.status !== 'generating') {
            return;
        }

        if (outcome.ms > 0) {
            this.timings.push(outcome.ms);
        }

        switch (outcome.status) {
            case 'ok':
            case 'english':
                row.proposal = outcome.alt;
                row.input.value = outcome.alt;
                this.setStatus(row, 'proposed', this.deps.t(outcome.status === 'ok' ? 'generated' : 'englishFallback'));
                if (!this.reviewBeforeSave) {
                    await this.save(row);
                }
                break;
            case 'untranslated':
                // Offer the English caption for manual translation; never auto-save it.
                row.input.value = outcome.english;
                this.setStatus(row, 'proposed', this.deps.t('translatorUnavailable'));
                break;
            case 'needs-gesture':
                row.input.value = outcome.english;
                row.awaitingTranslation = { english: outcome.english, language };
                this.setStatus(row, 'proposed', this.deps.t('translatorNeedsClick'));
                break;
        }
    }

    /** Any click: allow language pack downloads and translate the rows that waited for it. */
    onUserGesture(): void {
        const waiting = this.rows.filter(row => row.awaitingTranslation !== null && row.translating === null);
        if (waiting.length === 0) {
            return;
        }

        this.deps.primeTranslator([...new Set(waiting.map(row => row.awaitingTranslation!.language))]);

        for (const row of waiting) {
            row.translating = this.retranslate(row).finally(() => {
                row.translating = null;
            });
        }
    }

    private async retranslate(row: Row): Promise<void> {
        const pending = row.awaitingTranslation;
        if (!pending) {
            return;
        }

        this.setStatus(row, 'proposed', this.deps.t('translating'));

        let outcome: AltOutcome;
        try {
            outcome = await this.deps.provider.localize(pending.english, pending.language);
        } catch {
            outcome = { status: 'untranslated', english: pending.english, ms: 0 };
        }

        if (row.status !== 'proposed') {
            return;
        }

        switch (outcome.status) {
            case 'needs-gesture':
                // The pack is still downloading; try again on the next click.
                this.setStatus(row, 'proposed', this.deps.t('translatorNeedsClick'));
                return;
            case 'ok':
            case 'english':
                row.awaitingTranslation = null;
                // Keep what the reviewer typed meanwhile.
                if (row.input.value === pending.english) {
                    row.input.value = outcome.alt;
                    row.proposal = outcome.alt;
                }
                this.setStatus(row, 'proposed', this.deps.t(outcome.status === 'ok' ? 'generated' : 'englishFallback'));
                return;
            case 'untranslated':
                row.awaitingTranslation = null;
                this.setStatus(row, 'proposed', this.deps.t('translatorUnavailable'));
        }
    }

    async save(row: Row): Promise<void> {
        // Double clicks, or Save pressed again while waiting for the translation.
        if (row.saving) {
            return;
        }
        row.saving = true;

        try {
            if (row.translating) {
                await row.translating;
            }

            // Skipped (or saved elsewhere) while we waited.
            if (row.status !== 'proposed' && row.status !== 'error') {
                return;
            }

            const posting = this.saveQueue.then(() => this.post(row));
            this.saveQueue = posting.catch(() => undefined);
            await posting;
        } finally {
            row.saving = false;
        }
    }

    private async post(row: Row): Promise<void> {
        const alt = row.input.value.trim();
        if (alt === '') {
            return;
        }

        this.setStatus(row, 'saving');
        try {
            const response = await this.deps.fetch(this.batch.saveUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRF-Token': this.batch.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({
                    contentId: row.item.contentId,
                    field: row.item.field,
                    index: row.item.index,
                    locale: row.item.locale,
                    filename: row.item.filename,
                    alt,
                }),
            });

            if (response.status === 409) {
                this.setStatus(row, 'conflict', this.deps.t('batchConflict'));
                return;
            }

            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as { message?: string };
                this.setStatus(row, 'error', body.message ?? `HTTP ${response.status}`);
                return;
            }

            this.setStatus(row, 'saved', this.deps.t('batchSaved'));
        } catch (error) {
            this.setStatus(row, 'error', String((error as Error)?.message ?? error));
        }
    }

    skip(row: Row): void {
        row.awaitingTranslation = null;
        this.setStatus(row, 'skipped', this.deps.t('batchSkipped'));
    }

    /** Average measured ms per image × remaining images. */
    etaMs(): number | null {
        if (this.timings.length === 0) {
            return null;
        }
        const average = this.timings.reduce((sum, ms) => sum + ms, 0) / this.timings.length;
        const remaining = this.rows.filter(row => row.status === 'pending' || row.status === 'generating').length;

        return Math.round(average * remaining);
    }

    private createRow(item: MissingItem): Row {
        const doc = this.container.ownerDocument;
        const element = doc.createElement('tr');
        element.dataset.key = item.key;

        const imageCell = element.insertCell();
        const image = doc.createElement('img');
        image.src = thumbnailUrl(item.filename, '120×90×crop', this.config.thumbsBase);
        image.alt = '';
        image.loading = 'lazy';
        image.className = 'ai-alt-batch__thumb';
        imageCell.append(image);

        const contentCell = element.insertCell();
        const link = doc.createElement('a');
        link.textContent = item.title;
        link.href = item.editUrl ?? '#';
        link.target = '_blank';
        link.rel = 'noopener';
        const meta = el(doc, 'small', 'd-block text-muted');
        meta.textContent = `${item.contentType} #${item.contentId}`;
        contentCell.append(link, meta);

        const fieldCell = element.insertCell();
        const position = item.index !== null ? ` [${item.index + 1}]` : '';
        fieldCell.textContent = item.fieldLabel + position;
        const locale = el(doc, 'small', 'd-block text-muted');
        locale.textContent = item.textLocale;
        fieldCell.append(locale);

        const proposalCell = element.insertCell();
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'form-control form-control-sm';
        input.lang = item.textLocale;
        const statusCell = el(doc, 'small', 'ai-alt-chip');
        statusCell.hidden = true;
        proposalCell.append(input, statusCell);

        const actions = element.insertCell();
        actions.className = 'text-nowrap';
        const acceptButton = doc.createElement('button');
        acceptButton.type = 'button';
        acceptButton.className = 'btn btn-sm btn-primary';
        acceptButton.textContent = this.deps.t('batchAccept');
        const skipButton = doc.createElement('button');
        skipButton.type = 'button';
        skipButton.className = 'btn btn-sm btn-tertiary';
        skipButton.textContent = this.deps.t('batchSkip');
        actions.append(acceptButton, doc.createTextNode(' '), skipButton);

        const row: Row = {
            item,
            status: 'pending',
            proposal: '',
            element,
            input,
            statusCell,
            acceptButton,
            skipButton,
            awaitingTranslation: null,
            translating: null,
            saving: false,
        };
        acceptButton.addEventListener('click', () => void this.save(row));
        skipButton.addEventListener('click', () => this.skip(row));
        this.setStatus(row, 'pending');

        return row;
    }

    private setStatus(row: Row, status: RowStatus, text = ''): void {
        row.status = status;
        row.element.dataset.status = status;
        row.statusCell.textContent = text || (status === 'generating' ? this.deps.t('generating') : '');
        row.statusCell.hidden = row.statusCell.textContent === '';
        row.statusCell.dataset.state =
            { saved: 'ok', proposed: 'ok', conflict: 'warn', skipped: 'idle', error: 'error' }[status as string] ?? 'busy';

        const done = status === 'saved' || status === 'skipped' || status === 'conflict';
        row.input.disabled = done || status === 'saving';
        row.acceptButton.disabled = done || status === 'pending' || status === 'generating' || status === 'saving';
        row.skipButton.disabled = done || status === 'saving';

        this.updateProgress();
    }

    private updateProgress(): void {
        const total = this.rows.length;
        const done = this.rows.filter(row => ['saved', 'skipped', 'conflict', 'error'].includes(row.status)).length;
        const eta = this.etaMs();
        let etaText = '';
        if (eta !== null && this.running) {
            etaText =
                eta >= 60_000
                    ? this.deps.t('batchEta', { minutes: Math.ceil(eta / 60_000) })
                    : this.deps.t('batchEtaSeconds', { seconds: Math.ceil(eta / 1000) });
        }
        this.progress.textContent = total > 0 ? this.deps.t('batchProgress', { done, total, eta: etaText }).replace(/ · $/, '') : '';
    }
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string): HTMLElementTagNameMap[K] {
    const element = doc.createElement(tag);
    element.className = className;
    return element;
}

export function bootBatch(doc: Document = document): BatchRunner | null {
    const config = readConfig(doc);
    const container = doc.getElementById('ai-alt-batch');
    if (!config?.enabled || !config.batch || !container) {
        return null;
    }

    const services = createServices(config);
    const runner = new BatchRunner(container, config.batch, config, {
        provider: services.provider,
        primeTranslator: languages => services.translator.prime(languages),
        fetch: (...args) => fetch(...args),
        t: services.t,
    });
    // load() already shows the error on the page.
    runner.load().catch(error => console.error('[ai-alt] could not load missing alts', error));

    return runner;
}

if (typeof document !== 'undefined' && !(globalThis as { __AI_ALT_TEST__?: boolean }).__AI_ALT_TEST__) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => bootBatch(), { once: true });
    } else {
        bootBatch();
    }
}
