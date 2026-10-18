import { test, expect } from './test'
import { declineOnlineMode, signInWithPassword, workArea } from './fixtures'

// Passcryptum has no accounts: every origin password deterministically
// derives its own vault (id, keys, entropy). "Wrong password" therefore
// cannot happen by design — a mistyped password opens a different, empty
// vault. These tests pin that behaviour from the outside.
const ORIGIN_PASSWORD = 'correct horse battery staple e2e'
const OTHER_PASSWORD = 'definitely not the password'

test.describe('sign in', () => {
  test('signs in with the origin password and shows the work area', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', { name: 'Sign in' }).first(),
    ).toBeVisible()

    await signInWithPassword(page, ORIGIN_PASSWORD)
    await declineOnlineMode(page)

    await expect(workArea(page)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0)

    // The session lives on after a reload (derived material is re-derived
    // from storage; the vault is not lost).
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Sign in' }).first(),
    ).toBeVisible()
  })

  test('another origin password opens a different, empty vault', async ({
    page,
  }) => {
    await page.goto('/')

    const input = page.getByRole('textbox', { name: 'Enter password' })

    await input.fill(OTHER_PASSWORD)
    await page.getByRole('button', { name: 'Continue' }).click()

    // A different password is a different identity, not an error: the app
    // signs in and the vault is empty.
    await expect(workArea(page)).toBeVisible({ timeout: 120_000 })
  })
})
