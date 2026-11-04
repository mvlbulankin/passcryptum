import { webcrypto } from 'crypto'

import { describe, it, expect, beforeEach } from 'vitest'

import { createPinCustody } from '../lib/custody'
import type { CustodyStorage, PinCustody } from '../lib/types'

import { WireError } from '../../wire'
import type { WireClient } from '../../wire'

Object.defineProperty(global, 'crypto', { value: webcrypto })

// The custody is exercised through its interface with an injected storage
// and an injected wire client (the production adapters are localStorage and
// the fetch wire): the seam is real, both adapters use it.

const memoryStorage = (): CustodyStorage & { dump(): Map<string, string> } => {
  const map = new Map<string, string>()

  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    dump: () => map,
  }
}

/** Any 256 bytes are a valid Origin Buffer as far as the custody cares. */
const originBuffer = (): ArrayBuffer =>
  crypto.getRandomValues(new Uint8Array(256)).buffer

const PIN = 'a good long pin'

/**
 * A wire client that remembers the entropy the custody handed over, so a
 * later release gets back exactly what was stored — the server's half of
 * the round-trip, faked at the seam.
 */
const fakeWire = (
  behaviour: {
    getEntropy?: () => Promise<Uint8Array>
    createCredential?: (
      seed: Uint8Array,
      hashedPin: Uint8Array,
      entropy: Uint8Array,
    ) => Promise<Uint8Array>
    deleteCredential?: () => Promise<void>
  } = {},
): WireClient => {
  const issued = crypto.getRandomValues(new Uint8Array(32))

  let storedEntropy: Uint8Array | null = null

  return {
    getServices: async () => null,
    setServices: async () => undefined,
    clearServices: async () => 'cleared' as const,
    getEntropy:
      behaviour.getEntropy ??
      (async () => {
        if (!storedEntropy) {
          // Nothing was ever handed over: the server has nothing to answer.
          throw new WireError('forbidden', 403)
        }

        return storedEntropy
      }),
    createCredential:
      behaviour.createCredential ??
      (async (
        _seed: Uint8Array,
        _hashedPin: Uint8Array,
        entropy: Uint8Array,
      ) => {
        storedEntropy = entropy

        return issued
      }),
    deleteCredential: behaviour.deleteCredential ?? (async () => undefined),
  }
}

