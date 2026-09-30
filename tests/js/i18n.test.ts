import { describe, expect, it } from 'vitest';
import { createTranslator, supportedLanguages } from '../../assets/i18n';
import en from '../../assets/langs/en.json';

const catalogues = import.meta.glob<Record<string, string>>('../../assets/langs/*.json', { eager: true, import: 'default' });
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('createTranslator', () => {
    it('uses Czech for cs locales', () => {
        const t = createTranslator('cs_CZ');
        expect(t('generated')).toBe('AI – zkontrolujte');
        expect(t('pendingOnSave', { count: 2 })).toBe('2 ALT text(y) se ještě generují. Nebudou uloženy.');
    });

    it('picks the other languages', () => {
        expect(createTranslator('de_DE')('generate')).toBe('ALT generieren');
        expect(createTranslator('sk')('generate')).toBe('Generovať ALT');
        expect(createTranslator('fr')('generate')).toBe('Générer l’ALT');
        expect(createTranslator('nl')('generate')).toBe('ALT genereren');
        expect(createTranslator('it')('generate')).toBe('Genera ALT');
        expect(createTranslator('ro')('generate')).toBe('Generează ALT');
        expect(createTranslator('uk')('generate')).toBe('Згенерувати ALT');
        expect(createTranslator('ru')('generate')).toBe('Сгенерировать ALT');
        expect(createTranslator('es-ES')('generate')).toBe('Generar ALT');
    });

    it('defaults to English', () => {
        expect(createTranslator('xx')('generate')).toBe('Generate ALT');
        expect(createTranslator(null)('generate')).toBe('Generate ALT');
        expect(createTranslator(undefined)('generate')).toBe('Generate ALT');
    });

    it('keeps unknown placeholders', () => {
        expect(createTranslator('en')('loadingModelProgress')).toBe('Loading model… {percent} %');
        expect(createTranslator('en')('loadingModelProgress', { percent: 42 })).toBe('Loading model… 42 %');
    });
});

describe('langs/*.json', () => {
    it('ships the expected languages', () => {
        expect(supportedLanguages).toEqual(['cs', 'de', 'en', 'es', 'fr', 'it', 'nl', 'ro', 'ru', 'sk', 'uk']);
    });

    it.each(Object.entries(catalogues))('%s has every English key with the same placeholders', (_path, catalogue) => {
        expect(Object.keys(catalogue)).toEqual(Object.keys(en));
        for (const [key, text] of Object.entries(en)) {
            expect(placeholders(catalogue[key] ?? ''), key).toEqual(placeholders(text));
        }
    });
});
