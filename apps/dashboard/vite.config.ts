import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), build: { outDir: fileURLToPath(new URL('../../dist/dashboard', import.meta.url)), emptyOutDir: true }, server: { host: '127.0.0.1' } });
