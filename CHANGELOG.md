# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The `@ai-alt` Twig namespace is also registered at container level, in
  `config/services.yaml`, so the templates resolve on the CLI too (`lint:twig`,
  `cache:warmup`). Run `bin/console extensions:configure` after the update.

### Development

- CI uses the same workflows as the other extensions: PHPUnit runs in its own
  workflow on PHP 8.2 to 8.5 with a syntax check and at least 95 % line
  coverage; ECS, `composer validate`, `composer audit` and actionlint run once;
  newer pushes cancel older runs.
- `SECURITY.md`, this changelog, and `support` and `funding` in `composer.json`.

## [1.0.4] - 2026-11-22

### Changed

- `composer require` no longer installs the tests, CI, tool configuration,
  TypeScript/CSS sources or build scripts. `assets/langs/`, which the extension
  reads at runtime, and the built files in `public/` still ship.

### Fixed

- Composer no longer installs the extension next to a `bolt/core` outside 6.x
  (`conflict: <6.0 || >=7.0`).

### Development

- PHPStan adds `phpstan-strict-rules` and `phpstan-phpunit`; ECS and Rector
  check the tests too, and PHPUnit runs in random order and fails on warnings,
  notices and deprecations.
- ECS, PHPStan, PHPUnit and Rector use the same configuration as the other
  extensions, and GitHub Actions are pinned to commit SHAs.

## [1.0.3] - 2026-11-21

### Development

- Build and test tools updated (Vite 8.3.8, ESLint 10.15, Vitest 5.1.1). The
  shipped files in `public/` are byte-identical to 1.0.2.

## [1.0.2] - 2026-11-21

### Development

- Development tools updated; Dependabot proposes updates to the Composer and
  npm dependencies and GitHub Actions once a month.

## [1.0.1] - 2026-10-30

### Changed

- `@huggingface/transformers` 4.3.0 → 4.3.2 in the bundled worker;
  `symfony/polyfill-php84` is now `^1.43.0`.
- ContentType `fields` and `contenttypes` entries whose key isn't a name are
  skipped instead of being cast to a string.

### Development

- PHPStan runs at level max (was 8), for `src/` and the tests.

## [1.0.0] - 2026-09-30

### Added

- First release: image ALT texts generated in the editor's browser with
  Florence-2 (Transformers.js, WebGPU or WebAssembly) and translated with
  Chrome's Translator API. "Generate ALT" buttons, a level of detail, automatic
  generation after upload, a batch page for missing alts, an "AI – please
  review" marker and a UI in 11 languages.

[Unreleased]: https://github.com/Vondry/bolt-ai-image-alt/compare/v1.0.4...HEAD
[1.0.4]: https://github.com/Vondry/bolt-ai-image-alt/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Vondry/bolt-ai-image-alt/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Vondry/bolt-ai-image-alt/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Vondry/bolt-ai-image-alt/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Vondry/bolt-ai-image-alt/releases/tag/v1.0.0