describe('PIN Custody', () => {
  let storage: ReturnType<typeof memoryStorage>
  let custody: PinCustody

  beforeEach(() => {
    storage = memoryStorage()
    custody = createPinCustody({ storage, wire: fakeWire() })
  })

  describe('offline custody', () => {
    it('round-trips the Origin Buffer under the PIN', async () => {
      const buffer = originBuffer()

      expect(await custody.store('offline', PIN, buffer)).toEqual({ ok: true })
      expect(custody.isSet('offline')).toBe(true)

      expect(await custody.release(PIN)).toEqual({ ok: true, buffer })
    })

    it('refuses the wrong PIN', async () => {
      await custody.store('offline', PIN, originBuffer())

      expect(await custody.release('not the pin')).toEqual({
        ok: false,
        reason: 'wrongPin',
      })
    })

    it('drops an unreadable stored blob and reports nothing stored', async () => {
      storage.setItem('pin', 'not a blob')

      expect(custody.isSet('offline')).toBe(false)
      expect(storage.dump().has('pin')).toBe(false)

      expect(await custody.release(PIN)).toEqual({
        ok: false,
        reason: 'noStoredBuffer',
      })
    })

    it('drops a stored blob of the wrong length', () => {
      // Well-formed base64, but not the length an Origin Buffer pads to.
      storage.setItem('pin', 'AAAA')

      expect(custody.isSet('offline')).toBe(false)
    })

    it('revokes by dropping the blob', async () => {
      await custody.store('offline', PIN, originBuffer())

      expect(await custody.revoke('offline')).toEqual({ ok: true })
      expect(custody.isSet('offline')).toBe(false)
    })
  })

  describe('online custody', () => {
    it('round-trips through the server', async () => {
      const buffer = originBuffer()

      expect(await custody.store('online', PIN, buffer)).toEqual({ ok: true })
      expect(custody.isSet('online')).toBe(true)

      custody.setMode('online')

      expect(await custody.release(PIN)).toEqual({ ok: true, buffer })
    })

    it('answers wrongPin to the server’s bare 403', async () => {
      await custody.store('online', PIN, originBuffer())
      custody.setMode('online')

      const refusing = createPinCustody({
        storage,
        wire: fakeWire({
          getEntropy: () => Promise.reject(new WireError('forbidden', 403)),
        }),
      })

      expect(await refusing.release(PIN)).toEqual({
        ok: false,
        reason: 'wrongPin',
      })
    })

    it('keeps a network failure distinguishable from a wrong PIN', async () => {
      await custody.store('online', PIN, originBuffer())
      custody.setMode('online')

      const unreachable = createPinCustody({
        storage,
        wire: fakeWire({
          getEntropy: () => Promise.reject(new WireError('network')),
        }),
      })

      expect(await unreachable.release(PIN)).toEqual({
        ok: false,
        reason: 'network',
      })
    })

    it('answers unknownProfile when the hand-over is refused (403)', () => {
      const refused = createPinCustody({
        storage,
        wire: fakeWire({
          createCredential: () =>
            Promise.reject(new WireError('forbidden', 403)),
        }),
      })

      return expect(
        refused.store('online', PIN, originBuffer()),
      ).resolves.toEqual({ ok: false, reason: 'unknownProfile' })
    })

    it('does not re-salt the PIN key when the hand-over is refused', async () => {
      // First hand-over succeeds and salts the key with a random string.
      await custody.store('online', PIN, originBuffer())

      const random = storage.dump().get('random_string')

      // A second hand-over fails at the server.
      const refused = createPinCustody({
        storage,
        wire: fakeWire({
          createCredential: () =>
            Promise.reject(new WireError('forbidden', 403)),
        }),
      })

      await refused.store('online', 'another pin', originBuffer())

      // The salt is untouched, so the first custody still releases.
      expect(storage.dump().get('random_string')).toBe(random)

      custody.setMode('online')

      expect((await custody.release(PIN)).ok).toBe(true)
    })

    it('revokes by deleting the credential and the device record', async () => {
      await custody.store('online', PIN, originBuffer())

      expect(await custody.revoke('online')).toEqual({ ok: true })
      expect(custody.isSet('online')).toBe(false)
      expect(storage.dump().has('random_string')).toBe(false)
    })

    it('answers unknownCredential when the credential is already gone', async () => {
      await custody.store('online', PIN, originBuffer())

      const gone = createPinCustody({
        storage,
        wire: fakeWire({
          deleteCredential: () =>
            Promise.reject(new WireError('forbidden', 403)),
        }),
      })

      expect(await gone.revoke('online')).toEqual({
        ok: false,
        reason: 'unknownCredential',
      })
      // The device record survives a failed revoke, as before.
      expect(gone.isSet('online')).toBe(true)
    })
  })

  describe('release follows the stored mode', () => {
    it('reports nothing stored when the mode points at an unset custody', async () => {
      await custody.store('offline', PIN, originBuffer())
      custody.setMode('online')

      expect(await custody.release(PIN)).toEqual({
        ok: false,
        reason: 'noStoredBuffer',
      })
    })

    it('defaults to the offline source', async () => {
      const buffer = originBuffer()

      await custody.store('offline', PIN, buffer)

      expect(await custody.release(PIN)).toEqual({ ok: true, buffer })
    })
  })

  describe('mode', () => {
    it('defaults to offline and persists a switch', () => {
      expect(custody.mode()).toBe('offline')

      custody.setMode('online')

      expect(custody.mode()).toBe('online')
      expect(createPinCustody({ storage, wire: fakeWire() }).mode()).toBe(
        'online',
      )
    })
  })

  describe('subscribers', () => {
    it('hear store, revoke and mode changes', async () => {
      let notifications = 0

      custody.subscribe(() => {
        notifications += 1
      })

      await custody.store('offline', PIN, originBuffer())
      await custody.revoke('offline')
      custody.setMode('online')

      expect(notifications).toBe(3)
    })
  })

  describe('the Hashed-Pin wire value (protocol v2)', () => {
    it('is deterministic, salted per key, and not the bare SHA-512', async () => {
      const seen: Uint8Array[] = []

      const recording = createPinCustody({
        storage,
        wire: fakeWire({
          async createCredential(_seed, hashedPin) {
            seen.push(hashedPin)

            return crypto.getRandomValues(new Uint8Array(32))
          },
        }),
      })

      const buffer = originBuffer()

      await recording.store('online', 'pin', buffer)
      await recording.store('online', 'pin', buffer)

      expect(seen[0]).toHaveLength(32)
      expect(seen[1]).toEqual(seen[0])

      await recording.store('online', 'pin', originBuffer())

      expect(seen[2]).not.toEqual(seen[0])

      const bare = new Uint8Array(
        await crypto.subtle.digest('SHA-512', new TextEncoder().encode('pin')),
      )

      expect(seen[0]).not.toEqual(bare)
    })
  })
})
