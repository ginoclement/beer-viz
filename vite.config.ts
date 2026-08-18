import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built site works at any path (e.g. ginoclement.com/beer)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
