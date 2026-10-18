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
    legacyIv: crypto.getRandomValues(new Uint8Array(16)).buffer,
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

  // The format is dispatched by structure, not by guessing: a legacy blob is
  // raw AES-CBC (length % 16 === 0), the current one is
  // 0x01 ‖ IV(16) ‖ ciphertext (length % 16 === 1). The sets cannot overlap.
  it('reads a legacy (static-IV) blob', async () => {
    const s = shared
    const legacyVault = createVault(s, storage)

    const plaintext = new TextEncoder().encode(
      JSON.stringify({ 'github.com': [7, { me: 0 }] }),
    )

    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: s.legacyIv },
      s.cryptoKey,
      plaintext,
    )

    storage.setItem(
      s.lsKey,
      Array.from(new Uint8Array(cipher))
        .map(n => n.toString(16).padStart(2, '0'))
        .join(''),
    )

    expect((await legacyVault.read()) as unknown[]).toHaveLength(1)
  })

  it('dispatches legacy by length, not by the marker byte', async () => {
    const s = shared
    const { decryptBlob } = await import('../lib/blob')

    // A valid legacy blob (raw AES-CBC: length 16k) whose ciphertext happens
    // to start with the marker byte. Search over the plaintext: CBC gives
    // C1 = E(P1 ⊕ IV), so varying P1 varies C1.
    const iv = new Uint8Array(s.legacyIv.slice(0))

    let legacy: ArrayBuffer | null = null

    for (let candidate = 0; candidate < 8192 && !legacy; candidate++) {
      const json = JSON.stringify({ k: candidate })
      const padded = new Uint8Array(Math.ceil(json.length / 16) * 16)

      padded.set(new TextEncoder().encode(json))

      const cipher = await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv },
        s.cryptoKey,
        padded,
      )

      if (new Uint8Array(cipher)[0] === 0x01 && cipher.byteLength % 16 === 0) {
        legacy = cipher
      }
    }

    expect(legacy, 'marker-colliding legacy ciphertext found').not.toBeNull()
    expect(new Uint8Array(legacy!)[0]).toBe(0x01)
    // The new format is 1 + 16 + 16k; this is 16k, so it cannot be confused.
    expect(legacy!.byteLength % 16).toBe(0)

    const plaintext = await decryptBlob(
      legacy as ArrayBuffer,
      s.cryptoKey,
      s.legacyIv,
    )

    // Decrypted as legacy despite the marker byte: length ruled the new
    // format out before the marker was consulted.
    expect(plaintext).not.toBeNull()
    expect(plaintext?.startsWith('{"k":')).toBe(true)
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
