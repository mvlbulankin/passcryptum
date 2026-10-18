import { devices } from '@playwright/test'

import { test, expect } from './test'
import {
  acceptOnlineMode,
  createFirstServiceAndUpload,
  pullVaultDown,
  signInWithPassword,
} from './fixtures'

// The device-to-device sync flow of sync.spec.ts, but device 2 runs in
// Android emulation (Pixel 7: mobile viewport, touch, Chrome-on-Android
// UA). Guards the mobile layout and the sync path against desktop-only
// assumptions. The service name is asserted on the service heading: on the
// mobile layout the name also lives inside a hidden combobox overlay.
//
// Its own onboarded password: the suite shares one server and one database,
// and this spec leaves an uploaded vault behind.
const ORIGIN_PASSWORD = 'android emulation e2e'

const SERVICE = 'android-emulation.example'
const LOGIN = 'e2e-user'

test.describe('server synchronization (Android emulation)', () => {
  test('an Android device pulls the vault down', async ({ browser }) => {
    // --- device 1: desktop, create + upload ---
    const device1 = await browser.newContext({ ignoreHTTPSErrors: true })
    const page1 = await device1.newPage()

    await page1.goto('/')
    await signInWithPassword(page1, ORIGIN_PASSWORD)
    await acceptOnlineMode(page1)
    await createFirstServiceAndUpload(page1, SERVICE, LOGIN)

    // --- device 2: Android Chrome emulation, clean context ---
    const device2 = await browser.newContext({
      ...devices['Pixel 7'],
      ignoreHTTPSErrors: true,
    })

    const page2 = await device2.newPage()

    await page2.goto('/')
    await signInWithPassword(page2, ORIGIN_PASSWORD)

    // Accepting online mode auto-pulls the vault: a failure would surface
    // here first, exactly as it did on a real phone during the incident.
    await acceptOnlineMode(page2)

    await pullVaultDown(page2)

    await expect(
      page2.getByRole('heading', { name: SERVICE, exact: true }),
    ).toBeVisible({ timeout: 10_000 })

    await device1.close()
    await device2.close()
  })
})
