import axios from 'axios'
import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import {
  getSession,
  createSignature,
  getKeyPairFromSeed,
  uint8ArrayToBase64,
  generateTimestamp,
} from '#/core'

import { showStorageDrawer } from '@/features/storage/model'

import { showPublicKeyError } from './public-key-error'

export const useDeleteServices = () => {
  const dialog = useDialog()
  const message = useMessage()
  const loadingBar = useLoadingBar()

  const deleteServices = async () => {
    loadingBar.start()

    try {
      const { keyPairSeed } = getSession()
      const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)
      const timestamp = generateTimestamp()
      const signature = createSignature(timestamp, secretKey)

      const response = await axios.delete(
        'https://passcryptum.ddns.net/api/profiles/',
        {
          headers: {
            'Content-Type': 'application/json',
            'Public-Key': uint8ArrayToBase64(publicKey),
            'Timestamp': uint8ArrayToBase64(timestamp),
            'Signature': uint8ArrayToBase64(signature),
          },
        },
      )

      if (response.status === 200) {
        message.success('All of your services have been deleted from server')
      } else if (response.status === 204) {
        message.success(
          'All of your services have already been deleted from server',
        )
      } else {
        throw new Error('Unexpected response status')
      }
    } catch (e) {
      if (
        e instanceof Error &&
        e.message === 'Request failed with status code 403'
      ) {
        showPublicKeyError(dialog)
      } else {
        console.error('An unknown error occurred:', e)
      }
    } finally {
      loadingBar.finish()
      showStorageDrawer.value = false
    }
  }

  return { deleteServices }
}
