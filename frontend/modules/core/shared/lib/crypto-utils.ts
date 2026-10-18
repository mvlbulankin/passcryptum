import { sign, secretbox } from 'tweetnacl'

import { getBufferOfText } from './text'

// Timestamp/signature/framing helpers live in wire/lib/protocol.ts now —
// callers speak the protocol only through the wire client.

export const encryptData = (
  data: Uint8Array,
  iv: Uint8Array,
  key: Uint8Array,
): Uint8Array => secretbox(data, iv, key)

export const decryptData = (
  data: Uint8Array,
  iv: Uint8Array,
  key: Uint8Array,
): Uint8Array | null => secretbox.open(data, iv, key)

export const getKeyPairFromSeed = (
  keyPairSeed: Uint8Array,
): { secretKey: Uint8Array; publicKey: Uint8Array } => {
  const { secretKey, publicKey } = sign.keyPair.fromSeed(keyPairSeed)

  return { secretKey, publicKey }
}

export const getHashOfString = async (input: string): Promise<Uint8Array> => {
  const buffer = getBufferOfText(input)
  const hashBuffer = await crypto.subtle.digest('SHA-512', buffer)

  return new Uint8Array(hashBuffer)
}

// Spreading the whole array into String.fromCharCode overflows the stack on
// large inputs (the vault blob reaches megabytes), so encode in chunks. The
// chunk is a multiple of 3 so no base64 padding appears mid-stream.
const BASE64_CHUNK = 3 * 8192

export const uint8ArrayToBase64 = (uint8Array: Uint8Array): string => {
  if (uint8Array.length <= BASE64_CHUNK) {
    return btoa(String.fromCharCode(...uint8Array))
  }

  let out = ''

  for (let i = 0; i < uint8Array.length; i += BASE64_CHUNK) {
    out += btoa(
      String.fromCharCode(...uint8Array.subarray(i, i + BASE64_CHUNK)),
    )
  }

  return out
}

export const base64ToUint8Array = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), c => c.charCodeAt(0))

export const bufferToBase64 = (buffer: ArrayBuffer): string =>
  uint8ArrayToBase64(new Uint8Array(buffer))

export const base64ToBuffer = (base64: string): ArrayBuffer =>
  new Uint8Array(base64ToUint8Array(base64)).buffer
