import { useDialog } from 'naive-ui'
import { bufferToBase64, getKeyPairFromSeed, uint8ArrayToBase64 } from '#/core'

import { showPublicKeyError } from '@/features/storage/lib/public-key-error'

import { wire, isForbidden } from '../../wire'
import {
  LS_KEY_PIN,
  LS_KEY_PROTECTOR,
  LS_KEY_PUBLIC_KEY,
  LS_KEY_RANDOM_STRING,
} from '../../constants'
import { encrypt, generateRandomString } from '../../shared'
import { getSession } from '../../session'
import { createPinAesData, computeWireHashedPin } from '../../actions'

export const setOfflinePin = async (pin: string) => {
  const { originBuffer } = getSession()
  const { iv, key } = await createPinAesData(pin)

  localStorage.setItem(
    LS_KEY_PIN,
    bufferToBase64(await encrypt(iv, key, originBuffer)),
  )
}

export const setOnlinePin = async (
  pin: string,
  dialog: ReturnType<typeof useDialog>,
) => {
  const randomString = generateRandomString()

  localStorage.setItem(LS_KEY_RANDOM_STRING, randomString)

  const { iv, key } = await createPinAesData(pin)
  const { keyPairSeed, originBuffer } = getSession()
  const { publicKey } = getKeyPairFromSeed(keyPairSeed)

  const encryptedOriginBuffer = new Uint8Array(
    await encrypt(iv, key, originBuffer),
  )

  try {
    const hashedPin = await computeWireHashedPin(pin, publicKey)

    const protector = await wire.createCredential(
      keyPairSeed,
      hashedPin,
      encryptedOriginBuffer,
    )

    localStorage.setItem(LS_KEY_PUBLIC_KEY, uint8ArrayToBase64(publicKey))
    localStorage.setItem(LS_KEY_PROTECTOR, uint8ArrayToBase64(protector))

    return { success: true }
  } catch (e) {
    if (isForbidden(e)) {
      showPublicKeyError(dialog)

      return { success: false, reason: '403' }
    }

    throw new Error('Setting online PIN failed')
  }
}
