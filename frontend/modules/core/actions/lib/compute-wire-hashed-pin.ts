import { getHashOfString } from '../../shared'
import { WIRE_PIN_ITERATIONS } from '../../constants'

// The protocol v2 wire value for the Hashed-Pin header (ADR-0001): the bare
// SHA-512 of the PIN (the v1 value) is stretched with PBKDF2-SHA512 salted
// by the profile's public key, so a captured or logged header value costs
// ~600k iterations per dictionary guess instead of one hash. The public key
// is the salt because it is known to the client both when creating a
// credential (session active) and when authenticating (localStorage) — the
// protector, the glossary's first-choice salt, does not exist yet at
// creation time.
export const computeWireHashedPin = async (pin: string, publicKey: Uint8Array) => {
  const pinHash = new Uint8Array(await getHashOfString(pin))
  const salt = new Uint8Array(publicKey)

  const key = await crypto.subtle.importKey('raw', pinHash.buffer, 'PBKDF2', false, [
    'deriveBits',
  ])

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-512',
      salt: salt.buffer,
      iterations: WIRE_PIN_ITERATIONS,
    },
    key,
    32 * 8,
  )

  return new Uint8Array(bits)
}
