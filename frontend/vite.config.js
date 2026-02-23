import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const stacksNetwork = (env.VITE_STACKS_NETWORK || 'testnet').toLowerCase();
  const hiroTarget =
    env.VITE_HIRO_PROXY_TARGET ||
    (stacksNetwork === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so');
  const hiroApiKey = String(env.HIRO_API_KEY || '').trim();

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Avoid CORS in dev by proxying Hiro API through Vite.
        '/hiro': {
          target: hiroTarget,
          changeOrigin: true,
          secure: true,
          headers: hiroApiKey ? { 'x-api-key': hiroApiKey } : undefined,
          rewrite: (path) => path.replace(/^\/hiro/, '')
        }
      }
    }
  };
});
