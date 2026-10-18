import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import { wire, isForbidden } from '#/core'

import { session } from '@/entities/session'
import { showStorageDrawer } from '@/features/storage/model'

import { showPublicKeyError } from './public-key-error'

export const useDeleteServices = () => {
  const dialog = useDialog()
  const message = useMessage()
  const loadingBar = useLoadingBar()

  const deleteServices = async () => {
    loadingBar.start()

    try {
      const keyPairSeed = session.keyPairSeed()
      const result = await wire.clearServices(keyPairSeed)

      if (result === 'cleared') {
        message.success('All of your services have been deleted from server')
      } else {
        message.success(
          'All of your services have already been deleted from server',
        )
      }
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

  return { deleteServices }
}
