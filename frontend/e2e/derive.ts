import { webcrypto } from 'node:crypto'

import nacl from 'tweetnacl'

// Derivation of a profile's identity from an origin password. This is a
// faithful port of modules/core (session/model/session.ts +
// session/lib/parse-origin-buffer.ts + shared/lib/format-password.ts):
// PBKDF2-SHA512 over SHA-256(password) → 256-byte origin buffer, whose
// keyPairSeed slice yields the Ed25519 public key. The e2e stack onboards
// these keys, exactly as an admin does in production.
const ORIGIN_BUFFER_BYTE_LENGTH = 256
const ORIGIN_BUFFER_ITERATIONS = 2 ** 18 // 262144

export async function deriveOriginBuffer(password: string): Promise<Uint8Array> {
  const buffer = new TextEncoder().encode(password)

  const [key, salt] = await Promise.all([
    webcrypto.subtle.importKey('raw', buffer, 'PBKDF2', false, ['deriveBits']),
    webcrypto.subtle.digest('SHA-256', buffer),
  ])

  const bits = await webcrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-512',
      salt,
      iterations: ORIGIN_BUFFER_ITERATIONS,
    },
    key,
    ORIGIN_BUFFER_BYTE_LENGTH * 8,
  )

  return new Uint8Array(bits)
}

/** Ed25519 public key (base64) — the profile's server identity. */
export async function derivePublicKey(password: string): Promise<string> {
  const origin = await deriveOriginBuffer(password)
  const seed = origin.slice(136, 168) // keyPairSeedBuffer
  const { publicKey } = nacl.sign.keyPair.fromSeed(seed)

  return Buffer.from(publicKey).toString('base64')
}

/** The four-letter profile id shown in the header (same as the app). */
export async function deriveProfileId(password: string): Promise<string> {
  const origin = await deriveOriginBuffer(password)
  const capitals = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const seeds = new Uint16Array(origin.buffer.slice(0, 32)) // first 8 bytes → 4 ids

  return Array.from({ length: 4 }, (_, index) => {
    const seed = seeds[index]

    return { char: capitals.charAt(seed % capitals.length), seed }
  })
    .sort((a, b) => a.seed - b.seed)
    .map(({ char }) => char)
    .join('')
}
