import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  base: '/_/',
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8090',
      '/auth': 'http://127.0.0.1:8090',
      '/rest': 'http://127.0.0.1:8090',
      '/storage': 'http://127.0.0.1:8090',
      '/realtime': 'http://127.0.0.1:8090',
      '/openapi': 'http://127.0.0.1:8090',
    },
  },
})
