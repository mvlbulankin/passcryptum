import { webcrypto } from 'crypto'

import { describe, it, expect, beforeEach } from 'vitest'

import { createVaultSync } from '../lib/sync'
import type { VaultSyncDevice } from '../lib/types'
import type { ServicesConfig } from '../../../services'

import { createVault, type Vault } from '../../vault'
import { WireError, type WireClient } from '../../wire'

Object.defineProperty(global, 'crypto', { value: webcrypto })

// Two devices, one server: the module is exercised through its interface
// with real vaults and a fake wire adapter (the second adapter the
// production fetch wire needs to justify the seam).

const SERVICES = (name: string): ServicesConfig => [
  {
    name,
    useSpecialCharacters: false,
    passwordLengthIndex: 0,
    logins: [{ name: 'me', version: 0 }],
  },
]

const memoryStorage = () => {
  const map = new Map<string, string>()

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

/** The server's half: one stored envelope, plus a way to refuse. */
const fakeWire = (
  behaviour: { failWith?: WireError; hasBlob?: boolean } = {},
) => {
  let stored: Uint8Array | null =
    behaviour.hasBlob === false ? null : new Uint8Array([1, 2, 3]) // overwritten by the first push

  const guard = () => {
    if (behaviour.failWith) {
      throw behaviour.failWith
    }
  }

  const client: WireClient = {
    async getServices() {
      guard()

      return stored
    },
    async setServices(_seed, envelope) {
      guard()

      stored = envelope
    },
    async clearServices() {
      guard()

      const had = stored !== null

      stored = null

      return had ? 'cleared' : 'already-empty'
    },
    getEntropy: async () => new Uint8Array(0),
    createCredential: async () => new Uint8Array(32),
    deleteCredential: async () => undefined,
  }

  return { client, peek: () => stored }
}

// Two devices of one Profile share the Origin Buffer, and therefore the
// secretbox keys and the AES key: that is what makes a pushed envelope
// readable on the other device at all (the server holds neither).
const ORIGIN = {
  keyPairSeed: crypto.getRandomValues(new Uint8Array(32)),
  secretBoxIv: crypto.getRandomValues(new Uint8Array(24)),
  secretBoxKey: crypto.getRandomValues(new Uint8Array(32)),
}

const device = (vault: Vault): VaultSyncDevice => ({
  keyPairSeed: ORIGIN.keyPairSeed,
  transportKeys: () => ({
    secretBoxIv: ORIGIN.secretBoxIv,
    secretBoxKey: ORIGIN.secretBoxKey,
  }),
  vault,
  apply: services => vault.write(services),
})

// Both devices derive this key from the same Origin Buffer; a vault written
// on one is readable on the other. Each test gives them fresh storage, not a
// fresh key.
const makeVault = async (key: CryptoKey): Promise<Vault> => {
  return createVault(
    {
      lsKey: 'test-vault',
      cryptoKey: key,
      legacyIv: crypto.getRandomValues(new Uint8Array(16)).buffer,
    },
    memoryStorage(),
  )
}

describe('Vault sync', () => {
  let vaultA: Vault
  let vaultB: Vault

  beforeEach(async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      ORIGIN.secretBoxKey.slice(0, 32),
      'AES-CBC',
      false,
      ['encrypt', 'decrypt'],
    )

    vaultA = await makeVault(key)
    vaultB = await makeVault(key)
  })

  it('pushes a device’s Services and pulls them onto another', async () => {
    const wire = fakeWire()
    const sync = createVaultSync({ wire: wire.client })

    await vaultA.write(SERVICES('gitlab.com'))

    expect(await sync.push(device(vaultA))).toEqual({
      ok: true,
      result: 'pushed',
    })

    const deviceB = device(vaultB)

    expect(await sync.pull(deviceB)).toEqual({ ok: true, result: 'pulled' })
    expect(await vaultB.read()).toEqual(SERVICES('gitlab.com'))
  })

  it('merges instead of clobbering what the device already holds', async () => {
    const wire = fakeWire()
    const sync = createVaultSync({ wire: wire.client })

    await vaultA.write(SERVICES('gitlab.com'))
    await vaultB.write(SERVICES('github.com'))

    await sync.push(device(vaultA))
    await sync.pull(device(vaultB))

    const names = (await vaultB.read())?.map(s => s.name)

    expect(names).toContain('github.com')
    expect(names).toContain('gitlab.com')
  })

  it('reports nothing to push from an empty device', async () => {
    const sync = createVaultSync({ wire: fakeWire().client })

    expect(await sync.push(device(vaultA))).toEqual({
      ok: true,
      result: 'nothingToPush',
    })
  })

  it('reports nothing on the server', async () => {
    const wire = fakeWire({ hasBlob: false })
    const sync = createVaultSync({ wire: wire.client })

    expect(await sync.pull(device(vaultB))).toEqual({
      ok: true,
      result: 'nothingOnServer',
    })
  })

  it('reports a corrupt envelope instead of throwing', async () => {
    const wire = fakeWire()
    const sync = createVaultSync({ wire: wire.client })

    // Something that decrypts to nothing this vault can read.
    await wire.client.setServices(new Uint8Array(32), new Uint8Array(64))

    expect(await sync.pull(device(vaultB))).toEqual({
      ok: true,
      result: 'corrupt',
    })
  })

  it('answers unknownProfile when the server refuses (403)', async () => {
    const wire = fakeWire({ failWith: new WireError('forbidden', 403) })
    const sync = createVaultSync({ wire: wire.client })

    // A real push: the refusal must come from the server, not from an empty
    // vault short-circuiting before the request.
    await vaultA.write(SERVICES('gitlab.com'))

    expect(await sync.push(device(vaultA))).toEqual({
      ok: false,
      reason: 'unknownProfile',
    })
  })

  it('keeps a network failure distinguishable', async () => {
    const wire = fakeWire({ failWith: new WireError('network') })
    const sync = createVaultSync({ wire: wire.client })

    expect(await sync.pull(device(vaultA))).toEqual({
      ok: false,
      reason: 'network',
    })
  })

  it('clears the server copy and is idempotent', async () => {
    const wire = fakeWire()
    const sync = createVaultSync({ wire: wire.client })

    await vaultA.write(SERVICES('gitlab.com'))
    await sync.push(device(vaultA))

    expect(await sync.clear(device(vaultA))).toEqual({
      ok: true,
      result: 'cleared',
    })
    expect(await sync.clear(device(vaultA))).toEqual({
      ok: true,
      result: 'alreadyEmpty',
    })
  })
})
