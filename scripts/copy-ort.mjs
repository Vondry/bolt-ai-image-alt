// Copies the ONNX Runtime WebAssembly files Transformers.js needs to
// `public/ort/`, so nothing is loaded from a CDN at runtime.
//
//  - `.asyncify` – the default build used by the WebGPU-enabled runtime
//  - plain       – fallback for Safari < 26 without WebGPU
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules/onnxruntime-web/dist');
const target = join(root, 'public/ort');
const files = [
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
];

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const file of files) {
    copyFileSync(join(source, file), join(target, file));
}

console.log(`Copied ${files.length} ONNX Runtime files to public/ort/: ${readdirSync(target).join(', ')}`);
