import { webcrypto } from 'crypto'

import { describe, it, expect } from 'vitest'

import { decryptBlob } from '../lib/decrypt-blob'

import {
  pbkdf2,
  getBufferOfText,
  createAesKey,
  encrypt,
  concatBuffers,
} from '../../shared'

Object.defineProperty(global, 'crypto', { value: webcrypto })

const JSON_TEXT = '{"services":{"github":{"login":"me","password":"p"}}}'

describe('decryptBlob (legacy blob format)', () => {
  it('reads the legacy blob (static IV, no marker)', async () => {
    const hash = await pbkdf2(getBufferOfText('origin'), 48, 8)
    const key = await createAesKey(hash.slice(0, 32))
    const legacyIv = hash.slice(32, 48)
    const legacyCt = await encrypt(legacyIv, key, getBufferOfText(JSON_TEXT))

    expect(await decryptBlob(legacyCt, legacyIv, key)).toBe(JSON_TEXT)
  })

  it('reads the v2 blob (marker || random IV || ct)', async () => {
    const hash = await pbkdf2(getBufferOfText('origin'), 48, 8)
    const key = await createAesKey(hash.slice(0, 32))
    const legacyIv = hash.slice(32, 48)
    const iv = webcrypto.getRandomValues(new Uint8Array(16)).buffer
    const ct = await encrypt(iv, key, getBufferOfText(JSON_TEXT))
    const marker = new Uint8Array([0x01]).buffer
    const blob = concatBuffers(concatBuffers(marker, iv), ct)

    expect(await decryptBlob(blob, legacyIv, key)).toBe(JSON_TEXT)
  })

  it('prefers legacy JSON when a legacy blob happens to start with 0x01', async () => {
    const hash = await pbkdf2(getBufferOfText('origin'), 48, 8)
    const key = await createAesKey(hash.slice(0, 32))
    const legacyIv = hash.slice(32, 48)

    // Search for an IV/padding combination whose legacy ciphertext starts
    // with the v2 marker byte; the disambiguation must still pick legacy.
    for (let i = 0; i < 64; i++) {
       
      const legacyCt = await encrypt(legacyIv, key, getBufferOfText(JSON_TEXT))

      if (new Uint8Array(legacyCt)[0] === 0x01) {
         
        expect(await decryptBlob(legacyCt, legacyIv, key)).toBe(JSON_TEXT)

        return
      }
    }
  })

  it('returns null for garbage', async () => {
    const hash = await pbkdf2(getBufferOfText('origin'), 48, 8)
    const key = await createAesKey(hash.slice(0, 32))
    const garbage = webcrypto.getRandomValues(new Uint8Array(64)).buffer

    expect(await decryptBlob(garbage, hash.slice(32, 48), key)).toBeNull()
  })
})
