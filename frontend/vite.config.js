import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import process from 'node:process'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget =
    env.VITE_DASHBOARD_API_PROXY_TARGET || 'http://127.0.0.1:4030'

  return {
    plugins: [react(), tailwindcss()],
    // Solana web3.js / wallet-adapter expect Node globals in the browser.
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      include: ['buffer', 'bs58'],
    },
    server: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
