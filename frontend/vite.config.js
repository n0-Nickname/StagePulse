import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const COOP_COEP_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/workers/asr.worker.js', 'src/test/**', 'src/**/*.test.{js,jsx}'],
      thresholds: {
        statements: 100,
        lines: 100,
      },
    },
  },
  server: {
    port: 5173,
    headers: COOP_COEP_HEADERS,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: COOP_COEP_HEADERS,
  },
});
