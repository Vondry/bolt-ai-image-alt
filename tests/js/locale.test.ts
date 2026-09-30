import { describe, expect, it } from 'vitest';
import { baseLanguage, readEditLocale, resolveTargetLocale, topLevelFieldName } from '../../assets/locale';
import type { FieldMeta } from '../../assets/types';

const meta: Record<string, FieldMeta> = {
    image: { type: 'image', localized: false },
    gallery: { type: 'imagelist', localized: true },
    blocks: { type: 'collection', localized: true },
};

describe('baseLanguage', () => {
    it.each([
        ['cs_CZ', 'cs'],
        ['pt-BR', 'pt'],
        [' EN ', 'en'],
        ['', ''],
        [null, ''],
        [undefined, ''],
    ])('%s → %s', (input, expected) => {
        expect(baseLanguage(input)).toBe(expected);
    });
});

describe('topLevelFieldName', () => {
    it.each([
        ['fields[image][alt]', 'image'],
        ['fields[gallery][3][alt]', 'gallery'],
        ['collections[blocks][photo][0][alt]', 'blocks'],
        ['sets[teaser][icon][alt]', 'teaser'],
        ['alt', null],
    ])('%s → %s', (input, expected) => {
        expect(topLevelFieldName(input)).toBe(expected);
    });
});

describe('resolveTargetLocale', () => {
    it('uses the edit locale for localized fields', () => {
        expect(resolveTargetLocale('fields[gallery][0][alt]', meta, 'en', 'cs')).toBe('en');
        expect(resolveTargetLocale('collections[blocks][x][0][alt]', meta, 'nl_BE', 'cs')).toBe('nl');
    });

    it('uses the default locale for non-localized fields', () => {
        expect(resolveTargetLocale('fields[image][alt]', meta, 'en', 'cs_CZ')).toBe('cs');
        expect(resolveTargetLocale('fields[unknown][alt]', meta, 'en', 'cs')).toBe('cs');
    });

    it('falls back sensibly', () => {
        expect(resolveTargetLocale('fields[gallery][0][alt]', meta, null, 'cs')).toBe('cs');
        expect(resolveTargetLocale('fields[image][alt]', meta, 'de', null)).toBe('de');
        expect(resolveTargetLocale('fields[image][alt]', meta, null, null)).toBe('en');
        expect(resolveTargetLocale('fields[image][alt]', meta, null, '')).toBe('en');
    });
});

describe('readEditLocale', () => {
    it('reads the hidden _edit_locale input', () => {
        document.body.innerHTML = '<form><input type="hidden" name="_edit_locale" value="cs"></form>';
        expect(readEditLocale()).toBe('cs');
    });

    it('returns null when missing or empty', () => {
        document.body.innerHTML = '<input type="hidden" name="_edit_locale" value="">';
        expect(readEditLocale()).toBeNull();
        document.body.innerHTML = '';
        expect(readEditLocale()).toBeNull();
    });
});
