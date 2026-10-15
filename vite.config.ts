import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Relative base so the build works from any sub-path (e.g. GitHub Pages /repo-name/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1400,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
})
