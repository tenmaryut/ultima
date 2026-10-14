import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { cspPlugin } from './tooling/csp-plugin';

const shared = resolve(__dirname, 'src/shared');

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared,
      },
    },
    plugins: [react(), cspPlugin('desktop')],
    worker: { format: 'es' },
    build: {
      chunkSizeWarningLimit: 4000,
    },
  },
});
