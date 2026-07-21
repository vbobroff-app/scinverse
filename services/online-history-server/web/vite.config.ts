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
      // Windows: native FS events часто «замирают» (Cursor/AV) — polling стабильнее.
      usePolling: true,
      interval: 200,
      // Важно: не ставить ignored: ['!outside/**'] — одиночный negation
      // в chokidar игнорирует всё КРОМЕ этого пути (web/src «пропадает» из watch).
      // Пакет вне root уже подхватывается через alias + fs.allow.
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
