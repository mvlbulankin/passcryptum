import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import { encryptData, isForbidden, wire } from '#/core'

import { session } from '@/entities/session'
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
      const bytes = await session.vault().exportBytes()

      if (!bytes) {
        message.error('There is nothing to upload')

        return
      }

      const { secretBoxIv, secretBoxKey } = session.transportKeys()
      const envelope = encryptData(bytes, secretBoxIv, secretBoxKey)

      await wire.setServices(session.keyPairSeed(), envelope)
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
