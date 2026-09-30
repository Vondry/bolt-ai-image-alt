/**
 * Wrapper around Chrome's built-in Translator API (Chrome / Edge 138+).
 * Must run on the main thread: the API is not exposed to Web Workers.
 *
 * https://developer.chrome.com/docs/ai/translator-api
 */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface TranslatorInstance {
    translate(text: string): Promise<string>;
    destroy?(): void;
}

interface TranslatorStatic {
    availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
    create(options: {
        sourceLanguage: string;
        targetLanguage: string;
        monitor?: (monitor: EventTarget) => void;
    }): Promise<TranslatorInstance>;
}

export type TranslationResult =
    { status: 'identity'; text: string } | { status: 'translated'; text: string } | { status: 'unavailable' } | { status: 'needs-gesture' };

export const SOURCE_LANGUAGE = 'en';

export class TranslatorService {
    private readonly instances = new Map<string, Promise<TranslatorInstance>>();
    private readonly pendingGesture = new Set<string>();

    constructor(private readonly api: TranslatorStatic | undefined = getTranslatorApi()) {}

    get supported(): boolean {
        return this.api !== undefined;
    }

    async availability(targetLanguage: string): Promise<Availability> {
        if (targetLanguage === SOURCE_LANGUAGE) {
            return 'available';
        }

        if (!this.api) {
            return 'unavailable';
        }

        try {
            return await this.api.availability({ sourceLanguage: SOURCE_LANGUAGE, targetLanguage });
        } catch {
            return 'unavailable';
        }
    }

    async translate(text: string, targetLanguage: string): Promise<TranslationResult> {
        if (targetLanguage === SOURCE_LANGUAGE || text === '') {
            return { status: 'identity', text };
        }

        const availability = await this.availability(targetLanguage);
        if (availability === 'unavailable' || !this.api) {
            return { status: 'unavailable' };
        }

        // A language pack download needs a user gesture. Without one, wait for
        // `prime()` to be called from a click handler.
        if (availability !== 'available' && !this.instances.has(targetLanguage) && !hasUserActivation()) {
            this.pendingGesture.add(targetLanguage);
            return { status: 'needs-gesture' };
        }

        try {
            const translator = await this.get(targetLanguage);
            return { status: 'translated', text: await translator.translate(text) };
        } catch {
            this.instances.delete(targetLanguage);
            return { status: 'unavailable' };
        }
    }

    /**
     * Call from a user gesture (click): creates translators that could not be
     * created without one, so the language pack can download.
     */
    prime(targetLanguages: Iterable<string> = this.pendingGesture): void {
        for (const language of [...targetLanguages]) {
            if (language !== SOURCE_LANGUAGE && this.api) {
                this.get(language).catch(() => this.instances.delete(language));
            }
            this.pendingGesture.delete(language);
        }
    }

    get needsGesture(): boolean {
        return this.pendingGesture.size > 0;
    }

    private get(targetLanguage: string): Promise<TranslatorInstance> {
        let instance = this.instances.get(targetLanguage);

        if (!instance && this.api) {
            instance = this.api.create({ sourceLanguage: SOURCE_LANGUAGE, targetLanguage });
            this.instances.set(targetLanguage, instance);
        }

        if (!instance) {
            return Promise.reject(new Error('Translator API not available'));
        }

        return instance;
    }
}

function getTranslatorApi(): TranslatorStatic | undefined {
    const candidate = (globalThis as { Translator?: TranslatorStatic }).Translator;

    return candidate && typeof candidate.availability === 'function' ? candidate : undefined;
}

function hasUserActivation(): boolean {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;

    return activation?.isActive ?? false;
}
