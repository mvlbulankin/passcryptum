import { readFileSync } from 'fs'
import { createServer, type Server } from 'http'

import { test, expect } from './test'

// A returning device must receive app updates without anyone clearing site
// data by hand. The worker serves the app shell (a single-file build) from
// its cache, and the browser's own update check is throttled — a registered
// worker is re-checked on navigation, but at most once every 24 hours — so a
// device can sit on a days-old build (the incident's three launches produced
// zero update-check fetches). The app therefore calls registration.update()
// on every launch (src/app/lib/register-sw.ts); a new worker activates
// (skipWaiting), rebuilds the cache, and the NEXT launch serves the fresh
// shell.
//
// Scope: this pins propagation GIVEN an update() call. It cannot observe the
// 24-hour throttle itself (no test run crosses it), so it is not evidence
// about when the browser checks on its own.
//
// This spec pins that mechanism through the REAL app: the fixture server
// serves the actual dist/index.html (whose main.ts runs registerServiceWorker
// on load — 127.0.0.1 passes the localhost guard) and the actual dist/sw.js.
// Two "builds" are simulated exactly the way a redeploy differs: the shell
// HTML gets a marker injected before </body> (the inline script, and with it
// the CSP hash, is untouched), and CACHE_VERSION is restamped — the same
// substitution swVersionPlugin applies at build time. localhost is a secure
// context, so the fixture needs no TLS stack.

const PORT = 8931

type Shell = 'a' | 'b'

const marker = (shell: Shell) =>
  `  <div id="shell-build">shell-${shell}</div>\n`

const shellHtml = (shell: Shell) =>
  readFileSync('dist/index.html', 'utf8').replace(
    '</body>',
    `${marker(shell)}</body>`,
  )

const stampedWorker = (version: string) =>
  readFileSync('dist/sw.js', 'utf8').replace(
    /const CACHE_VERSION = '[^']*'/,
    `const CACHE_VERSION = '${version}'`,
  )

const serving: { shell: Shell; worker: string } = {
  shell: 'a',
  worker: stampedWorker('build-a'),
}

const startServer = () =>
  new Promise<Server>(resolve => {
    const server = createServer((request, response) => {
      if (request.url === '/sw.js') {
        response.writeHead(200, { 'Content-Type': 'application/javascript' })
        response.end(serving.worker)

        return
      }

      if (request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end(shellHtml(serving.shell))

        return
      }

      // The worker pre-caches icons and screenshots on activate; a miss is
      // logged and skipped there, so plain 404s are fine here.
      response.writeHead(404)
      response.end()
    })

    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })

const shellShown = (page: import('@playwright/test').Page) =>
  page.locator('#shell-build').textContent()

test.describe('service worker update propagation', () => {
  let server: Server

  test.beforeAll(async () => {
    server = await startServer()
  })

  test.afterAll(async () => {
    server.close()
  })

  test('a returning device picks up a new build within two launches', async ({
    page,
  }) => {
    // First visit: the real app loads, registerServiceWorker() installs the
    // worker, the shell is cached.
    await page.goto(`http://127.0.0.1:${PORT}/`)
    await expect.poll(() => shellShown(page)).toBe('shell-a')

    // The server is redeployed with a new build.
    serving.shell = 'b'
    serving.worker = stampedWorker('build-b')

    // Launch 1 still serves the cached shell — the app's update() installs
    // the new worker in the background and its activate rebuilds the cache.
    await page.reload()
    await expect.poll(() => shellShown(page)).toBe('shell-a')

    // Launch 2 must serve the new build. More launches means update-on-load
    // is broken again and devices freeze on their first-cached app — the
    // Android incident.
    await page.reload()
    await expect
      .poll(() => shellShown(page), { timeout: 15_000 })
      .toBe('shell-b')
  })
})
