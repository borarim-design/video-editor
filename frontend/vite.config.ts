import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 FastAPI(8080)로 API를 프록시한다.
// 배포(Docker)에서는 프론트 빌드 결과를 FastAPI가 같은 오리진에서 서빙한다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 4173 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
