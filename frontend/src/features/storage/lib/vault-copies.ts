import type { Vault } from '#/core'

/**
 * The two ways the whole Vault can leave this device as text. The pair is
 * the point: they were byte-identical once (both copied plaintext), so the
 * name promised encryption the code did not deliver — and the "encrypted"
 * one skipped the confirmation its twin required.
 *
 * The confirmation rule lives here, bound to the form, not to a prop a
 * caller could forget: anything that hands every secret to the OS clipboard
 * in plaintext must ask first.
 *
 * The vault is accepted, not reached for (the session singleton stays out
 * of this module), so the table is testable against a real vault.
 */
export type VaultCopyForm = 'stored' | 'plaintext'

export type VaultCopy = {
  label: string
  read(): Promise<string | null>
  /** Null when no confirmation is needed. */
  confirmation: { title: string; content: string } | null
}

export const createVaultCopies = (
  vault: Vault,
): Record<VaultCopyForm, VaultCopy> => ({
  stored: {
    // The blob as the app stores it — still encrypted, so no confirmation.
    // exportText pairs with importText: a pasted copy reads back.
    label: 'Copy storage text',
    read: () => vault.exportText(),
    confirmation: null,
  },

  plaintext: {
    label: 'Copy without encryption',
    read: () =>
      vault
        .read()
        .then(services => (services ? JSON.stringify(services) : null)),
    confirmation: {
      title: 'Copy the entire vault?',
      content:
        'All logins and passwords will be placed in the clipboard in plaintext. Clipboard contents may be stored by the OS or synced to the cloud.',
    },
  },
})
