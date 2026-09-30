import { Captioner, createModuleWorker, workerUrl } from './captioner';
import { BrowserFlorenceProvider } from './generate';
import { createTranslator, type Translate } from './i18n';
import { TranslatorService } from './translate';
import type { AiAltConfig } from './types';

export const CONFIG_ELEMENT_ID = 'ai-alt-config';

export function readConfig(doc: Document = document): AiAltConfig | null {
    const element = doc.getElementById(CONFIG_ELEMENT_ID);
    if (!element?.textContent) {
        return null;
    }

    try {
        const config = JSON.parse(element.textContent) as AiAltConfig;
        return config && typeof config === 'object' ? config : null;
    } catch (error) {
        console.error('[ai-alt] invalid config JSON', error);
        return null;
    }
}

export interface Services {
    captioner: Captioner;
    translator: TranslatorService;
    provider: BrowserFlorenceProvider;
    t: Translate;
}

export function createServices(config: AiAltConfig, onProgress?: (loaded: number, total: number) => void): Services {
    const origin = globalThis.location?.origin ?? '';
    const captioner = new Captioner(
        {
            model: config.model,
            // A path-style host (`/ai-alt-models`) is relative to Bolt's root, which may be a subdirectory.
            modelHost: config.modelHost.startsWith('/') ? origin + (config.basePath ?? '') + config.modelHost : config.modelHost,
            task: config.task,
            ortBase: `${origin}${config.assetBase}/ort`,
            onProgress,
        },
        () => createModuleWorker(workerUrl(config.assetBase, config.assetVersion)),
    );
    const translator = new TranslatorService();
    const provider = new BrowserFlorenceProvider(captioner, translator, {
        maxLength: config.maxLength,
        maxLengths: config.maxLengths,
        fallback: config.fallbackWithoutTranslator,
    });

    return { captioner, translator, provider, t: createTranslator(config.uiLocale) };
}
