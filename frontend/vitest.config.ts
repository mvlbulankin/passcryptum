import { resolve } from 'path'

import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so the app build config stays a pure Vite
// config. Aliases must be repeated here; Playwright specs (e2e/) are not
// vitest suites.
export default defineConfig({
  resolve: {
    alias: {
      '#': resolve('modules'),
      '@': resolve('src'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
})
