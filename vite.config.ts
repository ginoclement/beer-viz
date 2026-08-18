import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built site works at any path (e.g. ginoclement.com/beer)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          react: ['react', 'react-dom'],
          data: ['./src/generated/guides.json'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
