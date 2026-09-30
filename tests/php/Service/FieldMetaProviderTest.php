<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Tests\Service;

use Illuminate\Support\Collection;
use PHPUnit\Framework\TestCase;
use Tvondracek\AiAlt\Service\FieldMetaProvider;
use Tvondracek\AiAlt\Tests\Fixtures;

final class FieldMetaProviderTest extends TestCase
{
    public function testImageFieldsFollowBoltAltRules(): void
    {
        $meta = (new FieldMetaProvider())->forFields([
            'plain' => [
                'type' => 'image',
            ],
            'with_alt' => [
                'type' => 'image',
                'alt' => true,
                'localize' => true,
            ],
            'no_alt' => [
                'type' => 'image',
                'alt' => false,
            ],
            'gallery' => [
                'type' => 'imagelist',
                'alt' => false,
            ],
            'title' => [
                'type' => 'text',
            ],
            'file' => [
                'type' => 'file',
            ],
        ]);

        self::assertSame([
            'plain' => [
                'type' => 'image',
                'localized' => false,
            ],
            'with_alt' => [
                'type' => 'image',
                'localized' => true,
            ],
            'gallery' => [
                'type' => 'imagelist',
                'localized' => false,
            ],
        ], $meta);
    }

    public function testWorksWithBoltContentTypeCollections(): void
    {
        $fields = Fixtures::contentType()->get('fields');
        self::assertInstanceOf(Collection::class, $fields);

        self::assertSame([
            'image' => [
                'type' => 'image',
                'localized' => false,
            ],
            'gallery' => [
                'type' => 'imagelist',
                'localized' => true,
            ],
        ], (new FieldMetaProvider())->forFields($fields));
    }

    public function testCollectionsAndSetsWithImagesAreReported(): void
    {
        $fields = [
            'blocks' => [
                'type' => 'collection',
                'localize' => true,
                'fields' => [
                    'hero' => [
                        'type' => 'set',
                        'fields' => [
                            'photo' => [
                                'type' => 'image',
                            ],
                        ],
                    ],
                    'text' => [
                        'type' => 'html',
                    ],
                ],
            ],
            'teaser' => [
                'type' => 'set',
                'fields' => [
                    'icon' => [
                        'type' => 'image',
                        'alt' => false,
                    ],
                ],
            ],
            'broken' => [
                'type' => 'collection',
                'fields' => 'nope',
            ],
            'weird' => 'not a definition',
        ];

        $provider = new FieldMetaProvider();

        self::assertSame([
            'blocks' => [
                'type' => 'collection',
                'localized' => true,
            ],
        ], $provider->forFields($fields));
        self::assertSame([], $provider->batchableFields($fields), 'nested images are not batchable');
    }

    public function testBatchableFieldsAreTopLevelImages(): void
    {
        self::assertSame(
            ['image', 'gallery'],
            array_keys((new FieldMetaProvider())->batchableFields(Fixtures::contentType()->get('fields')))
        );
    }

    public function testIncludesAlt(): void
    {
        self::assertTrue(FieldMetaProvider::includesAlt(['type' => 'image']));
        self::assertTrue(FieldMetaProvider::includesAlt(['type' => 'image', 'alt' => true]));
        self::assertFalse(FieldMetaProvider::includesAlt(['type' => 'image', 'alt' => false]));
        self::assertFalse(FieldMetaProvider::includesAlt(['type' => 'image', 'alt' => 'yes']));
        self::assertTrue(FieldMetaProvider::includesAlt(['type' => 'imagelist', 'alt' => false]));
        self::assertFalse(FieldMetaProvider::includesAlt(['type' => 'text']));
        self::assertFalse(FieldMetaProvider::includesAlt([]));
    }
}
