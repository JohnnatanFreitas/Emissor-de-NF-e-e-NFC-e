import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Em produção o Fastify serve web/dist na raiz (/); em desenvolvimento, `npm run dev` repassa /api para a porta 3000.
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
