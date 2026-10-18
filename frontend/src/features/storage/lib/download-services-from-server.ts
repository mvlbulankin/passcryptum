import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import { decryptBlob, decryptData, getSession, isForbidden, wire } from '#/core'
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
      const { keyPairSeed, cryptoKey, iv, secretBoxIv, secretBoxKey } = getSession()
      const encrypted = await wire.getServices(keyPairSeed)

      if (!encrypted) {
        message.error('Services not found on server')

        return
      }

      // The server holds the vault blob as stored locally: the 0x01-marked
      // AES envelope (marker ‖ per-save IV ‖ ciphertext, see save-data.ts).
      // It is AES, not secretbox — decryptBlob is the reader for both the v2
      // envelope and the legacy static-IV layout.
      // Two layers, in order: secretbox (transport, session-bound) then the
      // local AES envelope (0x01 marker ‖ per-save IV ‖ ciphertext).
      const envelope = decryptData(encrypted, secretBoxIv, secretBoxKey)

      if (!envelope) {
        throw new Error('Failed to decrypt data')
      }

      const plaintext = await decryptBlob(
        new Uint8Array(envelope).buffer,
        iv,
        cryptoKey,
      )

      if (!plaintext) {
        throw new Error('Failed to read downloaded services')
      }

      const parsedServices = parse(plaintext)

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
