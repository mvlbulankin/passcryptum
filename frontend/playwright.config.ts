import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the REAL stack: the Go binary serving the
// embedded single-file SPA and the API, with its own SQLite file and an
// onboarded profile (see e2e/fixtures.ts). No mocks, no dev server.
//
// The browser runs in the Playwright container (the host lacks the system
// libraries Chromium needs), so it reaches the stack at host.docker.internal.
// That name is NOT a secure context over plain HTTP — crypto.subtle would be
// undefined and every login would fail. Tests therefore go through the same
// TLS hop production has (Caddy), with the certificate error ignored.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // The suite shares one server and one database: scenarios build on each
  // other (set PIN → second device logs in), so they run in order.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://host.docker.internal:8443',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
