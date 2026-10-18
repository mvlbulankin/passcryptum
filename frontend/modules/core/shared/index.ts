// Crypto and encoding primitives. Internal to core: the app does not import
// from here (the core barrel re-exports what it needs). Wire framing helpers
// live in wire/lib/protocol.ts, not here.

export {
  getBufferOfText,
  getTextFromBuffer,
  parseHexToBuffer,
} from './lib/text'

export { concatBuffers, stringifyBuffer } from './lib/buffer'

export { pbkdf2, createAesKey, decrypt, encrypt } from './lib/crypto'

export { capitals, getCharset } from './lib/charset'

export {
  decryptData,
  encryptData,
  getHashOfString,
  getKeyPairFromSeed,
  base64ToBuffer,
  base64ToUint8Array,
  bufferToBase64,
  uint8ArrayToBase64,
} from './lib/crypto-utils'

export { formatPassword } from './lib/format-password'

export { generateRandomString } from './lib/generate-random-string'
