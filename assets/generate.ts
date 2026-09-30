import { Captioner, type CaptionResult } from './captioner';
import { cleanCaption, finalize } from './postprocess';
import { TranslatorService, type TranslationResult } from './translate';
import type { FallbackMode } from './types';

export interface AltContext {
    /** Target language, BCP 47 base (`cs`, `en`). */
    language: string;
    /** Florence-2 task (level of detail); the captioner's default when omitted. */
    task?: string;
}

export type AltOutcome =
    /** Ready to use (translated, or English was the target). */
    | { status: 'ok'; alt: string; english: string; ms: number }
    /** No translator: English caption written on purpose (`english` fallback). */
    | { status: 'english'; alt: string; english: string; ms: number }
    /** No translator and fallback `empty`: nothing to write. */
    | { status: 'untranslated'; english: string; ms: number }
    /** Translator exists but must be created from a click first. */
    | { status: 'needs-gesture'; english: string; ms: number };

/**
 * v2 seam: other providers (server proxy to a cloud model) implement the
 * same interface.
 */
export interface AltProvider {
    generate(imageUrl: string, context: AltContext): Promise<AltOutcome>;
}

export interface ProviderOptions {
    /** Limit for the default task. */
    maxLength: number;
    /** Limit per task, for the levels picked from the dropdown. */
    maxLengths?: Record<string, number>;
    fallback: FallbackMode;
}

export interface CaptionSource {
    caption(url: string, task?: string): Promise<CaptionResult>;
}

export interface TranslationSource {
    translate(text: string, targetLanguage: string): Promise<TranslationResult>;
}

export class BrowserFlorenceProvider implements AltProvider {
    constructor(
        private readonly captioner: CaptionSource,
        private readonly translator: TranslationSource,
        private readonly options: ProviderOptions,
    ) {}

    async generate(imageUrl: string, context: AltContext): Promise<AltOutcome> {
        const { text, ms } = await this.captioner.caption(imageUrl, context.task);
        const english = cleanCaption(text, this.lengthFor(context.task));

        return this.localize(english, context.language, context.task, ms);
    }

    /** Translate an already generated English caption (e.g. after a click unlocked the translator). */
    async localize(english: string, language: string, task?: string, ms = 0): Promise<AltOutcome> {
        const translation = await this.translator.translate(english, language);

        switch (translation.status) {
            case 'identity':
            case 'translated':
                return { status: 'ok', alt: finalize(translation.text, this.lengthFor(task)), english, ms };
            case 'needs-gesture':
                return { status: 'needs-gesture', english, ms };
            case 'unavailable':
                return this.options.fallback === 'english'
                    ? { status: 'english', alt: english, english, ms }
                    : { status: 'untranslated', english, ms };
        }
    }

    /** The task's own limit; the default task's limit when there is none. */
    private lengthFor(task: string | undefined): number {
        return (task !== undefined ? this.options.maxLengths?.[task] : undefined) ?? this.options.maxLength;
    }
}

export function createProvider(captioner: Captioner, translator: TranslatorService, options: ProviderOptions): BrowserFlorenceProvider {
    return new BrowserFlorenceProvider(captioner, translator, options);
}
