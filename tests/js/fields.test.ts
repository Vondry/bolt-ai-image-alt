import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findImageFields, isEmpty, prefixOf, writeAlt } from '../../assets/fields';
import { imageFieldHtml } from './helpers';

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('field pairing', () => {
    it('pairs alt and filename inputs for image and imagelist items', () => {
        document.body.innerHTML = `<form id="editcontent">
            ${imageFieldHtml('fields[image]', 'a.jpg')}
            ${imageFieldHtml('fields[gallery][0]', 'b.jpg', 'B')}
            ${imageFieldHtml('fields[gallery][1]')}
            ${imageFieldHtml('collections[blocks][photo][2]', 'c.jpg')}
            <input name="fields[orphan][alt]">
            <input name="fields[title]">
        </form>`;

        const pairs = findImageFields(document);

        expect(pairs.map(pair => pair.prefix)).toEqual([
            'fields[image]',
            'fields[gallery][0]',
            'fields[gallery][1]',
            'collections[blocks][photo][2]',
        ]);
        expect(pairs[0]!.filename.value).toBe('a.jpg');
        expect(pairs[1]!.alt.value).toBe('B');
    });

    it('finds the filename input outside the .editor__image container via the form', () => {
        document.body.innerHTML = `<form>
            <input name="fields[image][filename]" value="x.jpg">
            <input name="fields[image][alt]">
        </form>`;

        expect(findImageFields(document)[0]?.filename.value).toBe('x.jpg');
    });

    it('escapes names without CSS.escape', () => {
        const original = globalThis.CSS;
        vi.stubGlobal('CSS', undefined);
        document.body.innerHTML = imageFieldHtml('fields[image]', 'x.jpg');

        expect(findImageFields(document)).toHaveLength(1);
        vi.stubGlobal('CSS', original);
    });

    it('prefixOf', () => {
        expect(prefixOf('fields[image][alt]')).toBe('fields[image]');
        expect(prefixOf('fields[image][filename]')).toBeNull();
    });
});

describe('writeAlt', () => {
    it('sets the value and dispatches a bubbling input event for Vue', () => {
        document.body.innerHTML = imageFieldHtml('fields[image]', 'x.jpg');
        const input = findImageFields(document)[0]!.alt;
        const listener = vi.fn((event: Event) => event.bubbles);
        document.body.addEventListener('input', listener);

        expect(isEmpty(input)).toBe(true);
        writeAlt(input, 'A dog');

        expect(input.value).toBe('A dog');
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.results[0]!.value).toBe(true);
        expect(isEmpty(input)).toBe(false);
    });
});
