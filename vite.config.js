import { defineConfig } from 'vite';

export default defineConfig({
  base: './',                       // Electron loads dist/index.html from file://
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
  server: { port: 5190 },
});
