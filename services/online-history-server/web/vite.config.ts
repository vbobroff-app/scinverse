/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// OHS control-plane host (see services/online-history-server/.../launchSettings.json).
const OHS_TARGET = 'http://localhost:5080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: OHS_TARGET, changeOrigin: true },
      '/ws': { target: OHS_TARGET, ws: true, changeOrigin: true },
    },
    fs: {
      // linked package `@scinverse/notification-center` лежит вне web/
      allow: ['..', '../../..'],
    },
  },
  optimizeDeps: {
    exclude: ['@scinverse/notification-center'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
