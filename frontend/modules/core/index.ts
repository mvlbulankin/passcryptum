export {
  decryptData,
  encryptData,
  getHashOfString,
  getKeyPairFromSeed,
  base64ToBuffer,
  bufferToBase64,
  base64ToUint8Array,
  uint8ArrayToBase64,
} from './shared'

export { createPinAesData } from './actions'

export { generatePassword } from './generator'

// Wire Protocol client (ADR-0002): the only way the app talks to the server.
export { wire, WireError, isForbidden } from './wire'

export type { WireErrorKind, Transport, WireClient } from './wire'

// Vault: Services as stored on this device.
export { VaultClosedError } from './vault'

export type { Vault } from './vault'

export {
  setOnlinePin,
  setOfflinePin,
  deleteOnlinePin,
  deleteOfflinePin,
  isThereOnlinePin,
  isThereOfflinePin,
} from './pin'

export { createSession, SessionClosedError } from './session'

export type {
  Session,
  SessionDeps,
  SessionMode,
  SessionStorage,
  StarterKit,
  TransportKeys,
} from './session'
