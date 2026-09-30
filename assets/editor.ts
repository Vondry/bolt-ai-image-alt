import { describeCaptionError, TASKS } from './captioner';
import { findImageFields, isEmpty, writeAlt, type ImageFieldPair } from './fields';
import type { AltOutcome, AltProvider } from './generate';
import type { MessageKey, Translate } from './i18n';
import { readEditLocale, resolveTargetLocale } from './locale';
import { isCaptionable, thumbnailUrl } from './postprocess';
import { JobQueue } from './queue';
import { createFieldUi, showNotice, type FieldUi } from './ui';
import type { AiAltConfig } from './types';

type Mode = 'auto' | 'manual';

const TASK_LABELS: Record<(typeof TASKS)[number], MessageKey> = {
    '<CAPTION>': 'levelShort',
    '<DETAILED_CAPTION>': 'levelDetailed',
    '<MORE_DETAILED_CAPTION>': 'levelMoreDetailed',
};

interface FieldState {
    pair: ImageFieldPair;
    ui: FieldUi;
    lastFilename: string;
}

interface Job {
    state: FieldState;
    filename: string;
    altAtEnqueue: string;
    mode: Mode;
    task: string;
}

interface PendingTranslation {
    state: FieldState;
    filename: string;
    english: string;
    language: string;
    task: string;
}

export interface EditorDeps {
    provider: AltProvider & { localize(english: string, language: string, task?: string): Promise<AltOutcome> };
    /** Loads the model; used for pre-warming. */
    warmUp: () => Promise<unknown>;
    /** Called from user gestures so the Translator API may download language packs. */
    primeTranslator: (languages?: string[]) => void;
    isModelReady: () => boolean;
    t: Translate;
    pollInterval?: number;
    scheduleIdle?: (callback: () => void) => void;
}

export const GENERATED_MARKER = 'generated';

/**
 * Enhances the Bolt content edit form: a "Generate ALT" button per image (with
 * a dropdown for the level of detail), automatic generation after upload /
 * library pick, and a save notice.
 */
export class EditorController {
    private readonly states = new Map<HTMLInputElement, FieldState>();
    private readonly queue: JobQueue<Job>;
    private readonly pendingTranslations: PendingTranslation[] = [];
    private readonly cleanups: (() => void)[] = [];
    private progressText = '';
    private progressPercent = -1;
    private scanScheduled = false;
    private prewarmed = false;
    private writing = false;
    private localizing = 0;

    constructor(
        private readonly root: HTMLElement,
        private readonly config: AiAltConfig,
        private readonly deps: EditorDeps,
    ) {
        this.queue = new JobQueue<Job>(job => this.process(job));
    }

    get pendingJobs(): number {
        return this.queue.size;
    }

    get fields(): FieldState[] {
        return [...this.states.values()];
    }

