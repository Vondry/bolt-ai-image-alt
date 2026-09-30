<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt;

/**
 * Typed, validated view of `config/extensions/tvondracek-aialt.yaml`.
 */
final readonly class AiAltConfig
{
    public const FALLBACK_EMPTY = 'empty';
    public const FALLBACK_ENGLISH = 'english';
    public const TASKS = ['<CAPTION>', '<DETAILED_CAPTION>', '<MORE_DETAILED_CAPTION>'];
    private const DEFAULTS = [
        'enabled' => true,
        'auto_on_upload' => true,
        'prewarm_model' => true,
        'model' => 'onnx-community/Florence-2-base-ft',
        'task' => '<CAPTION>',
        'model_host' => 'https://huggingface.co',
        'thumbnail' => '768×768×max',
        'max_length' => 125,
        'fallback_without_translator' => self::FALLBACK_EMPTY,
        'contenttypes' => [
            'include' => [],
            'exclude' => [],
        ],
        'permissions' => [
            'batch_page' => 'ROLE_EDITOR',
        ],
    ];

    /**
     * @param list<string> $includeContentTypes
     * @param list<string> $excludeContentTypes
     */
    private function __construct(
        public bool $enabled,
        public bool $autoOnUpload,
        public bool $prewarmModel,
        public string $model,
        public string $task,
        public string $modelHost,
        public string $thumbnail,
        public int $maxLength,
        public string $fallbackWithoutTranslator,
        public array $includeContentTypes,
        public array $excludeContentTypes,
        public string $batchPagePermission,
    ) {
    }

    /**
     * @param array<array-key, mixed> $config raw (possibly partial) YAML config
     */
    public static function fromArray(array $config): self
    {
        $contentTypes = is_array($config['contenttypes'] ?? null) ? $config['contenttypes'] : [];
        $permissions = is_array($config['permissions'] ?? null) ? $config['permissions'] : [];

        $task = self::string($config, 'task', self::DEFAULTS['task']);
        if (! in_array($task, self::TASKS, true)) {
            $task = self::TASKS[0];
        }

        $fallback = self::string($config, 'fallback_without_translator', self::FALLBACK_EMPTY);
        if (! in_array($fallback, [self::FALLBACK_EMPTY, self::FALLBACK_ENGLISH], true)) {
            $fallback = self::FALLBACK_EMPTY;
        }

        $maxLength = $config['max_length'] ?? self::DEFAULTS['max_length'];
        $maxLength = is_numeric($maxLength) ? max(16, (int) $maxLength) : self::DEFAULTS['max_length'];

        $batchPermission = $permissions['batch_page'] ?? null;

        return new self(
            enabled: self::bool($config, 'enabled'),
            autoOnUpload: self::bool($config, 'auto_on_upload'),
            prewarmModel: self::bool($config, 'prewarm_model'),
            model: self::string($config, 'model', self::DEFAULTS['model']),
            task: $task,
            modelHost: rtrim(self::string($config, 'model_host', self::DEFAULTS['model_host']), '/'),
            thumbnail: self::string($config, 'thumbnail', self::DEFAULTS['thumbnail']),
            maxLength: $maxLength,
            fallbackWithoutTranslator: $fallback,
            includeContentTypes: self::stringList($contentTypes['include'] ?? []),
            excludeContentTypes: self::stringList($contentTypes['exclude'] ?? []),
            batchPagePermission: is_string($batchPermission) && $batchPermission !== ''
                ? $batchPermission
                : self::DEFAULTS['permissions']['batch_page'],
        );
    }

    public function isContentTypeAllowed(string $slug): bool
    {
        if (in_array($slug, $this->excludeContentTypes, true)) {
            return false;
        }

        return $this->includeContentTypes === [] || in_array($slug, $this->includeContentTypes, true);
    }

    /**
     * The part of the configuration the browser needs.
     *
     * @return array<string, mixed>
     */
    public function toClientArray(): array
    {
        return [
            'enabled' => $this->enabled,
            'autoOnUpload' => $this->autoOnUpload,
            'prewarmModel' => $this->prewarmModel,
            'model' => $this->model,
            'task' => $this->task,
            'modelHost' => $this->modelHost,
            'thumbnail' => $this->thumbnail,
            'maxLength' => $this->maxLength,
            'fallbackWithoutTranslator' => $this->fallbackWithoutTranslator,
        ];
    }

    /**
     * @param array<array-key, mixed> $config
     */
    private static function bool(array $config, string $key): bool
    {
        $value = $config[$key] ?? self::DEFAULTS[$key];

        return is_bool($value) ? $value : (bool) filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * @param array<array-key, mixed> $config
     */
    private static function string(array $config, string $key, string $default): string
    {
        $value = $config[$key] ?? null;

        return is_string($value) && trim($value) !== '' ? trim($value) : $default;
    }

    /**
     * @return list<string>
     */
    private static function stringList(mixed $value): array
    {
        if (is_string($value)) {
            $value = [$value];
        }

        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter($value, static fn ($item): bool => is_string($item) && $item !== ''));
    }
}
