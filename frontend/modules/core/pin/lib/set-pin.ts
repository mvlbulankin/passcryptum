import axios from 'axios'
import { useDialog } from 'naive-ui'
import {
  bufferToBase64,
  createSignature,
  generateTimestamp,
  getKeyPairFromSeed,
  uint8ArrayToBase64,
} from '#/core'

import { showPublicKeyError } from '@/features/storage/lib/public-key-error'

import {
  LS_KEY_PIN,
  LS_KEY_PROTECTOR,
  LS_KEY_PUBLIC_KEY,
  LS_KEY_RANDOM_STRING,
} from '../../constants'
import {
  encrypt,
  getHashOfString,
  concatUint8Arrays,
  generateRandomString,
} from '../../shared'
import { getSession } from '../../session'
import { createPinAesData } from '../../actions'

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
  const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)

  const encryptedOriginBuffer = new Uint8Array(
    await encrypt(iv, key, originBuffer),
  )

  const timestamp = generateTimestamp()
  const combinedData = concatUint8Arrays(timestamp, encryptedOriginBuffer)
  const signature = createSignature(combinedData, secretKey)
  const requestData = concatUint8Arrays(signature, combinedData)
  const hashedPin = await getHashOfString(pin)

  try {
    const response = await axios.post(
      'https://passcryptum.ddns.net/api/credentials/',
      uint8ArrayToBase64(requestData),
      {
        headers: {
          'Content-Type': 'application/json',
          'Public-Key': uint8ArrayToBase64(publicKey),
          'Hashed-Pin': uint8ArrayToBase64(hashedPin),
        },
      },
    )

    if (response.status === 200) {
      localStorage.setItem(LS_KEY_PUBLIC_KEY, uint8ArrayToBase64(publicKey))
      localStorage.setItem(LS_KEY_PROTECTOR, response.data)

      return { success: true }
    }

    throw new Error('Unexpected response status')
  } catch (e) {
    if (
      e instanceof Error &&
      e.message === 'Request failed with status code 403'
    ) {
      showPublicKeyError(dialog)

      return { success: false, reason: '403' }
    }

    throw new Error('Setting online PIN failed')
  }
}
