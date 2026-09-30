import { describe, expect, it } from 'vitest';
import {
    capitalize,
    cleanCaption,
    finalize,
    isCaptionable,
    isTooSmall,
    stripFiller,
    thumbnailUrl,
    truncate,
} from '../../assets/postprocess';

describe('stripFiller', () => {
    it.each([
        ['An image of a red car parked on a street', 'a red car parked on a street'],
        ['a photograph showing two dogs', 'two dogs'],
        ['The picture shows a mountain lake', 'a mountain lake'],
        ['A close-up photo of a flower', 'a flower'],
        ['There is a yellow excavator on a construction site', 'a yellow excavator on a construction site'],
        ['there are three people', 'three people'],
        ['In this image we can see a cat', 'a cat'],
        ['The image depicts an image of a boat', 'a boat'],
        ['A red car', 'A red car'],
    ])('%s → %s', (input, expected) => {
        expect(stripFiller(input)).toBe(expected);
    });

    it('never strips everything', () => {
        expect(stripFiller('There is ')).toBe('There is');
    });
});

describe('truncate', () => {
    it('keeps short text', () => {
        expect(truncate('short', 10)).toBe('short');
    });

    it('cuts at a word boundary', () => {
        expect(truncate('one two three four', 12)).toBe('one two');
    });

    it('prefers ending after a whole sentence', () => {
        expect(truncate('A brown dog on a sandy beach. It runs after a ball', 40)).toBe('A brown dog on a sandy beach');
        expect(truncate('A dog on a beach. The dog is brown! It runs after a ball', 40)).toBe('A dog on a beach. The dog is brown');
    });

    it('cuts at a word when the only sentence end would drop most of the text', () => {
        expect(truncate('Hi. A brown dog runs after a red ball on a sandy beach', 30)).toBe('Hi. A brown dog runs after a');
    });

    it('hard-cuts a single long word', () => {
        expect(truncate('abcdefghijklmnop', 5)).toBe('abcde');
    });

    it('drops trailing punctuation after the cut', () => {
        expect(truncate('alpha beta, gamma delta', 12)).toBe('alpha beta');
    });
});

describe('finalize / cleanCaption', () => {
    it('capitalizes, collapses whitespace and drops the trailing period', () => {
        expect(finalize('  a   yellow excavator.  ')).toBe('A yellow excavator');
        expect(capitalize('čerpadlo')).toBe('Čerpadlo');
    });

    it('cleans Florence output', () => {
        expect(cleanCaption('</s><s>An image of a yellow excavator digging a hole.</s>')).toBe('A yellow excavator digging a hole');
    });

    it('caps the length', () => {
        const long = 'A ' + 'very '.repeat(40) + 'long caption';
        const result = cleanCaption(long, 50);
        expect(result.length).toBeLessThanOrEqual(50);
        expect(result.endsWith(' ')).toBe(false);
    });
});

describe('image checks', () => {
    it('only accepts formats Bolt can thumbnail, minus SVG', () => {
        for (const file of ['a.gif', 'a.png', 'a.JPG', 'a.jpeg', 'a.avif', 'a.webp', 'photo.jpg?x=1.svg']) {
            expect(isCaptionable(file), file).toBe(true);
        }
        for (const file of ['logo.svg', 'logo.SVGZ', 'scan.bmp', 'scan.tif', 'photo.heic', 'noextension', '  ']) {
            expect(isCaptionable(file), file).toBe(false);
        }
    });

    it('detects tiny images', () => {
        expect(isTooSmall(31, 100)).toBe(true);
        expect(isTooSmall(100, 10)).toBe(true);
        expect(isTooSmall(32, 32)).toBe(false);
    });

    it('builds Glide thumbnail URLs', () => {
        expect(thumbnailUrl('2024/05/my photo#1.jpg', '768×768×max')).toBe('/thumbs/768×768×max/2024/05/my%20photo%231.jpg');
        expect(thumbnailUrl('/a.jpg', '10×10')).toBe('/thumbs/10×10/a.jpg');
        expect(thumbnailUrl('a.jpg', '10×10', '/cms/thumbs/')).toBe('/cms/thumbs/10×10/a.jpg');
    });
});
