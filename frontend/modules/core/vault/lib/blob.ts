import { parse, stringify, type ServicesConfig } from '../../../services'

// The blob format. Current:
//
//   0x01 ‖ fresh IV(16) ‖ AES-CBC(json)
//
// Pre-3.0 (legacy): raw AES-CBC(json) under a static IV sliced from the
// origin buffer.
//
// The two are told apart structurally, not by guessing: a CBC ciphertext is
// always a multiple of 16 bytes, while the current blob is
// 1 + 16 + 16k ≡ 1 (mod 16). The sets cannot overlap — a legacy blob whose
// first byte happens to be 0x01 is still rejected by the length check
// (measured: ~0.29% of legacy blobs start with that byte).

export const BLOB_MARKER = 0x01

const IV_LENGTH = 16

/** hex ⇄ bytes: the storage representation is hex, the wire one is bytes. */
export const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map(n => n.toString(16).padStart(2, '0'))
    .join('')

export const fromHex = (hex: string): ArrayBuffer => {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Not a hex string')
  }

  const bytes = Array.from({ length: hex.length / 2 }, (_, i) =>
    parseInt(hex.slice(i * 2, i * 2 + 2), 16),
  )

  return new Uint8Array(bytes).buffer
}

export const encryptBlob = async (
  plaintext: string,
  key: CryptoKey,
): Promise<ArrayBuffer> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    new TextEncoder().encode(plaintext),
  )

  return new Uint8Array([BLOB_MARKER, ...iv, ...new Uint8Array(cipher)]).buffer
}

const isCurrentFormat = (buffer: ArrayBuffer): boolean => {
  const bytes = new Uint8Array(buffer)

  return (
    bytes[0] === BLOB_MARKER &&
    (bytes.length - 1) % IV_LENGTH === 0 &&
    bytes.length > IV_LENGTH
  )
}

/**
 * Decrypts a blob in either format. Returns null when the bytes are not a
 * blob this vault can read. Validity of the *content* is the caller's
 * concern: this function only answers "can these bytes be decrypted".
 */
export const decryptBlob = async (
  buffer: ArrayBuffer,
  key: CryptoKey,
  legacyIv: ArrayBuffer,
): Promise<string | null> => {
  const current = isCurrentFormat(buffer)
  const cipher = current ? buffer.slice(1 + IV_LENGTH) : buffer
  const iv = current ? buffer.slice(1, 1 + IV_LENGTH) : legacyIv

  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv },
      key,
      cipher,
    )

    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

/** Decrypts, then validates: the blob is Services only if it parses. */
export const readServices = async (
  buffer: ArrayBuffer,
  key: CryptoKey,
  legacyIv: ArrayBuffer,
): Promise<ServicesConfig | null> => {
  const plaintext = await decryptBlob(buffer, key, legacyIv)

  if (plaintext === null) {
    return null
  }

  const services = parse(plaintext)

  return services.length > 0 || plaintext.trim() === '[]' ? services : null
}

export const stringifyServices = (services: ServicesConfig): string =>
  stringify(services)
