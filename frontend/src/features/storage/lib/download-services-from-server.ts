import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import { decryptData, getSession, getVault, isForbidden, wire } from '#/core'
import { checkForEmptiness } from '#/services'

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
      const envelope = await wire.getServices(keyPairSeed)

      if (!envelope) {
        message.error('Services not found on server')

        return
      }

      // Unwrap the transport layer, then hand the bytes to the vault: it is
      // the only module that knows the storage format.
      const bytes = decryptData(envelope, secretBoxIv, secretBoxKey)

      if (!bytes) {
        throw new Error('Failed to decrypt data')
      }

      const config = await getVault().importBytes(new Uint8Array(bytes).buffer)

      if (!config || checkForEmptiness(config)) {
        throw new Error('Downloaded vault is empty')
      }

      await importServices(config)
      message.success('Services have been downloaded from server successfully')
    } catch (e) {
      if (isForbidden(e)) {
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
