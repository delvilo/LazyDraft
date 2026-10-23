import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogue } from './src/catalogue.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const input = { hub: resolve(root, 'index.html') };
for (const id of Object.keys(catalogue)) input[id] = resolve(root, id, 'index.html');

export default defineConfig({
  root,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    target: 'es2022',
    rollupOptions: { input },
  },
});
