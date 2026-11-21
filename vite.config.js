// Vite builds web/ into dist/ as plain static files (no server code). base './' keeps every URL relative,
// so dist/ works from any folder or static host. Deployment is the owner's call; nothing here deploys.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 900 },
  server: { port: 8765, strictPort: true },
});
