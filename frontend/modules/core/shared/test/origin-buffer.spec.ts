import { webcrypto } from 'crypto'

import { describe, it, expect } from 'vitest'

import { parseOriginBuffer } from '../lib/origin-buffer'
import { pbkdf2, getBufferOfText } from '../index'

Object.defineProperty(global, 'crypto', { value: webcrypto })

describe('Origin Buffer layout', () => {
  it('slices the buffer into its parts', async () => {
    // A real 256-byte Origin Buffer: the length the session enforces.
    const buffer = await pbkdf2(getBufferOfText('very good password'), 256, 16)
    const parsed = parseOriginBuffer(buffer)

    expect(parsed.id).toHaveLength(4)
    expect(parsed.lsKey).toHaveLength(16)
    expect(parsed.entropy.byteLength).toBe(112)
    expect(parsed.keyPairSeedBuffer.byteLength).toBe(32)
    expect(parsed.secretBoxIvBuffer.byteLength).toBe(24)
    expect(parsed.secretBoxKeyBuffer.byteLength).toBe(32)
    expect(parsed.cryptoKeyBuffer.byteLength).toBe(32)

    // The slices cover the buffer exactly, with no gaps or overlap —
    // except the 16 reserved bytes at 120–136: the retired pre-3.0 blob IV
    // slice (ADR-0009), kept reserved so no other range shifts.
    const total =
      parsed.entropy.byteLength +
      parsed.keyPairSeedBuffer.byteLength +
      parsed.secretBoxIvBuffer.byteLength +
      parsed.secretBoxKeyBuffer.byteLength +
      parsed.cryptoKeyBuffer.byteLength

    expect(total).toBe(256 - 8 - 16)
  })
})
