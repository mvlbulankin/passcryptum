import type { Page } from '@playwright/test'

import { test, expect } from './test'
import {
  acceptOnlineMode,
  pickMenu,
  signInWithPassword,
  workArea,
} from './fixtures'

// The PIN flows, from the outside. Until this spec existed no e2e test
// touched a PIN at all, which is why three silently-broken sequences lived
// in the code: setting an online PIN re-salted the offline blob, revoking
// the online PIN deleted the offline one's salt, and an offline-only device
// encrypted under an empty salt. Each scenario below drives the real UI.
//
// The menu offers "Set online PIN" only in online mode and "Set offline PIN"
// only in offline mode, so pairing both custodities means switching modes —
// which is exactly the sequence that used to break the first one.

const PASSWORD = 'pin flows e2e password'
const PIN = 'a good long pin'

const pinInput = (page: Page) =>
  page.getByPlaceholder('Enter a PIN (8+ characters)')

const setPin = async (page: Page, kind: 'online' | 'offline') => {
  // A previous menu may still be animating out; the click would land on the
  // overlay instead of the header button.
  await page
    .locator('.n-dropdown-menu')
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => undefined)

  await pickMenu(page, `Set ${kind} PIN`)
  await pinInput(page).waitFor({ timeout: 15_000 })
  await pinInput(page).fill(PIN)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(
    page.getByText(`${kind} PIN has been set`, { exact: false }),
  ).toBeVisible({ timeout: 90_000 })
}

const signOut = async (page: Page) => {
  await pickMenu(page, 'Sign out')

  // With a PIN set the login screen opens on the PIN tab, so the password
  // field is not rendered: wait for the screen, not for one of its fields.
  await page
    .getByRole('textbox', { name: /Enter (online|offline) PIN/ })
    .waitFor({ timeout: 30_000 })
}

const signInWithPin = async (page: Page, pin: string) => {
  const field = page.getByRole('textbox', {
    name: /Enter (online|offline) PIN/,
  })

  await field.fill(pin)
  await page.getByRole('button', { name: 'Continue' }).click()

  await workArea(page).waitFor({ timeout: 120_000 })
}

/**
 * Switches online/offline mode. The menu's first item is a switch whose
 * labels ("Online"/"Offline") both exist in the DOM, so the mode words are
 * not clickable text: hit the switch itself and wait for the header to
 * reflect the new mode.
 */
const switchMode = async (page: Page) => {
  await page.locator('button.header-menu').click()

  const toggle = page.getByRole('switch')

  await toggle.waitFor({ timeout: 15_000 })

  const wasOnline = await toggle.isChecked()

  await toggle.click()

  // The menu closes on selection: wait for it to be gone, otherwise the next
  // pickMenu click lands on the closing overlay and its item is never found.
  await page
    .locator('.n-dropdown-menu')
    .waitFor({ state: 'detached', timeout: 15_000 })

  return wasOnline ? 'offline' : 'online'
}

test.describe('PIN flows', () => {
  test('an offline PIN opens the vault after an online PIN was set', async ({
    page,
  }) => {
    await page.goto('/')
    await signInWithPassword(page, PASSWORD)

    // The online PIN needs a paired Credential, so accept online mode.
    await acceptOnlineMode(page)

    await setPin(page, 'online')
    await signOut(page)
    await signInWithPin(page, PIN)

    // Now the offline custody, on top of the online one. This is the
    // sequence that used to re-salt (and so break) the online Credential's
    // key when the salts were shared.
    await switchMode(page)
    await setPin(page, 'offline')
    await signOut(page)
    await signInWithPin(page, PIN)

    // And back again: the online custody still opens too.
    await switchMode(page)
    await signOut(page)
    await signInWithPin(page, PIN)
  })

  test('revoking the online PIN leaves the offline PIN working', async ({
    page,
  }) => {
    await page.goto('/')
    await signInWithPassword(page, PASSWORD)
    await acceptOnlineMode(page)

    await setPin(page, 'online')
    await switchMode(page)
    await setPin(page, 'offline')

    // Revoke the online custody only — the item is offered in online mode.
    await switchMode(page)
    await pickMenu(page, 'Delete online PIN')
    await page.getByRole('button', { name: 'Yes, delete online PIN' }).click()
    await expect(
      page.getByText('Your online PIN has been deleted'),
    ).toBeVisible({ timeout: 30_000 })

    // Back to offline first: in online mode without an online PIN the login
    // screen correctly falls back to the password tab, so the PIN tab only
    // exists in the mode whose custody is set.
    await switchMode(page)

    await signOut(page)

    // The offline PIN must still open the vault. Before the salt split this
    // reported "Wrong PIN" on the correct PIN, because revoking the online
    // custody deleted the salt the offline blob was sealed with.
    await signInWithPin(page, PIN)
  })

  test('a wrong PIN is reported as a wrong PIN, not as a network error', async ({
    page,
  }) => {
    await page.goto('/')
    await signInWithPassword(page, PASSWORD)
    await acceptOnlineMode(page)
    await setPin(page, 'online')
    await signOut(page)

    const field = page.getByRole('textbox', { name: /Enter online PIN/ })

    await field.fill('definitely the wrong pin')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByText('Wrong PIN', { exact: true })).toBeVisible({
      timeout: 120_000,
    })
    await expect(workArea(page)).toHaveCount(0)
  })
})
