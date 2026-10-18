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

export const uint8ArrayToBase64 = (uint8Array: Uint8Array): string =>
  btoa(String.fromCharCode(...uint8Array))

export const base64ToUint8Array = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), c => c.charCodeAt(0))

export const bufferToBase64 = (buffer: ArrayBuffer): string =>
  uint8ArrayToBase64(new Uint8Array(buffer))

export const base64ToBuffer = (base64: string): ArrayBuffer =>
  new Uint8Array(base64ToUint8Array(base64)).buffer
