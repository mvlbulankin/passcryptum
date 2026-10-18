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

  it('reads a legacy blob even when its first byte happens to be 0x01', async () => {
    const s = shared

    // Adversarial case for the marker: a legacy ciphertext starting with
    // 0x01 must still be read as legacy. Decrypt the first block to find a
    // plaintext that produces such a ciphertext (CBC: C1 = E(P1 ⊕ IV)).
    const key = s.cryptoKey
    const iv = new Uint8Array(s.legacyIv)

    let plaintext: Uint8Array | null = null

    for (let candidate = 0; candidate < 512 && !plaintext; candidate++) {
      const block = new Uint8Array(16)

      block[0] = candidate & 0xff

      // E(block ⊕ IV) is the ciphertext's first block; check its first byte.
      const probe = await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv },
        key,
        block,
      )

      if (new Uint8Array(probe)[0] === 0x01) {
        const json = JSON.stringify({ x: [7, {}] })

        plaintext = new Uint8Array(16 + 32)
        plaintext.set(block, 0)
        plaintext.set(new TextEncoder().encode(json).slice(0, 32), 16)
      }
    }

    expect(plaintext, 'colliding block found').not.toBeNull()

    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      key,
      plaintext!.slice(0, 16).buffer,
    )

    // Only the first block matters: 16 bytes, marker collision included.
    expect(new Uint8Array(cipher)[0]).toBe(0x01)
    expect(cipher.byteLength % 16).toBe(0)

    storage.setItem(
      s.lsKey,
      Array.from(new Uint8Array(cipher))
        .map(n => n.toString(16).padStart(2, '0'))
        .join(''),
    )

    // It decrypts to our 16-byte block, which is not valid Services, so the
    // read drops it — but it must be *attempted as legacy*, and the length
    // check is what guarantees that. Prove the dispatch directly:
    const { decryptBlob } = await import('../lib/blob')

    const raw = await decryptBlob(
      new Uint8Array(cipher).buffer,
      s.cryptoKey,
      s.legacyIv,
    )

    expect(raw).not.toBeNull()
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
