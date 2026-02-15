import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Avoid CORS in dev by proxying Hiro API through Vite.
      '/hiro': {
        target: 'https://api.testnet.hiro.so',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/hiro/, '')
      }
    }
  }
});
