import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const apiTarget = process.env.SINOPEBASE_API_URL || 'http://127.0.0.1:8090'

export default defineConfig({
  base: '/_/',
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': apiTarget,
      '/auth': apiTarget,
      '/rest': apiTarget,
      '/storage': apiTarget,
      '/realtime': { target: apiTarget, ws: true },
      '/openapi': apiTarget,
    },
  },
})
