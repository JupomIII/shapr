import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base keeps the app working from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
    port: 5173,
  },
});
