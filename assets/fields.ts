/**
 * All coupling to Bolt's `Image.vue` DOM lives here. If the Bolt admin changes
 * its markup (e.g. a Vue 3 rewrite), this is the file to adapt.
 *
 *  - `{name}[filename]` – text input, `:value` bound, set by upload / library pick
 *  - `{name}[alt]`      – text input, `v-model="altData"`
 *  - `{name}[media]`    – hidden input
 */

export interface ImageFieldPair {
    /** `fields[image]`, `fields[gallery][2]`, `collections[blocks][image][0]` … */
    prefix: string;
    alt: HTMLInputElement;
    filename: HTMLInputElement;
}

const ALT_SUFFIX = '[alt]';

export function prefixOf(altInputName: string): string | null {
    return altInputName.endsWith(ALT_SUFFIX) ? altInputName.slice(0, -ALT_SUFFIX.length) : null;
}

export function findImageFields(root: ParentNode): ImageFieldPair[] {
    const pairs: ImageFieldPair[] = [];

    root.querySelectorAll<HTMLInputElement>('input[name$="[alt]"]').forEach(alt => {
        const prefix = prefixOf(alt.name);
        if (prefix === null) {
            return;
        }

        const filename = findSibling(alt, `${prefix}[filename]`);
        if (filename) {
            pairs.push({ prefix, alt, filename });
        }
    });

    return pairs;
}

function findSibling(alt: HTMLInputElement, name: string): HTMLInputElement | null {
    const selector = `input[name="${cssEscape(name)}"]`;
    const container = alt.closest('.editor__image');

    return container?.querySelector<HTMLInputElement>(selector) ?? alt.form?.querySelector<HTMLInputElement>(selector) ?? null;
}

function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/**
 * Set the value so Vue notices: without the `input` event `v-model` keeps the
 * old `altData` and re-renders it on the next update.
 */
export function writeAlt(input: HTMLInputElement, text: string): void {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function isEmpty(input: HTMLInputElement): boolean {
    return input.value.trim() === '';
}
