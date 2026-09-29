import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'webview', base: './', plugins: [react()],
  build: { outDir: '../dist/webview', emptyOutDir: true, target: 'chrome128', sourcemap: false },
});
