import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // em desenvolvimento, a API local (npm run api) responde em /api
    proxy: { '/api': 'http://localhost:3001' }
  },
  build: { outDir: 'dist' }
})
