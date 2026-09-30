<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt;

use Bolt\Configuration\Config;
use Symfony\Component\Yaml\Yaml;

/**
 * Loads the extension config outside of the Extension object (controllers and
 * services can't use `BaseExtension::getConfig()`, which derives the filename
 * from the calling class's namespace).
 *
 * Same resolution as Bolt's `ConfigTrait`: the project's
 * `config/extensions/tomvondracek-aialt.yaml`, overridden by `…_local.yaml`,
 * falling back to the defaults shipped with the package.
 */
class AiAltConfigLoader
{
    public const CONFIG_BASENAME = 'tomvondracek-aialt';

    private ?AiAltConfig $config = null;

    public function __construct(
        private readonly Config $boltConfig,
    ) {
    }

    public function load(): AiAltConfig
    {
        if ($this->config instanceof AiAltConfig) {
            return $this->config;
        }

        $directory = $this->boltConfig->getPath('extensions_config');
        $main = $directory . DIRECTORY_SEPARATOR . self::CONFIG_BASENAME . '.yaml';
        $local = $directory . DIRECTORY_SEPARATOR . self::CONFIG_BASENAME . '_local.yaml';

        $files = is_readable($main) ? [$main, $local] : [self::defaultConfigFile(), $local];

        return $this->config = AiAltConfig::fromArray(self::parseFiles($files));
    }

    public static function defaultConfigFile(): string
    {
        return dirname(__DIR__) . '/config/config.yaml';
    }

    /**
     * @param list<string> $files
     *
     * @return array<array-key, mixed>
     */
    public static function parseFiles(array $files): array
    {
        $config = [];

        foreach ($files as $file) {
            if (! is_readable($file)) {
                continue;
            }

            $parsed = Yaml::parseFile($file);
            if (is_array($parsed)) {
                $config = array_merge($config, $parsed);
            }
        }

        return $config;
    }
}
