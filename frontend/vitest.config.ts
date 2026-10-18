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
    // happy-dom gives the specs a real localStorage, document and window, so
    // the persistence and DOM layers are testable without a browser. It is
    // fast enough to be the default; a spec that must not see a DOM can opt
    // out with `// @vitest-environment node`.
    environment: 'happy-dom',
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['modules/**', 'src/**'],
      exclude: ['**/*.spec.ts', '**/test/**', 'src/**/*.vue'],
    },
  },
})
