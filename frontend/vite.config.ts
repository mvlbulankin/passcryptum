import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))

// Bump the service-worker cache version with every build so a fresh build
// actually reaches returning users (the SW serves cached shells forever
// otherwise). CACHE_VERSION lives in public/sw.js -> dist/sw.js.
const swVersionPlugin = {
  name: 'sw-version',
  closeBundle() {
    const sw = resolve('dist/sw.js')

    try {
      const src = readFileSync(sw, 'utf-8')

      const stamped = src.replace(
        /const CACHE_VERSION = '[^']*'/,
        `const CACHE_VERSION = 'build-${new Date().toISOString()}'`,
      )

      writeFileSync(sw, stamped)
    } catch {
      // no dist/sw.js (e.g. lib build): nothing to stamp
    }
  },
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '#': resolve('modules'),
      '@': resolve('src'),
    },
  },
  server: {
    // Same-origin API default; the dev server proxies /api to the
    // Go backend (listens on :8000).
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  plugins: [vue(), viteSingleFile(), swVersionPlugin],
})
