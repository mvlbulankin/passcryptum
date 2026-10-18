import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))

// Compute the SHA-256 of the single inlined script so the CSP can allow
// exactly that one instead of 'unsafe-inline'. The bundle is one inline
// module (vite-plugin-singlefile), so its hash is stable per build; the
// gateway reads the file this writes.
const cspHashPlugin = () => ({
  name: 'csp-hash',
  closeBundle() {
    const html = resolve('dist/index.html')
    const source = readFileSync(html, 'utf-8')
    const match = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)

    if (!match) {
      throw new Error('csp-hash: no inline script found in dist/index.html')
    }

    const hash = createHash('sha256').update(match[1], 'utf-8').digest('base64')

    // The policy is injected into the document as a meta tag, not configured
    // in the gateway: the hash changes with every build, while the Caddyfile
    // is a static file edited by whoever deploys. Directives that meta cannot
    // express (frame-ancestors) stay in the gateway's CSP; both policies are
    // enforced independently, per directive.
    const policy = [
      "default-src 'self'",
      `script-src 'sha256-${hash}'`,
      // The service worker is a separate file served from the origin; without
      // this, script-src (hash-only) blocks its registration.
      "worker-src 'self'",
      // naive-ui injects styles at runtime, so styles cannot be hashed.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; ')

    const withCsp = source.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
    )

    writeFileSync(html, withCsp)
  },
})

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
  plugins: [vue(), viteSingleFile(), swVersionPlugin, cspHashPlugin()],
})
