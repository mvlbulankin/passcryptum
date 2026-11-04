import { webcrypto } from 'crypto'

import { describe, it, expect, beforeEach } from 'vitest'

import { createSession, SessionClosedError, PinReleaseError } from '../index'
import type { SessionStorage } from '../index'

import { createPinCustody } from '../../pin'
import type { WireClient } from '../../wire'

Object.defineProperty(global, 'crypto', { value: webcrypto })

// The session never touches the network: its custody runs over an injected
// storage and a fake wire client, so enterWithPin is testable here.
const fakeWireClient = (): WireClient => ({
  getServices: async () => null,
  setServices: async () => undefined,
  clearServices: async () => 'cleared',
  getEntropy: async () => new Uint8Array(0),
  createCredential: async () => new Uint8Array(32),
  deleteCredential: async () => undefined,
})

// The session is exercised through its interface with an injected storage.
// No Vue, no features, no globals: that is what the seam is for.
const memoryStorage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial))

  const storage: SessionStorage & { dump(): Record<string, string> } = {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    dump: () => Object.fromEntries(map),
  }

  return storage
}

const PASSWORD = 'session module test password'

describe('Session', () => {
  let storage: ReturnType<typeof memoryStorage>
  let onChange: () => void
  let calls: number
  let session: ReturnType<typeof createSession>

  beforeEach(() => {
    storage = memoryStorage()
    calls = 0

    onChange = () => {
      calls += 1
    }

    session = createSession({
      storage,
      custody: createPinCustody({ storage, wire: fakeWireClient() }),
    })
    session.subscribe(onChange)
  })

  it('starts closed and refuses secrets', () => {
    expect(session.isActive()).toBe(false)
    expect(() => session.keyPairSeed()).toThrow(SessionClosedError)
    expect(() => session.publicKey()).toThrow(SessionClosedError)
  })

  it('enters with the origin password and reports its profile id', async () => {
    const kit = await session.enter(PASSWORD)

    expect(session.isActive()).toBe(true)
    expect(kit.id).toHaveLength(4)
    // The Origin Buffer yields a 32-byte Ed25519 seed and public key.
    expect(session.keyPairSeed()).toHaveLength(32)
    expect(session.publicKey()).toHaveLength(32)
  })

  it('derives the same identity from the same password, on any instance', async () => {
    const first = await session.enter(PASSWORD)
    const publicKey = session.publicKey()

    const other = createSession({ storage: memoryStorage() })
    const second = await other.enter(PASSWORD)

    expect(second.id).toBe(first.id)
    expect(other.publicKey()).toEqual(publicKey)
  })

  it('notifies subscribers on enter and on exit', async () => {
    await session.enter(PASSWORD)
    expect(calls).toBeGreaterThan(0)

    const before = calls

    session.exit()
    expect(calls).toBeGreaterThan(before)
    expect(session.isActive()).toBe(false)
  })

  it('zeroizes the origin buffer on exit', async () => {
    await session.enter(PASSWORD)

    const buffer = session.originBuffer()

    expect(new Uint8Array(buffer).some(byte => byte !== 0)).toBe(true)

    session.exit()

    expect(new Uint8Array(buffer).every(byte => byte === 0)).toBe(true)
  })

  it('rejects a secret read after exit', async () => {
    await session.enter(PASSWORD)
    session.exit()

    expect(() => session.entropy()).toThrow(SessionClosedError)
    expect(() => session.transportKeys()).toThrow(SessionClosedError)
    // Reaching the vault at all is a secret read: it fails synchronously
    // rather than handing back a closed vault.
    expect(() => session.vault()).toThrow(SessionClosedError)
  })

  it('remembers which profile this device has visited', async () => {
    expect(session.hasVisited()).toBe(false)

    await session.enter(PASSWORD)
    session.markVisited()

    expect(session.hasVisited()).toBe(true)

    // A different password is a different profile.
    session.exit()
    await session.enter('another password entirely')

    expect(session.hasVisited()).toBe(false)
  })

  it('defaults to offline mode and remembers a switch', async () => {
    expect(session.mode()).toBe('offline')

    session.setMode('online')
    expect(session.mode()).toBe('online')

    // Persisted: a new session object over the same storage sees it.
    expect(
      createSession({
        storage,
        custody: createPinCustody({ storage, wire: fakeWireClient() }),
      }).mode(),
    ).toBe('online')
  })

  it('re-enters with the PIN that holds the Origin Buffer', async () => {
    const kit = await session.enter(PASSWORD)

    const custody = createPinCustody({
      storage,
      wire: fakeWireClient(),
    })

    await custody.store('offline', '12345678', session.originBuffer())
    session.exit()

    const again = await session.enterWithPin('12345678')

    expect(session.isActive()).toBe(true)
    expect(again.id).toBe(kit.id)
    expect(session.publicKey()).toHaveLength(32)
  })

  it('refuses to enter with a PIN when nothing is held', async () => {
    const attempt = session.enterWithPin('12345678')

    await expect(attempt).rejects.toBeInstanceOf(PinReleaseError)
    await expect(attempt).rejects.toMatchObject({
      reason: 'noStoredBuffer',
    })
    expect(session.isActive()).toBe(false)
  })
})
