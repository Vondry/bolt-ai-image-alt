// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['public/**', 'var/**', 'vendor/**', 'node_modules/**'],
    },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    sonarjs.configs.recommended,
    {
        languageOptions: {
            globals: { ...globals.browser, ...globals.worker },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        },
    },
    {
        // Mocks: `async () => value` fakes, `expect(obj.method)` assertions.
        files: ['tests/js/**/*.ts'],
        rules: {
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/unbound-method': 'off',
        },
    },
    {
        files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        files: ['**/*.{js,mjs}'],
        extends: [tseslint.configs.disableTypeChecked],
    },
    // Last: turns off every rule that would fight with Prettier's formatting.
    prettier,
);
