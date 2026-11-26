import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 프로젝트 페이지(`https://<user>.github.io/video-editor/`)에서 그대로 동작하도록
// base 를 잡는다. 다른 경로에 올릴 때는 VITE_BASE_PATH 로 덮어쓴다.
const base = process.env.VITE_BASE_PATH || '/video-editor/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // 백엔드를 다시 붙일 때만 사용한다(정적 모드에서는 호출하지 않음).
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
