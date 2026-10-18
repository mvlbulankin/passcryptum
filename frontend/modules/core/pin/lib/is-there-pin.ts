import { getEncryptedHash } from '../../actions'
import {
  LS_KEY_PROTECTOR,
  LS_KEY_PUBLIC_KEY,
  LS_KEY_RANDOM_STRING,
} from '../../constants'
import type { SessionStorage } from '../../session'

export const isThereOfflinePin = (storage: SessionStorage): boolean =>
  Boolean(getEncryptedHash(storage))

export const isThereOnlinePin = (storage: SessionStorage): boolean =>
  Boolean(
    storage.getItem(LS_KEY_PUBLIC_KEY) &&
      storage.getItem(LS_KEY_PROTECTOR) &&
      storage.getItem(LS_KEY_RANDOM_STRING),
  )
