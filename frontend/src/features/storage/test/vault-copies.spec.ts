import { webcrypto } from 'crypto'

import { describe, it, expect, beforeEach } from 'vitest'
import { createSession } from '#/core'

import { createVaultCopies } from '../lib/vault-copies'

Object.defineProperty(global, 'crypto', { value: webcrypto })

// The two copy forms are pinned by what they produce, not by their labels:
// the regression this replaces was two identical bodies behind different
// names, one of which skipped the confirmation.

const PASSWORD = 'the copy-forms test password'

const SERVICES = [
  {
    name: 'gitlab.com',
    useSpecialCharacters: false,
    passwordLengthIndex: 0 as const,
    logins: [{ name: 'me', version: 0 }],
  },
]

describe('the ways the Vault leaves as text', () => {
  let session: ReturnType<typeof createSession>
  let copies: ReturnType<typeof createVaultCopies>

  beforeEach(async () => {
    localStorage.clear()
    session = createSession()

    await session.enter(PASSWORD)
    await session.vault().write(SERVICES)

    copies = createVaultCopies(session.vault())
  })

  it('stored is encrypted and different from plaintext', async () => {
    const stored = await copies.stored.read()
    const plaintext = await copies.plaintext.read()

    expect(stored).not.toBeNull()
    expect(plaintext).not.toBeNull()
    // The bug: these two used to be the same string.
    expect(stored).not.toEqual(plaintext)
    expect(plaintext).toContain('gitlab.com')
    expect(stored).not.toContain('gitlab.com')
  })

  it('stored round-trips through the vault’s own import path', async () => {
    const stored = (await copies.stored.read()) as string

    expect(await session.vault().importText(stored)).toEqual(SERVICES)
  })

  it('only the plaintext form demands confirmation', () => {
    expect(copies.plaintext.confirmation).not.toBeNull()
    expect(copies.stored.confirmation).toBeNull()
  })

  it('names what each form does', () => {
    expect(copies.stored.label).toBe('Copy storage text')
    expect(copies.plaintext.label).toBe('Copy without encryption')
  })

  it('reports nothing to copy when the vault is empty', async () => {
    await session.vault().clear()

    expect(await copies.stored.read()).toBeNull()
    expect(await copies.plaintext.read()).toBeNull()
  })
})
