<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt;

use Bolt\Extension\BaseExtension;
use Throwable;
use Tomvondracek\AiAlt\Widget\AiAltWidget;

class Extension extends BaseExtension
{
    private ?AiAltConfig $aiAltConfig = null;

    public function getName(): string
    {
        return 'AI ALT';
    }

    public function initialize(): void
    {
        $this->addTwigNamespace('ai-alt');

        if ($this->getAiAltConfig()->enabled) {
            $this->addWidget(new AiAltWidget());
        }
    }

    /**
     * Runs on `composer require` / `bin/console extensions:configure`: copies
     * the prebuilt JS, CSS and WASM files to `public/extensions/ai-alt/`.
     */
    public function install(): void
    {
        (new AssetInstaller())->install($this->getBoltConfig()->getPath('web'));
    }

    public function getAiAltConfig(): AiAltConfig
    {
        return $this->aiAltConfig ??= AiAltConfig::fromArray($this->getConfig()->all());
    }

    public function getSiteDefaultLocale(): string
    {
        try {
            $locale = $this->getContainer()
                ->getParameter('locale');
        } catch (Throwable) {
            $locale = null;
        }

        return is_string($locale) && $locale !== '' ? $locale : 'en';
    }

    /**
     * Cache-busting token for the browser assets, changes with every build.
     */
    public static function assetVersion(): string
    {
        $mtime = @filemtime(AssetInstaller::sourceDirectory() . '/ai-alt.js');

        return $mtime === false ? '' : (string) $mtime;
    }
}
