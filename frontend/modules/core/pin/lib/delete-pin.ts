import { base64ToUint8Array } from '../../shared'
import { wire, isForbidden } from '../../wire'
import {
  LS_KEY_PIN,
  LS_KEY_PROTECTOR,
  LS_KEY_PUBLIC_KEY,
  LS_KEY_RANDOM_STRING,
} from '../../constants'
import type { SessionStorage } from '../../session'

export const deleteOfflinePin = (storage: SessionStorage) =>
  storage.removeItem(LS_KEY_PIN)

/** Revokes this device's credential; true when the server confirmed. */
export const deleteOnlinePin = async (storage: SessionStorage) => {
  const publicKey = storage.getItem(LS_KEY_PUBLIC_KEY)
  const protector = storage.getItem(LS_KEY_PROTECTOR)

  if (!publicKey || !protector) {
    throw new Error('Deleting online PIN failed')
  }

  try {
    await wire.deleteCredential(
      base64ToUint8Array(publicKey),
      base64ToUint8Array(protector),
    )
  } catch (e) {
    if (isForbidden(e)) {
      return false
    }

    throw new Error('Deleting online PIN failed')
  }

  storage.removeItem(LS_KEY_PROTECTOR)
  storage.removeItem(LS_KEY_PUBLIC_KEY)
  storage.removeItem(LS_KEY_RANDOM_STRING)

  return true
}
