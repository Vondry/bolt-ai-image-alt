/**
 * Entry point for the Bolt content edit page (`public/ai-alt.js`).
 */
import { createServices, readConfig } from './bootstrap';
import { EditorController } from './editor';
import './ui.css';

export function boot(doc: Document = document): EditorController | null {
    const config = readConfig(doc);
    if (!config?.enabled) {
        return null;
    }

    // Observe the whole body: Vue mounts `#editor` after this script runs and
    // replaces the server-rendered form, so image inputs appear later.
    const root = doc.body;
    let controller: EditorController | null = null;
    const services = createServices(config, (loaded, total) => controller?.reportProgress(loaded, total));

    controller = new EditorController(root, config, {
        provider: services.provider,
        warmUp: () => services.captioner.init(),
        primeTranslator: languages => services.translator.prime(languages),
        isModelReady: () => services.captioner.isReady,
        t: services.t,
    });
    controller.start();

    return controller;
}

if (typeof document !== 'undefined' && !(globalThis as { __AI_ALT_TEST__?: boolean }).__AI_ALT_TEST__) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
    } else {
        boot();
    }
}
