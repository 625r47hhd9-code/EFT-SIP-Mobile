import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        react: resolve(import.meta.dirname, 'react.html'),
        legacy: resolve(import.meta.dirname, 'legacy-v45.html')
      }
    }
  }
});
