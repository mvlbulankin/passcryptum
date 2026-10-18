export {
  readData,
  saveData,
  deleteData,
  getDataAsString,
  getDataAsBuffer,
  getDataDecrypted,
} from './data'

export {
  decryptData,
  encryptData,
  base64ToBuffer,
  bufferToBase64,
  getHashOfString,
  getKeyPairFromSeed,
  base64ToUint8Array,
  uint8ArrayToBase64,
} from './shared'

export { generatePassword } from './generator'

// Wire Protocol client (ADR-0002): the only way the app talks to the server.
export { wire, WireError, isForbidden } from './wire'

export type { WireErrorKind, Transport, WireClient } from './wire'

export {
  setOnlinePin,
  setOfflinePin,
  deleteOnlinePin,
  deleteOfflinePin,
  isThereOnlinePin,
  isThereOfflinePin,
} from './pin'

export {
  exit,
  getSession,
  enterWithPin,
  enterWithOriginPassword,
} from './session'
