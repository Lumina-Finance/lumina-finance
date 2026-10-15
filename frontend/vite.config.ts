import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// A released server answers the API under /api beside the app. A dev instance serves it on its
// own port, so the same path is relayed there, letting the native apps reach a dev instance at the
// address they'd use for a released server
const apiTarget = process.env.VITE_API_URL
const apiProxy = apiTarget
  ? { '/api': { target: apiTarget, rewrite: (path: string) => path.replace(/^\/api/, '') } }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: apiProxy,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
