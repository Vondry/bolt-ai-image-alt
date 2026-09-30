export type ChipState = 'idle' | 'busy' | 'ok' | 'warn' | 'error';

export interface MenuItem {
    value: string;
    label: string;
    /** Small muted text after the label, e.g. "default". */
    hint?: string;
}

export interface FieldMenu {
    /** Accessible name of the dropdown toggle. */
    label: string;
    items: MenuItem[];
    onPick: (value: string) => void;
}

export interface FieldUi {
    root: HTMLElement;
    button: HTMLButtonElement;
    toggle: HTMLButtonElement;
    menu: HTMLElement;
    chip: HTMLElement;
    setChip(state: ChipState, text?: string): void;
    setBusy(busy: boolean): void;
}

/**
 * Split button (Bootstrap 5 markup): the main part generates with the default
 * level, the toggle opens a menu with all levels. Opening and closing is done
 * here, not by Bootstrap's JS, which doesn't reliably see injected elements.
 */
export function createFieldUi(doc: Document, label: string, title: string, fieldMenu: FieldMenu): FieldUi {
    const root = doc.createElement('div');
    root.className = 'ai-alt-controls';

    const group = doc.createElement('div');
    group.className = 'btn-group ai-alt-split';

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-tertiary ai-alt-button';
    button.title = title;
    const icon = doc.createElement('i');
    icon.className = 'fas fa-fw fa-magic';
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon, doc.createTextNode(` ${label}`));

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-sm btn-tertiary dropdown-toggle dropdown-toggle-split ai-alt-toggle';
    toggle.title = fieldMenu.label;
    toggle.setAttribute('aria-label', fieldMenu.label);
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');

    const menu = doc.createElement('div');
    menu.className = 'dropdown-menu ai-alt-menu';
    menu.setAttribute('role', 'menu');

    const items = fieldMenu.items.map(item => {
        const option = doc.createElement('button');
        option.type = 'button';
        option.className = 'dropdown-item';
        option.setAttribute('role', 'menuitem');
        option.dataset.value = item.value;
        option.textContent = item.label;
        if (item.hint) {
            const hint = doc.createElement('span');
            hint.className = 'ai-alt-menu__hint';
            hint.textContent = item.hint;
            option.append(' ', hint);
        }
        option.addEventListener('click', () => {
            setOpen(false);
            fieldMenu.onPick(item.value);
        });

        return option;
    });
    menu.append(...items);

    const onOutsideClick = (event: Event): void => {
        if (!group.contains(event.target as Node)) {
            setOpen(false);
        }
    };

    function setOpen(open: boolean): void {
        menu.classList.toggle('show', open);
        toggle.setAttribute('aria-expanded', String(open));
        if (open) {
            doc.addEventListener('click', onOutsideClick, true);
        } else {
            doc.removeEventListener('click', onOutsideClick, true);
        }
    }

    toggle.addEventListener('click', () => {
        const open = !menu.classList.contains('show');
        setOpen(open);
        if (open) {
            items[0]?.focus();
        }
    });

    group.addEventListener('keydown', event => {
        if (!menu.classList.contains('show')) {
            return;
        }
        if (event.key === 'Escape') {
            setOpen(false);
            toggle.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const current = items.indexOf(doc.activeElement as HTMLButtonElement);
            const step = event.key === 'ArrowDown' ? 1 : -1;
            items[(current + step + items.length) % items.length]?.focus();
        }
    });

    group.append(button, toggle, menu);

    const chip = doc.createElement('span');
    chip.className = 'ai-alt-chip';
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-live', 'polite');
    chip.hidden = true;

    root.append(group, chip);

    return {
        root,
        button,
        toggle,
        menu,
        chip,
        setChip(state, text = '') {
            chip.dataset.state = state;
            chip.textContent = text;
            chip.hidden = state === 'idle' || text === '';
        },
        setBusy(busy) {
            button.disabled = busy;
            toggle.disabled = busy;
            if (busy) {
                setOpen(false);
            }
            root.classList.toggle('is-busy', busy);
        },
    };
}

export function showNotice(doc: Document, text: string, timeout = 6000): HTMLElement {
    const notice = doc.createElement('div');
    notice.className = 'ai-alt-notice alert alert-warning';
    notice.setAttribute('role', 'alert');
    notice.textContent = text;
    doc.body.append(notice);
    setTimeout(() => notice.remove(), timeout);

    return notice;
}
