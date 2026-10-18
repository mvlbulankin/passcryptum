import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import { getSession, encryptData, getDataAsBuffer, wire, isForbidden  } from '#/core'

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

      const { keyPairSeed, secretBoxIv, secretBoxKey } = getSession()

      const encryptedServices = encryptData(
        new Uint8Array(buffer),
        secretBoxIv,
        secretBoxKey,
      )

      await wire.setServices(keyPairSeed, encryptedServices)

      message.success('Services have been uploaded to server successfully')
    } catch (e) {
      if (isForbidden(e)) {
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
