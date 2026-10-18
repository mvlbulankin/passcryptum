import { readFile } from 'node:fs/promises'

import { test, expect } from './test'
import { acceptOnlineMode, openStorage, signInWithPassword } from './fixtures'

// A file exported on one device must import into another. This round-trip
// was broken (the export is the stored envelope, which the import read as
// raw AES) and nothing covered it, so it stayed broken until the vault
// module gave the two halves one owner.
const ORIGIN_PASSWORD = 'file round trip e2e'
const SERVICE = 'filehost.com'

test.describe('file export and import', () => {
  test('an exported vault file imports on another device', async ({ browser }) => {
    const device1 = await browser.newContext({ ignoreHTTPSErrors: true })
    const page1 = await device1.newPage()

    await page1.goto('/')
    await signInWithPassword(page1, ORIGIN_PASSWORD)
    await acceptOnlineMode(page1)

    await page1.getByRole('button', { name: 'Create the first one' }).click()
    await page1.getByPlaceholder('Enter service name').fill(SERVICE)
    await page1.getByPlaceholder('Enter login').fill('file-user')
    await page1.getByRole('button', { name: 'Continue' }).click()
    await expect(page1.getByText(SERVICE).first()).toBeVisible({
      timeout: 15_000,
    })

    // Export: the download button hands the browser a file with the vault.
    await openStorage(page1)

    const download = page1.waitForEvent('download')

    await page1.getByRole('button', { name: 'Download file' }).click()

    const file = await download
    const path = await file.path()

    expect(path).toBeTruthy()

    const exported = await readFile(path as string)

    expect(exported.byteLength).toBeGreaterThan(0)

    // Device 2: empty storage, same origin password (same keys).
    const device2 = await browser.newContext({ ignoreHTTPSErrors: true })
    const page2 = await device2.newPage()

    await page2.goto('/')
    await signInWithPassword(page2, ORIGIN_PASSWORD)
    await acceptOnlineMode(page2)

    await openStorage(page2)
    // The browser runs in a container, so a host path is not visible to it:
    // hand over the bytes instead.
    await page2.locator('input[type=file]').setInputFiles({
      name: 'vault.dat',
      mimeType: 'application/octet-stream',
      buffer: exported,
    })

    await expect(page2.getByText(/imported/i).first()).toBeVisible({
      timeout: 30_000,
    })
    await expect(page2.getByText(SERVICE).first()).toBeVisible({
      timeout: 15_000,
    })

    await device1.close()
    await device2.close()
  })
})
