import { sign } from 'tweetnacl'

// Protocol framing primitives. Internal to the wire module: callers never
// see timestamps, signatures or concatenation — only the endpoint functions.

export const generateTimestamp = (): Uint8Array => {
  const timestamp = Math.floor(Date.now() / 1000)
  const buffer = new ArrayBuffer(4)
  const view = new DataView(buffer)

  view.setUint32(0, timestamp, true)

  return new Uint8Array(buffer)
}

// v2 nonce: 16 random bytes, carried in the signed message so two requests
// in the same second never share a signature (the server's replay cache keys
// on the signature; without a nonce a double GET collides with itself).
export const generateNonce = (): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(16))

export const concatUint8Arrays = (array1: Uint8Array, array2: Uint8Array) => {
  const tmp = new Uint8Array(array1.length + array2.length)

  tmp.set(array1, 0)
  tmp.set(array2, array1.length)

  return tmp
}

export const createSignature = (
  data: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array => sign.detached(data, secretKey)
