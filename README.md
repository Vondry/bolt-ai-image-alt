# AI ALT for Bolt CMS

https://github.com/user-attachments/assets/b706fbfe-d8c0-4efb-8617-0157b935d4d7

Generates image ALT texts in the Bolt 6 admin, **in the editor's browser**:

- captions come from [Florence-2](https://huggingface.co/onnx-community/Florence-2-base-ft) running through
  [Transformers.js](https://huggingface.co/docs/transformers.js) (WebGPU, or WebAssembly as a fallback);
- Chrome's built-in [Translator API](https://developer.chrome.com/docs/ai/translator-api) translates them into
  the language of the content.

Image data never leaves the browser, and there are no API costs. Only the model weights are downloaded once from
Hugging Face (a few hundred MB) and cached by the browser.

## Features

- **"Generate ALT" button** under every image alt input (`image` fields without `alt: false`, and every
  `imagelist` item, including images inside collections and sets). The main click uses the configured `task`;
  its dropdown lets the editor pick a level of detail (short / detailed / very detailed) for that image.
- **Automatic generation** right after an image is uploaded, picked from the library or uploaded from a URL.
  An alt is filled **only if it is empty**, and never replaced if the editor typed something in the meantime.
- **Correct language**: localized fields use the edit locale, others use the ContentType's first locale or the site
  default (`%locale%`).
- **Batch page** (`/bolt/ai-alt/batch`, sidebar "AI ALT") to fill missing alts on existing content, one image at a
  time, with "review before saving" (on by default), pause/resume and an ETA.
- The generated text is marked in the editor ("AI – please review") until the editor edits it.
- UI in English, Czech, Slovak, German, French, Dutch, Italian, Spanish, Romanian, Ukrainian and Russian,
  following the backend user's language. Strings live in `assets/langs/<language>.json`; add a file to add a language.

## Installation

```bash
composer require tvondracek/bolt-ai-alt
bin/console extensions:configure
```

`extensions:configure` copies the prebuilt browser files to `public/extensions/ai-alt/`. Node.js is not needed on
the server. Run it again after every update of the extension.

## Configuration

`config/extensions/tvondracek-aialt.yaml` (created on first use; see [config/config.yaml](config/config.yaml) for
all options):

```yaml
enabled: true
auto_on_upload: true          # false = button only
prewarm_model: true           # start loading the model when an edit page opens
model: onnx-community/Florence-2-base-ft
task: '<CAPTION>'             # default level; '<DETAILED_CAPTION>' / '<MORE_DETAILED_CAPTION>' = longer, slower
model_host: https://huggingface.co
thumbnail: '768×768×max'
max_length:                   # per level; a single number limits the default `task` only
  '<CAPTION>': 125
  '<DETAILED_CAPTION>': 250
  '<MORE_DETAILED_CAPTION>': 400
fallback_without_translator: empty   # empty | english
contenttypes:
  include: []
  exclude: []
permissions:
  batch_page: ROLE_EDITOR
```

Saving from the batch page also requires the `edit` permission on each record.

### Browser support

| Browser | Captioning | Translation |
|---|---|---|
| Chrome / Edge desktop (138+) | WebGPU | Translator API (the language pack downloads after the first click) |
| Firefox, Safari | WebGPU or WASM | none → `fallback_without_translator` |
| Mobile | slow or unavailable | none |

Without WebGPU the model runs on WebAssembly **single-threaded**: the Bolt admin isn't cross-origin isolated
(no `COOP`/`COEP` headers), so ONNX Runtime can't use worker threads. Expect several seconds per image there.
GPUs without `shader-f16` get fp32 weights; if WebGPU fails anyway, the worker falls back to WebAssembly.
A caption that takes longer than 3 minutes is aborted and the model reloaded, so a hung GPU can't block the queue.

When no translator is available, the alt stays empty by default and the chip says so. With
`fallback_without_translator: english` the English caption is written and marked "EN – please translate".
English sites need no translator.

### Content Security Policy

Bolt sets no CSP. If your hosting adds one, the admin needs:

```
script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://huggingface.co https://*.hf.co
```

(`connect-src` for Hugging Face is not needed with self-hosted weights, see `model_host`.)

### Self-hosted model weights

Download the model repository (`config.json`, `preprocessor_config.json`, `tokenizer*.json`,
`generation_config.json`, `onnx/*.onnx`) into e.g. `public/ai-alt-models/onnx-community/Florence-2-base-ft/` and set
`model_host: /ai-alt-models`. Don't use `public/extensions/ai-alt/`, because `extensions:configure` replaces it.

`model_host` is read like this: a bare origin (`https://huggingface.co`, or a mirror like `https://hf-mirror.com`)
uses the Hub layout `{model}/resolve/main/…`; a URL with a path (`/ai-alt-models`,
`https://cdn.example.com/models`) is a plain copy, `{model}/…`. If Bolt runs in a subdirectory, include it
(`/cms/ai-alt-models`). The extension's own assets and thumbnails follow the subdirectory automatically.

## Limitations

- Captions come from a small model: they are generic, and sometimes wrong (a kangaroo may become a deer). Review them.
- The batch page covers top-level `image` / `imagelist` fields; images inside collections and sets are only
  handled in the editor.
- The batch page runs only while its tab is open. Open it again later to continue: finished images drop out of the
  list.
- Bolt's `Media` entity has no alt, so only content fields are filled.

## Development

```bash
composer install
npm install

npm run build          # assets/ → public/ (commit the result)
npm run typecheck
npm run lint           # ESLint + typescript-eslint + SonarJS (lint:fix to autofix)
npm run format         # Prettier (format:check in CI)
npm test               # Vitest (jsdom)
npm run test:coverage

vendor/bin/phpunit     # composer test:coverage for a coverage report
vendor/bin/ecs check src tests/php
vendor/bin/phpstan analyse --memory-limit=1G
vendor/bin/rector process --dry-run
```

To try it in a Bolt project from a local checkout:

```bash
composer config repositories.ai-alt '{"type":"path","url":"../bolt-ai-image-alt"}'
composer require tvondracek/bolt-ai-alt:@dev
bin/console extensions:configure
```

### Layout

| Path | What |
|---|---|
| `src/Widget/AiAltWidget.php` | Injects `#ai-alt-config` + `ai-alt.js` before `</body>` on edit pages |
| `src/Controller/BatchController.php` | Batch page, `missing` (JSON), `save` (JSON, CSRF + `edit` permission, 409 when already filled) |
| `src/Service/*` | Field metadata, locale rules, finder and writer for missing alts |
| `assets/fields.ts` | The only place that knows Bolt's `Image.vue` markup |
| `assets/editor.ts` | Buttons, observers, sequential queue, write-back, save notice |
| `assets/worker.ts` | Florence-2 in a module Web Worker |
| `assets/translate.ts` | Translator API wrapper |
| `assets/generate.ts` | `AltProvider` interface (the seam for server-side providers) |

## License

MIT
