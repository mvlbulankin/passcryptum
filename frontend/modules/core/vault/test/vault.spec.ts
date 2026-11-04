import { webcrypto } from 'crypto'

import { describe, it, expect, beforeEach } from 'vitest'

import { createVault, VaultClosedError } from '../index'
import type { VaultSession, VaultStorage } from '../index'

Object.defineProperty(global, 'crypto', { value: webcrypto })

// The vault is exercised entirely through its interface: a fake session (the
// keys that come out of the Origin Buffer) and a Map-backed storage. No DOM,
// no localStorage, no jsdom — the storage seam is what makes this possible.
const session = async (): Promise<VaultSession> => {
  const key = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    'AES-CBC',
    false,
    ['encrypt', 'decrypt'],
  )

  return {
    lsKey: 'test-vault',
    cryptoKey: key,
  }
}

const memoryStorage = (): VaultStorage & { dump(): Record<string, string> } => {
  const map = new Map<string, string>()

  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    dump: () => Object.fromEntries(map),
  }
}

const services = (name: string) => [
  {
    name,
    passwordLengthIndex: 2 as const,
    useSpecialCharacters: true,
    logins: [{ name: 'me', version: 0 }],
  },
]

describe('Vault', () => {
  let storage: ReturnType<typeof memoryStorage>
  let vault: ReturnType<typeof createVault>
  // One Origin Buffer per test: every "device" below shares it, exactly like
  // two devices signed in with the same origin password.
  let shared: VaultSession

  beforeEach(async () => {
    storage = memoryStorage()
    shared = await session()
    vault = createVault(shared, storage)
  })

  it('round-trips Services through write/read', async () => {
    await vault.write(services('github.com'))

    const read = await vault.read()

    expect(read).toEqual(services('github.com'))
    // One stored entry: the envelope lives in the single lsKey slot.
    expect(Object.keys(storage.dump())).toEqual(['test-vault'])
  })

  it('returns null when nothing is stored', async () => {
    expect(await vault.read()).toBeNull()
  })

  it('drops a corrupt blob and reports null', async () => {
    storage.setItem('test-vault', 'deadbeefdeadbeef')

    expect(await vault.read()).toBeNull()
    expect(storage.dump()).toEqual({})
  })

  // ADR-0009: the pre-3.0 format (raw AES-CBC, a multiple of 16 bytes,
  // no marker, no IV) is retired. Whatever IV such bytes were encrypted
  // under, they are not a blob this vault can read, so read() drops them
  // like any other unreadable content.
  it('drops a pre-3.0 (static-IV) blob as unreadable', async () => {
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ 'github.com': [7, { me: 0 }] }),
    )

    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: crypto.getRandomValues(new Uint8Array(16)) },
      shared.cryptoKey,
      plaintext,
    )

    storage.setItem(
      shared.lsKey,
      Array.from(new Uint8Array(cipher))
        .map(n => n.toString(16).padStart(2, '0'))
        .join(''),
    )

    expect(await vault.read()).toBeNull()
    expect(storage.dump()).toEqual({})
  })

  it('exports bytes that importBytes reads back', async () => {
    await vault.write(services('gitlab.com'))

    const bytes = await vault.exportBytes()

    expect(bytes).not.toBeNull()

    // Another device with the same Origin Buffer: same keys, empty storage.
    const other = createVault(shared, memoryStorage())

    const imported = await other.importBytes(
      new Uint8Array(bytes!).buffer as ArrayBuffer,
    )

    expect(imported).toEqual(services('gitlab.com'))
  })

  it('imports an exported file into a fresh device (the broken round-trip)', async () => {
    await vault.write(services('github.com'))

    const exported = await vault.exportBytes()
    const fresh = createVault(shared, memoryStorage())

    const imported = await fresh.importBytes(
      new Uint8Array(exported!).buffer as ArrayBuffer,
    )

    expect(imported).toEqual(services('github.com'))
  })

  it('importText accepts plain JSON and encrypted text alike', async () => {
    const plain = JSON.stringify({ 'a.com': [7, { u: 0 }] })

    expect(await vault.importText(plain)).toHaveLength(1)

    await vault.write(services('b.com'))

    const encrypted = storage.getItem('test-vault') as string

    expect(await vault.importText(encrypted)).toEqual(services('b.com'))
    expect(await vault.importText('not json, not hex')).toBeNull()
  })

  it('exportText is the stored representation, and importText reads it back', async () => {
    await vault.write(services('b.com'))

    const copied = await vault.exportText()

    // Exactly what the app stores, so the round-trip closes.
    expect(copied).toBe(storage.getItem('test-vault'))
    expect(await vault.importText(copied as string)).toEqual(services('b.com'))
  })

  it('clears the stored vault', async () => {
    await vault.write(services('a.com'))
    await vault.clear()

    expect(await vault.read()).toBeNull()
    expect(storage.dump()).toEqual({})
  })

  it('refuses to work after close', async () => {
    await vault.write(services('a.com'))
    vault.close()

    await expect(vault.read()).rejects.toBeInstanceOf(VaultClosedError)
    await expect(vault.write(services('b.com'))).rejects.toBeInstanceOf(
      VaultClosedError,
    )
  })
})
