import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = { '@shared': resolve(import.meta.dirname, 'src/shared') };

export default defineConfig({
  main: {
    resolve: { alias },
  },
  preload: {
    resolve: { alias },
  },
  renderer: {
    resolve: { alias: { ...alias, '@renderer': resolve(import.meta.dirname, 'src/renderer') } },
    plugins: [react()],
  },
});
