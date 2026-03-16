import { defineConfig } from 'vite';

export default defineConfig({
  // Treat frontend/ as the project root
  root: 'frontend',

  // Output built files to dist/ at repo root
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },

  // Dev server proxies /api/* to the Python serve.py (port 8000)
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
