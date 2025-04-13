import axios from 'axios'
import { useDialog } from 'naive-ui'
import { uint8ArrayToBase64, generateTimestamp } from '#/core'

import { showPublicKeyError } from '@/features/storage/lib/public-key-error'

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
  const timestamp = generateTimestamp()

  try {
    const response = await axios.delete(
      'https://passcryptum.ddns.net/api/credentials/',
      {
        headers: {
          'Content-Type': 'application/json',
          'Public-Key': publicKey,
          'Protector': protector,
          'Timestamp': uint8ArrayToBase64(timestamp),
        },
      },
    )

    if (response.status === 200) {
      localStorage.removeItem(LS_KEY_PROTECTOR)
      localStorage.removeItem(LS_KEY_PUBLIC_KEY)
      localStorage.removeItem(LS_KEY_RANDOM_STRING)
    } else {
      throw new Error('Unexpected response status')
    }
  } catch (e) {
    if (
      e instanceof Error &&
      e.message === 'Request failed with status code 403'
    ) {
      showPublicKeyError(dialog)
    }

    throw new Error('Deleting online PIN failed')
  }
}
