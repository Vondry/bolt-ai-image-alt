/**
 * Clean-up of Florence-2 captions, applied before translation.
 */

const FILLER_PREFIXES: RegExp[] = [
    /^(?:in\s+)?(?:this|the)\s+(?:image|picture|photo(?:graph)?)\s+we\s+can\s+see\s+/i,
    /^(?:in\s+)?(?:this|the)\s+(?:image|picture|photo(?:graph)?)\s+(?:shows?|depicts?|features?)\s+/i,
    /^(?:an?|the)\s+(?:close[- ]up\s+)?(?:image|picture|photo(?:graph)?)\s+(?:of|showing|shows|depicting)\s+/i,
    /^there\s+(?:is|are)\s+/i,
];

export const DEFAULT_MAX_LENGTH = 125;

export function stripFiller(text: string): string {
    let result = text.trim();
    let changed = true;

    // Apply repeatedly: "The image shows an image of…" happens.
    while (changed) {
        changed = false;
        for (const pattern of FILLER_PREFIXES) {
            const next = result.replace(pattern, '');
            if (next !== result && next.trim() !== '') {
                result = next.trim();
                changed = true;
            }
        }
    }

    return result;
}

export function capitalize(text: string): string {
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/**
 * Cut to `maxLength` characters, preferably after a whole sentence (detailed
 * captions have several), else at a word boundary.
 */
export function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }

    const cut = text.slice(0, maxLength + 1);
    const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    if (sentenceEnd > maxLength * 0.5) {
        return cut.slice(0, sentenceEnd);
    }

    const lastSpace = cut.lastIndexOf(' ');
    const shortened = lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : text.slice(0, maxLength);

    return trimTrailing(shortened, /[\s,;:–-]/u);
}

/**
 * Drops trailing characters that match `char` (a one-character pattern).
 * Linear, unlike `/[…]+$/`, which backtracks on long input.
 */
export function trimTrailing(text: string, char: RegExp): string {
    let end = text.length;
    while (end > 0 && char.test(text.charAt(end - 1))) {
        end--;
    }

    return text.slice(0, end);
}

export function finalize(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
    const collapsed = text.replace(/\s+/gu, ' ').trim();
    const withoutPeriod = trimTrailing(collapsed, /\./).trim();

    return truncate(capitalize(withoutPeriod), maxLength);
}

/** Florence caption → alt text in English (before translation). */
export function cleanCaption(raw: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
    const withoutTokens = raw.replace(/<\/?s>|<pad>/g, ' ').replace(/\s+/g, ' ');

    return finalize(stripFiller(withoutTokens), maxLength);
}

/**
 * Formats Bolt's `/thumbs` route renders, minus SVG (no raster data for the
 * model). Anything else gets Bolt's "404" placeholder. Mirrors
 * `AltValue::CAPTIONABLE_EXTENSIONS` on the PHP side.
 */
export const CAPTIONABLE_EXTENSIONS = new Set(['gif', 'png', 'jpg', 'jpeg', 'avif', 'webp']);

export function isCaptionable(filename: string): boolean {
    const clean = filename.split(/[?#]/)[0] ?? '';
    const extension = clean.includes('.') ? (clean.split('.').pop() ?? '').toLowerCase() : '';

    return CAPTIONABLE_EXTENSIONS.has(extension);
}

export const MIN_IMAGE_SIZE = 32;

export function isTooSmall(width: number, height: number): boolean {
    return width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE;
}

/**
 * Bolt's Glide thumbnail URL, e.g. `/thumbs/768×768×max/2024/05/foo bar.jpg`.
 * `base` includes Bolt's base path when it runs in a subdirectory (`/cms/thumbs`).
 */
export function thumbnailUrl(filename: string, spec: string, base = '/thumbs'): string {
    const path = filename
        .replace(/^\/+/, '')
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');

    return `${trimTrailing(base, /\//)}/${spec}/${path}`;
}
