import { expect, type Page } from '@playwright/test'

// --- UI helpers ------------------------------------------------------------

// The signed-in work area: the login screen is replaced by the services UI.
export const workArea = (page: Page) =>
  page.getByText('There are no services here yet')

/** Opens the header menu and picks an item from it. */
export async function pickMenu(page: Page, label: string) {
  await page.locator('button.header-menu').click()
  await page.getByText(label, { exact: true }).click()
}

/** Opens the storage drawer from the header menu. */
export async function openStorage(page: Page) {
  const heading = page.getByRole('heading', { name: 'Storage' })

  // Server actions close the drawer themselves; wait for the overlay to be
  // gone before reaching for the menu again, otherwise the click lands on
  // the closing drawer.
  await expect(heading)
    .toHaveCount(0, { timeout: 15_000 })
    .catch(() => undefined)

  if (await heading.isVisible().catch(() => false)) {
    return
  }

  await pickMenu(page, 'Storage')
  await expect(heading).toBeVisible()
}

/** Closes the storage drawer (server actions close it themselves). */
export async function closeStorage(page: Page) {
  const drawer = page.getByRole('heading', { name: 'Storage' })

  if (await drawer.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached', timeout: 10_000 })
  }
}

/**
 * Signs in with the origin password (the slow PBKDF2 path). Leaves the
 * online-mode prompt alone — the caller decides (acceptOnlineMode /
 * declineOnlineMode), because accepting it starts a download.
 */
export async function signInWithPassword(page: Page, password: string) {
  const input = page.getByRole('textbox', { name: 'Enter password' })

  await input.fill(password)
  await page.getByRole('button', { name: 'Continue' }).click()

  // PBKDF2 (262k iterations) is slow in headless Chromium: wait for the work
  // area instead of sleeping a fixed amount.
  await workArea(page).waitFor({ timeout: 120_000 })
}

/**
 * Creates the first service on a fresh device and uploads the vault to the
 * server: the device-1 half of every device-to-device sync scenario.
 */
export async function createFirstServiceAndUpload(
  page: Page,
  service: string,
  login: string,
) {
  await page.getByRole('button', { name: 'Create the first one' }).click()
  await page.getByPlaceholder('Enter service name').fill(service)
  await page.getByPlaceholder('Enter login').fill(login)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText(service).first()).toBeVisible({ timeout: 15_000 })

  await openStorage(page)
  await page.getByRole('button', { name: 'Upload services to server' }).click()
  await page.getByRole('button', { name: 'Upload', exact: true }).click()

  await expect(page.getByText(/uploaded to server successfully/i)).toBeVisible({
    timeout: 60_000,
  })
}

/**
 * Device 2 of a sync scenario: opens Storage and pulls the vault down. On a
 * fresh device the online-mode prompt may already have pulled it, so pulling
 * again must be idempotent — "Parsed services is empty" is an accepted
 * outcome for an empty vault.
 */
export async function pullVaultDown(page: Page) {
  await openStorage(page)
  await page
    .getByRole('button', { name: 'Download services from server' })
    .click()
  await expect(
    page
      .getByText(
        /downloaded from server successfully|Parsed services is empty/i,
      )
      .first(),
  ).toBeVisible({ timeout: 60_000 })
}

/**
 * A device the app has not seen before is offered online mode right after
 * sign-in. Accepting it turns on sync and downloads the vault; declining
 * leaves the app offline-only. Both close the dialog.
 */
const onlineModePrompt = (page: Page) =>
  page.getByText('Would you like to enable online mode?')

export async function acceptOnlineMode(page: Page) {
  await onlineModePrompt(page).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Yes', exact: true }).click()
  await onlineModePrompt(page).waitFor({ state: 'detached', timeout: 15_000 })
}

export async function declineOnlineMode(page: Page) {
  if (
    await onlineModePrompt(page)
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole('button', { name: 'No', exact: true }).click()
    await onlineModePrompt(page).waitFor({ state: 'detached', timeout: 15_000 })
  }
}
