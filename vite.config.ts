import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * ONNX Runtime refers to its .wasm via `new URL('…wasm', import.meta.url)`,
 * which makes Vite emit a second 27 MB copy. We always set `wasmPaths` to the
 * self-hosted files in `public/ort/`, so turn those references into plain
 * strings.
 */
function skipOrtWasmAsset(): Plugin {
    return {
        name: 'ai-alt:skip-ort-wasm-asset',
        enforce: 'pre',
        transform(code, id) {
            if (!id.includes('onnxruntime-web')) {
                return null;
            }

            return code.replace(/new URL\((["'])(ort-wasm[\w.-]*\.wasm)\1,\s*import\.meta\.url\)/g, 'new URL($1$2$1, self.location.href)');
        },
    };
}

// Builds straight into `public/`, which is committed so production needs no Node.
export default defineConfig({
    plugins: [skipOrtWasmAsset()],
    publicDir: false,
    build: {
        outDir: 'public',
        emptyOutDir: true,
        target: 'es2022',
        cssCodeSplit: false,
        sourcemap: false,
        modulePreload: false,
        chunkSizeWarningLimit: 4096,
        rollupOptions: {
            input: {
                'ai-alt': resolve(import.meta.dirname, 'assets/main.ts'),
                'ai-alt-batch': resolve(import.meta.dirname, 'assets/batch.ts'),
                'ai-alt.worker': resolve(import.meta.dirname, 'assets/worker.ts'),
            },
            output: {
                format: 'es',
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: assetInfo =>
                    assetInfo.names?.some(name => name.endsWith('.css')) ? 'ai-alt.css' : 'assets/[name]-[hash][extname]',
            },
        },
    },
    test: {
        environment: 'jsdom',
        include: ['tests/js/**/*.test.ts'],
        setupFiles: ['tests/js/setup.ts'],
        coverage: {
            provider: 'v8',
            include: ['assets/**/*.ts'],
            // main.ts/batch.ts auto-boot only outside tests.
            exclude: ['assets/types.ts'],
            thresholds: { lines: 95, statements: 95, functions: 95, branches: 85 },
            reporter: ['text', 'html', 'lcov'],
            reportsDirectory: 'var/coverage/js',
        },
    },
});
