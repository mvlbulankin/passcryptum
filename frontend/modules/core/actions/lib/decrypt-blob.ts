import { getTextFromBuffer, decrypt } from '../../shared'

// The legacy services blob was AES-CBC under a key AND an IV both
// sliced out of the origin buffer (static IV, reused for every save). The v2
// blob is: 0x01 marker || fresh random IV(16) || ciphertext.
//
// Disambiguation: CBC with a wrong IV only mangles the first block, so a
// mismatched read can "succeed" with garbage. We therefore accept a
// decryption only when it yields parsable JSON — the services blob is always
// JSON (stringify.ts).

const BLOB_MARKER = 0x01

const isJson = (text: string) => {
  try {
    JSON.parse(text)

    return true
  } catch {
    return false
  }
}

const tryDecrypt = async (
  cipher: ArrayBuffer,
  iv: ArrayBuffer,
  key: CryptoKey,
): Promise<string | null> => {
  try {
    return getTextFromBuffer(await decrypt(iv, key, cipher))
  } catch (e) {
    void e

    return null
  }
}

// Returns plaintext, or null when neither format decrypts to valid JSON
// (callers treat null as a corrupt blob and drop it, as before).
export const decryptBlob = async (
  buffer: ArrayBuffer,
  legacyIv: ArrayBuffer,
  key: CryptoKey,
): Promise<string | null> => {
  const legacy = await tryDecrypt(buffer, legacyIv, key)

  if (legacy !== null && isJson(legacy)) {
    return legacy
  }

  const bytes = new Uint8Array(buffer)

  if (bytes[0] === BLOB_MARKER && buffer.byteLength > 17) {
    const plain = await tryDecrypt(buffer.slice(17), buffer.slice(1, 17), key)

    if (plain !== null && isJson(plain)) {
      return plain
    }
  }

  return null
}
