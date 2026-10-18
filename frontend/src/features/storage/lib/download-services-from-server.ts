import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import { getSession, decryptData, readData, wire, isForbidden  } from '#/core'
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
      const encrypted = await wire.getServices(keyPairSeed)

      if (!encrypted) {
        message.error('Services not found on server')

        return
      }

      const decryptedData = decryptData(encrypted, secretBoxIv, secretBoxKey)

      if (!decryptedData) {
        throw new Error('Failed to decrypt data')
      }

      const decryptedServices = new Uint8Array(decryptedData)
      const parsedServices = parse(await readData(decryptedServices.buffer))

      if (checkForEmptiness(parsedServices)) {
        throw new Error('Parsed services is empty')
      }

      await importServices(parsedServices)
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
