import axios from 'axios'
import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import {
  getSession,
  encryptData,
  createSignature,
  getDataAsBuffer,
  concatUint8Arrays,
  getKeyPairFromSeed,
  uint8ArrayToBase64,
  generateTimestamp,
} from '#/core'

import { areServicesEmpty } from '@/entities/session'
import { showStorageDrawer } from '@/features/storage/model'

import { showPublicKeyError } from './public-key-error'

export const useUploadServices = () => {
  const dialog = useDialog()
  const message = useMessage()
  const loadingBar = useLoadingBar()

  const uploadServices = async () => {
    loadingBar.start()

    try {
      const buffer = await getDataAsBuffer()

      if (!buffer) {
        throw new Error('Empty buffer when uploading services')
      }

      const services = new Uint8Array(buffer)
      const { keyPairSeed, secretBoxIv, secretBoxKey } = getSession()
      const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)
      const encryptedServices = encryptData(services, secretBoxIv, secretBoxKey)
      const timestamp = generateTimestamp()
      const combinedData = concatUint8Arrays(timestamp, encryptedServices)
      const signature = createSignature(combinedData, secretKey)
      const requestData = concatUint8Arrays(signature, combinedData)

      const response = await axios.post(
        'https://passcryptum.ddns.net/api/profiles/',
        uint8ArrayToBase64(requestData),
        {
          headers: {
            'Content-Type': 'application/json',
            'Public-Key': uint8ArrayToBase64(publicKey),
          },
        },
      )

      if (response.status === 200) {
        message.success('Services have been uploaded to server successfully')
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

  return { uploadServices, areServicesEmpty }
}
