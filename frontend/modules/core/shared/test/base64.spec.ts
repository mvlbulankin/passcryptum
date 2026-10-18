import { describe, it, expect } from 'vitest'

import {
  base64ToUint8Array,
  bufferToBase64,
  uint8ArrayToBase64,
} from '../lib/crypto-utils'

// The encoder used to spread the whole array into String.fromCharCode, which
// overflows the stack on large inputs. The vault blob can reach megabytes, so
// the regression is worth a test at that size.
describe('base64 helpers', () => {
  it('round-trips small inputs', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 255])

    expect(base64ToUint8Array(uint8ArrayToBase64(bytes))).toEqual(bytes)
  })

  it('round-trips an input that is not a multiple of three', () => {
    for (const size of [1, 2, 4, 5, 7, 8, 10]) {
      const bytes = crypto.getRandomValues(new Uint8Array(size))

      expect(base64ToUint8Array(uint8ArrayToBase64(bytes))).toEqual(bytes)
    }
  })

  // 1 MiB: several chunk boundaries, the case that used to blow the stack.
  it('round-trips a megabyte without overflowing the stack', () => {
    // getRandomValues caps at 64 KiB per call, so fill in slices.
    const bytes = new Uint8Array(1024 * 1024)

    for (let i = 0; i < bytes.length; i += 65536) {
      bytes.set(crypto.getRandomValues(new Uint8Array(65536)), i)
    }
    const encoded = uint8ArrayToBase64(bytes)

    expect(encoded.length).toBeGreaterThan(bytes.length)
    expect(base64ToUint8Array(encoded)).toEqual(bytes)
  })

  it('encodes an ArrayBuffer through bufferToBase64', () => {
    const bytes = new Uint8Array([9, 8, 7])

    expect(base64ToUint8Array(bufferToBase64(bytes.buffer))).toEqual(bytes)
  })
})
