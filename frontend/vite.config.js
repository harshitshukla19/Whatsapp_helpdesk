import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 3003,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:5004',
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:5004',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 3003,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:5004',
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:5004',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
