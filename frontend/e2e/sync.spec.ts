import { test, expect } from './test'
import {
  acceptOnlineMode,
  createFirstServiceAndUpload,
  openStorage,
  pullVaultDown,
  signInWithPassword,
} from './fixtures'

// The headline 3.x capability: an encrypted vault synchronized between
// devices through a self-hosted server. Device 1 creates a service and
// uploads it; device 2 (a fresh browser context with no local state) pulls
// it down. Both use the same origin password, which is the only shared
// secret.
const ORIGIN_PASSWORD = 'sync between devices e2e'

const SERVICE = 'github.com'
const LOGIN = 'e2e-user'

test.describe('server synchronization', () => {
  test('a vault created on one device is pulled down by another', async ({
    browser,
  }) => {
    // --- device 1: create and upload ---
    const device1 = await browser.newContext({ ignoreHTTPSErrors: true })
    const page1 = await device1.newPage()

    await page1.goto('/')
    await signInWithPassword(page1, ORIGIN_PASSWORD)
    await acceptOnlineMode(page1)
    await createFirstServiceAndUpload(page1, SERVICE, LOGIN)

    // --- device 2: a clean browser context, same origin password ---
    const device2 = await browser.newContext({ ignoreHTTPSErrors: true })
    const page2 = await device2.newPage()

    await page2.goto('/')
    await signInWithPassword(page2, ORIGIN_PASSWORD)
    await acceptOnlineMode(page2)

    // Accepting online mode on a fresh device already pulls the vault, so the
    // device may show data straight away; pulling again must be idempotent
    // and the service must be present.
    await pullVaultDown(page2)

    await expect(page2.getByText(SERVICE).first()).toBeVisible()

    await device1.close()
    await device2.close()
  })

  test('uploading twice in a row works (v2 nonce regression)', async ({
    page,
  }) => {
    // Regression: v2 signatures used to collide within the same second, so
    // the second sync was rejected as a replay (403).
    await page.goto('/')
    await signInWithPassword(page, ORIGIN_PASSWORD)
    await acceptOnlineMode(page)

    for (let attempt = 1; attempt <= 2; attempt++) {
      await openStorage(page)
      await page
        .getByRole('button', { name: 'Upload services to server' })
        .click()
      await page.getByRole('button', { name: 'Upload', exact: true }).click()

      await expect(
        page.getByText(/uploaded to server successfully/i).first(),
      ).toBeVisible({ timeout: 60_000 })
    }
  })
})
