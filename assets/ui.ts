export type ChipState = 'idle' | 'busy' | 'ok' | 'warn' | 'error';

export interface FieldUi {
    root: HTMLElement;
    button: HTMLButtonElement;
    chip: HTMLElement;
    setChip(state: ChipState, text?: string): void;
    setBusy(busy: boolean): void;
}

export function createFieldUi(doc: Document, label: string, title: string): FieldUi {
    const root = doc.createElement('div');
    root.className = 'ai-alt-controls';

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-tertiary ai-alt-button';
    button.title = title;
    const icon = doc.createElement('i');
    icon.className = 'fas fa-fw fa-magic';
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon, doc.createTextNode(` ${label}`));

    const chip = doc.createElement('span');
    chip.className = 'ai-alt-chip';
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-live', 'polite');
    chip.hidden = true;

    root.append(button, chip);

    return {
        root,
        button,
        chip,
        setChip(state, text = '') {
            chip.dataset.state = state;
            chip.textContent = text;
            chip.hidden = state === 'idle' || text === '';
        },
        setBusy(busy) {
            button.disabled = busy;
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
