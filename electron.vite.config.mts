import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = { '@shared': resolve(import.meta.dirname, 'src/shared') };

export default defineConfig({
  main: {
    resolve: { alias },
    // cli.js is the `yantra` command's client (bin/yantra.js loads it).
    build: { rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/main/index.ts'), cli: resolve(import.meta.dirname, 'src/cli/index.ts') } } },
  },
  preload: {
    resolve: { alias },
  },
  renderer: {
    resolve: { alias: { ...alias, '@renderer': resolve(import.meta.dirname, 'src/renderer') } },
    plugins: [react()],
  },
});
