import { describe, expect, it, vi } from 'vitest';
import { Captioner } from '../../assets/captioner';
import { BrowserFlorenceProvider, createProvider } from '../../assets/generate';
import type { TranslationResult } from '../../assets/translate';
import { TranslatorService } from '../../assets/translate';

function provider(translation: TranslationResult, fallback: 'empty' | 'english' = 'empty') {
    const captioner = { caption: vi.fn(async () => ({ text: '<s>An image of a yellow excavator.</s>', ms: 1200 })) };
    const translator = { translate: vi.fn(async () => translation) };

    return { provider: new BrowserFlorenceProvider(captioner, translator, { maxLength: 125, fallback }), captioner, translator };
}

describe('BrowserFlorenceProvider', () => {
    it('captions, cleans and translates', async () => {
        const { provider: p, translator, captioner } = provider({ status: 'translated', text: 'žlutý bagr.' });

        await expect(p.generate('/thumbs/x.jpg', { language: 'cs' })).resolves.toEqual({
            status: 'ok',
            alt: 'Žlutý bagr',
            english: 'A yellow excavator',
            ms: 1200,
        });
        expect(captioner.caption).toHaveBeenCalledWith('/thumbs/x.jpg');
        expect(translator.translate).toHaveBeenCalledWith('A yellow excavator', 'cs');
    });

    it('passes English through', async () => {
        const { provider: p } = provider({ status: 'identity', text: 'A yellow excavator' });
        await expect(p.generate('/x', { language: 'en' })).resolves.toMatchObject({ status: 'ok', alt: 'A yellow excavator' });
    });

    it('leaves the alt empty without a translator by default', async () => {
        const { provider: p } = provider({ status: 'unavailable' });
        await expect(p.generate('/x', { language: 'cs' })).resolves.toEqual({
            status: 'untranslated',
            english: 'A yellow excavator',
            ms: 1200,
        });
    });

    it('writes English when configured', async () => {
        const { provider: p } = provider({ status: 'unavailable' }, 'english');
        await expect(p.generate('/x', { language: 'cs' })).resolves.toEqual({
            status: 'english',
            alt: 'A yellow excavator',
            english: 'A yellow excavator',
            ms: 1200,
        });
    });

    it('reports when a user gesture is needed', async () => {
        const { provider: p } = provider({ status: 'needs-gesture' });
        await expect(p.generate('/x', { language: 'cs' })).resolves.toMatchObject({ status: 'needs-gesture' });
    });

    it('localize() translates an existing caption', async () => {
        const { provider: p, captioner } = provider({ status: 'translated', text: 'pes' });
        await expect(p.localize('A dog', 'cs')).resolves.toEqual({ status: 'ok', alt: 'Pes', english: 'A dog', ms: 0 });
        expect(captioner.caption).not.toHaveBeenCalled();
    });

    it('createProvider wires the real services', () => {
        const instance = createProvider(
            new Captioner({ model: '', modelHost: '', task: '', ortBase: '' }, vi.fn()),
            new TranslatorService(undefined),
            {
                maxLength: 10,
                fallback: 'empty',
            },
        );
        expect(instance).toBeInstanceOf(BrowserFlorenceProvider);
    });
});
