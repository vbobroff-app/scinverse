/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// OHS control-plane host (see services/online-history-server/.../launchSettings.json).
const OHS_TARGET = 'http://localhost:5080';
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const notificationCenterRoot = path.resolve(rootDir, '../../../packages/notification-center');

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Всегда тянем исходники пакета (не застывший snapshot / prebundle).
    alias: {
      '@scinverse/notification-center': path.join(notificationCenterRoot, 'src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: OHS_TARGET, changeOrigin: true },
      '/ws': { target: OHS_TARGET, ws: true, changeOrigin: true },
    },
    fs: {
      allow: [rootDir, notificationCenterRoot, path.resolve(rootDir, '../../..')],
    },
    watch: {
      // pnpm hardlink/symlink: явно следим за пакетом вне web/
      ignored: [`!${notificationCenterRoot.replace(/\\/g, '/')}/**`],
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