    start(): void {
        this.scan();

        const observer = new MutationObserver(mutations => {
            if (mutations.some(m => isRelevantMutation(m))) {
                this.scheduleScan();
            }
        });
        observer.observe(this.root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
        this.cleanups.push(() => observer.disconnect());

        // Fallback: `filenameData` is a Vue property, not an attribute.
        const interval = setInterval(() => this.checkChanges(), this.deps.pollInterval ?? 750);
        this.cleanups.push(() => clearInterval(interval));

        const onClick = (): void => this.onUserGesture();
        this.root.ownerDocument.addEventListener('click', onClick, true);
        this.cleanups.push(() => this.root.ownerDocument.removeEventListener('click', onClick, true));

        const onSubmit = (): void => this.onSubmit();
        this.root.ownerDocument.addEventListener('submit', onSubmit, true);
        this.cleanups.push(() => this.root.ownerDocument.removeEventListener('submit', onSubmit, true));
    }

    stop(): void {
        this.cleanups.splice(0).forEach(cleanup => cleanup());
    }

    /** Find (new) image fields and inject the UI. */
    scan(): void {
        for (const pair of findImageFields(this.root)) {
            const existing = this.states.get(pair.alt);
            if (existing) {
                existing.pair = pair;
                if (!existing.ui.root.isConnected) {
                    pair.alt.insertAdjacentElement('afterend', existing.ui.root);
                }
                continue;
            }

            this.enhance(pair);
        }

        for (const [alt] of this.states) {
            if (!alt.isConnected) {
                this.states.delete(alt);
            }
        }

        this.maybePrewarm();
        this.checkChanges();
    }

    /** Detect new images: filename changed, is non-empty and alt is empty → enqueue. */
    checkChanges(): void {
        for (const state of this.states.values()) {
            const filename = state.pair.filename.value.trim();
            if (filename === state.lastFilename) {
                continue;
            }

            state.lastFilename = filename;
            this.clearMarker(state);

            if (this.config.autoOnUpload && filename !== '' && isEmpty(state.pair.alt)) {
                this.enqueue(state, 'auto');
            }
        }
    }

    /** `task` = level of detail; the configured default unless picked from the dropdown. */
    enqueue(state: FieldState, mode: Mode, task: string = this.config.task): boolean {
        const filename = state.pair.filename.value.trim();

        if (filename === '') {
            return false;
        }

        if (!isCaptionable(filename)) {
            if (mode === 'manual') {
                state.ui.setChip('warn', this.deps.t('unsupported'));
            }
            return false;
        }

        const key = `${state.pair.prefix}|${filename}`;
        if (this.queue.has(key)) {
            return false;
        }

        // Before enqueueing: an idle queue starts the job synchronously and sets its own status.
        state.ui.setBusy(true);
        state.ui.setChip('busy', this.deps.t(this.queue.size > 0 ? 'queued' : 'generating'));

        return this.queue.enqueue(key, { state, filename, altAtEnqueue: state.pair.alt.value, mode, task });
    }

    /** Update chips while the model downloads. */
    reportProgress(loaded: number, total: number): void {
        const percent = total > 0 ? Math.min(99, Math.floor((loaded / total) * 100)) : 0;
        // The worker reports every chunk of every file; only repaint when the number changes.
        if (percent === this.progressPercent) {
            return;
        }
        this.progressPercent = percent;
        this.progressText = this.deps.t('loadingModelProgress', { percent });

        for (const state of this.states.values()) {
            if (state.ui.root.classList.contains('is-busy') && state.ui.chip.dataset.state === 'busy') {
                state.ui.setChip('busy', this.progressText);
            }
        }
    }

    private enhance(pair: ImageFieldPair): void {
        const { t } = this.deps;
        const generate = (task?: string): void => {
            this.deps.primeTranslator([this.languageFor(state)]);
            this.enqueue(state, 'manual', task);
        };
        const ui = createFieldUi(this.root.ownerDocument, t('generate'), t('generateTitle'), {
            label: t('levelMenu'),
            items: TASKS.map(task => ({
                value: task,
                label: t(TASK_LABELS[task]),
                hint: task === this.config.task ? t('levelDefault') : undefined,
            })),
            onPick: generate,
        });
        const state: FieldState = { pair, ui, lastFilename: pair.filename.value.trim() };

        ui.button.addEventListener('click', () => generate());

        pair.alt.addEventListener('input', () => {
            // Our own write-back dispatches `input` too; only react to the editor typing.
            if (!this.writing) {
                this.clearMarker(state);
            }
        });

        pair.alt.insertAdjacentElement('afterend', ui.root);
        this.states.set(pair.alt, state);
    }

    private async process(job: Job): Promise<void> {
        const { state } = job;
        const { ui, pair } = state;

        try {
            // The image was replaced or removed while the job waited.
            if (pair.filename.value.trim() !== job.filename) {
                ui.setChip('idle');
                return;
            }

            ui.setChip('busy', this.deps.isModelReady() ? this.deps.t('generating') : this.progressText || this.deps.t('loadingModel'));

            const language = this.languageFor(state);
            const outcome = await this.deps.provider.generate(thumbnailUrl(job.filename, this.config.thumbnail, this.config.thumbsBase), {
                language,
                task: job.task,
            });

            this.apply(state, job, outcome, language);
        } catch (error) {
            const { text, warn } = describeCaptionError(error, this.deps.t);
            ui.setChip(warn ? 'warn' : 'error', text);
        } finally {
            ui.setBusy(false);
        }
    }

    private apply(
        state: FieldState,
        job: Pick<Job, 'filename' | 'altAtEnqueue' | 'mode' | 'task'>,
        outcome: AltOutcome,
        language: string,
    ): void {
        const { pair, ui } = state;

        // Never overwrite what the editor typed meanwhile, nor a changed image.
        if (pair.alt.value !== job.altAtEnqueue || pair.filename.value.trim() !== job.filename) {
            ui.setChip('idle');
            return;
        }

        if (job.mode === 'auto' && !isEmpty(pair.alt)) {
            ui.setChip('idle');
            return;
        }

        switch (outcome.status) {
            case 'ok':
                this.write(pair.alt, outcome.alt);
                ui.setChip('ok', this.deps.t('generated'));
                break;
            case 'english':
                this.write(pair.alt, outcome.alt);
                ui.setChip('warn', this.deps.t('englishFallback'));
                break;
            case 'untranslated':
                ui.setChip('warn', this.deps.t('translatorUnavailable'));
                break;
            case 'needs-gesture':
                this.pendingTranslations.push({ state, filename: job.filename, english: outcome.english, language, task: job.task });
                ui.setChip('warn', this.deps.t('translatorNeedsClick'));
                break;
        }
    }

    /** First click anywhere: allow translator downloads, then finish waiting translations. */
    private onUserGesture(): void {
        if (this.pendingTranslations.length === 0) {
            return;
        }

        const pending = this.pendingTranslations.splice(0);
        this.deps.primeTranslator([...new Set(pending.map(p => p.language))]);

        for (const item of pending) {
            const altAtEnqueue = item.state.pair.alt.value;
            item.state.ui.setChip('busy', this.deps.t('translating'));
            this.localizing++;
            this.deps.provider
                .localize(item.english, item.language, item.task)
                .then(outcome => {
                    // A click does not make the pack download instantly; keep waiting silently.
                    if (outcome.status === 'needs-gesture') {
                        this.pendingTranslations.push(item);
                        item.state.ui.setChip('warn', this.deps.t('translatorNeedsClick'));
                        return;
                    }
                    this.apply(
                        item.state,
                        { filename: item.filename, altAtEnqueue, mode: 'auto', task: item.task },
                        outcome,
                        item.language,
                    );
                })
                .catch(error => item.state.ui.setChip('error', this.deps.t('error', { message: String(error) })))
                .finally(() => this.localizing--);
        }
    }

    private onSubmit(): void {
        // Queued/running captions, alts waiting for a translator click, and
        // translations started by this very click (the form is already serialised).
        const count = this.queue.size + this.pendingTranslations.length + this.localizing;
        if (count > 0) {
            showNotice(this.root.ownerDocument, this.deps.t('pendingOnSave', { count }));
        }
    }

    private languageFor(state: FieldState): string {
        return resolveTargetLocale(
            state.pair.alt.name,
            this.config.fieldMeta,
            readEditLocale(this.root.ownerDocument),
            this.config.defaultLocale,
        );
    }

    private write(input: HTMLInputElement, text: string): void {
        this.writing = true;
        try {
            writeAlt(input, text);
        } finally {
            this.writing = false;
        }
        input.dataset.aiAlt = GENERATED_MARKER;
    }

    private clearMarker(state: FieldState): void {
        delete state.pair.alt.dataset.aiAlt;
        if (!state.ui.root.classList.contains('is-busy')) {
            state.ui.setChip('idle');
        }
    }

    /** Load the model in the background once the page has image fields, so the first upload is fast. */
    private maybePrewarm(): void {
        if (this.prewarmed || this.states.size === 0 || !this.config.autoOnUpload || !this.config.prewarmModel) {
            return;
        }

        this.prewarmed = true;
        const schedule = this.deps.scheduleIdle ?? defaultScheduleIdle;
        schedule(() => {
            this.deps.warmUp().catch(error => console.warn('[ai-alt] model pre-warm failed', error));
        });
    }

    private scheduleScan(): void {
        if (this.scanScheduled) {
            return;
        }
        this.scanScheduled = true;
        queueMicrotask(() => {
            this.scanScheduled = false;
            this.scan();
        });
    }
}

const OWN_UI = '.ai-alt-controls, .ai-alt-notice';

function isOwnNode(node: Node): boolean {
    const element = node instanceof Element ? node : node.parentElement;

    return element?.closest(OWN_UI) != null;
}

/**
 * Mutations that can mean new or changed image fields. Our own chips and
 * notices change constantly (status text, download progress) and are ignored,
 * except when something removes our controls (Vue re-render), which needs a
 * rescan to put them back.
 */
export function isRelevantMutation(mutation: MutationRecord): boolean {
    if (isOwnNode(mutation.target)) {
        return false;
    }

    if (mutation.type === 'attributes') {
        return mutation.attributeName === 'style';
    }

    const added = [...mutation.addedNodes];
    const onlyOursAdded = mutation.removedNodes.length === 0 && added.length > 0 && added.every(isOwnNode);

    return !onlyOursAdded;
}

function defaultScheduleIdle(callback: () => void): void {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) {
        ric(callback, { timeout: 5000 });
    } else {
        setTimeout(callback, 1500);
    }
}
