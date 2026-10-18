import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import {
  encryptData,
  getSession,
  getVault,
  isForbidden,
  wire,
} from '#/core'

import { showStorageDrawer } from '@/features/storage/model'

import { showPublicKeyError } from './public-key-error'

export const useUploadServices = () => {
  const dialog = useDialog()
  const message = useMessage()
  const loadingBar = useLoadingBar()

  const uploadServices = async () => {
    loadingBar.start()

    try {
      // The vault knows how Services are stored; the transport wraps those
      // bytes in a secretbox bound to this session's keys. Two concerns,
      // two owners — the composition is three lines.
      const bytes = await getVault().exportBytes()

      if (!bytes) {
        message.error('There is nothing to upload')

        return
      }

      const { keyPairSeed, secretBoxIv, secretBoxKey } = getSession()
      const envelope = encryptData(bytes, secretBoxIv, secretBoxKey)

      await wire.setServices(keyPairSeed, envelope)
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

  return { uploadServices }
}
