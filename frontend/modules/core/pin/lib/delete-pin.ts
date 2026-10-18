import { useDialog } from 'naive-ui'
import { base64ToUint8Array } from '#/core'

import { showPublicKeyError } from '@/features/storage/lib/public-key-error'

import { wire, isForbidden } from '../../wire'
import {
  LS_KEY_PIN,
  LS_KEY_PROTECTOR,
  LS_KEY_PUBLIC_KEY,
  LS_KEY_RANDOM_STRING,
} from '../../constants'

export const deleteOfflinePin = () => localStorage.removeItem(LS_KEY_PIN)

export const deleteOnlinePin = async (dialog: ReturnType<typeof useDialog>) => {
  const publicKey = localStorage.getItem(LS_KEY_PUBLIC_KEY)
  const protector = localStorage.getItem(LS_KEY_PROTECTOR)

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
      showPublicKeyError(dialog)
    }

    throw new Error('Deleting online PIN failed')
  }

  localStorage.removeItem(LS_KEY_PROTECTOR)
  localStorage.removeItem(LS_KEY_PUBLIC_KEY)
  localStorage.removeItem(LS_KEY_RANDOM_STRING)
}
