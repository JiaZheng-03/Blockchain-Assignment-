import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  cacheDir: path.join(os.tmpdir(), 'cargoseal-vite-cache'),
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
