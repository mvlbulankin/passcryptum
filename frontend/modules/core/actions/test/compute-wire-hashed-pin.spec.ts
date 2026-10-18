import { webcrypto } from 'crypto'

import { describe, it, expect } from 'vitest'

import { computeWireHashedPin } from '../lib/compute-wire-hashed-pin'

Object.defineProperty(global, 'crypto', { value: webcrypto })

const publicKey = new Uint8Array(32).fill(7)
const otherKey = new Uint8Array(32).fill(9)

describe('computeWireHashedPin (protocol v2 wire value)', () => {
  it('is deterministic for the same pin and public key', async () => {
    const a = await computeWireHashedPin('correct horse', publicKey)
    const b = await computeWireHashedPin('correct horse', publicKey)

    expect(a).toHaveLength(32)
    expect(a).toEqual(b)
  })

  it('differs per public key (per-profile salt) and per pin', async () => {
    const base = await computeWireHashedPin('pin', publicKey)

    expect(await computeWireHashedPin('pin', otherKey)).not.toEqual(base)
    expect(await computeWireHashedPin('other pin', publicKey)).not.toEqual(base)
  })

  it('is not the bare SHA-512 of the pin (the v1 wire value)', async () => {
    const wire = await computeWireHashedPin('pin', publicKey)

    const bare = new Uint8Array(
      await crypto.subtle.digest('SHA-512', new TextEncoder().encode('pin')),
    )

    expect(wire).not.toEqual(bare)
    expect(wire).toHaveLength(32) // ...and a different length than 64
  })
})
