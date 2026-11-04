import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import { decryptData, isForbidden, wire } from '#/core'
import { checkForEmptiness } from '#/services'

import { runBlocking, session, importServices } from '@/entities/session'
import { showStorageDrawer } from '@/features/storage/model'

import { showPublicKeyError } from './public-key-error'

export const useDownloadServices = () => {
  const dialog = useDialog()
  const message = useMessage()
  const loadingBar = useLoadingBar()

  const downloadServices = async () => {
    try {
      await runBlocking(async () => {
        const { secretBoxIv, secretBoxKey } = session.transportKeys()
        const envelope = await wire.getServices(session.keyPairSeed())

        if (!envelope) {
          message.error('Services not found on server')

          return
        }

        // Unwrap the transport layer, then hand the bytes to the vault: it
        // is the only module that knows the storage format.
        const bytes = decryptData(envelope, secretBoxIv, secretBoxKey)

        if (!bytes) {
          throw new Error('Failed to decrypt data')
        }

        const config = await session
          .vault()
          .importBytes(new Uint8Array(bytes).buffer)

        if (!config || checkForEmptiness(config)) {
          throw new Error('Downloaded vault is empty')
        }

        await importServices(config)
        message.success(
          'Services have been downloaded from server successfully',
        )
      }, loadingBar)
    } catch (e) {
      if (isForbidden(e)) {
        showPublicKeyError(dialog)
      } else {
        console.error('An unknown error occurred:', e)
        message.error('An error occurred while downloading services')
      }
    } finally {
      showStorageDrawer.value = false
    }
  }

  return { downloadServices }
}
