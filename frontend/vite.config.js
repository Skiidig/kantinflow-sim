import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy dev membuat browser cukup memanggil /api tanpa perlu CORS di backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
});
