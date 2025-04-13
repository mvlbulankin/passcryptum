import axios from 'axios'
import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import {
  readData,
  getSession,
  decryptData,
  createSignature,
  getKeyPairFromSeed,
  base64ToUint8Array,
  uint8ArrayToBase64,
  generateTimestamp,
} from '#/core'
import { parse, checkForEmptiness } from '#/services'

import { importServices } from '@/entities/session'
import { showStorageDrawer } from '@/features/storage/model'

import { showPublicKeyError } from './public-key-error'

export const useDownloadServices = () => {
  const dialog = useDialog()
  const message = useMessage()
  const loadingBar = useLoadingBar()

  const downloadServices = async () => {
    loadingBar.start()

    try {
      const { keyPairSeed, secretBoxIv, secretBoxKey } = getSession()
      const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)

      const timestamp = generateTimestamp()
      const signature = createSignature(timestamp, secretKey)

      const response = await axios.get(
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
        const encryptedData = base64ToUint8Array(response.data)

        const decryptedData = decryptData(
          encryptedData,
          secretBoxIv,
          secretBoxKey,
        )

        if (!decryptedData) {
          throw new Error('Failed to decrypt data')
        }

        const decryptedServices = new Uint8Array(decryptedData)
        const parsedServices = parse(await readData(decryptedServices.buffer))

        if (checkForEmptiness(parsedServices)) {
          throw new Error('Parsed services is empty')
        }

        await importServices(parsedServices)
        message.success(
          'Services have been downloaded from server successfully',
        )
      } else if (response.status === 204) {
        message.error('Services not found on server')
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
        message.error('An error occurred while downloading services')
      }
    } finally {
      loadingBar.finish()
      showStorageDrawer.value = false
    }
  }

  return { downloadServices }
}
