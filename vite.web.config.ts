import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cspPlugin } from './tooling/csp-plugin';

// Builds the renderer as a standalone web app (no Electron). AI features that need
// local CLIs are disabled in this mode; local HTTP servers (Ollama, LM Studio) still work.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  plugins: [react(), cspPlugin('web')],
  worker: { format: 'es' },
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
