import { base64ToBuffer, bufferToBase64 } from '#/core'

import { isOnlineMode } from '@/features/online-mode'

import { decrypt, pbkdf2, createAesKey, getBufferOfText } from '../../shared'
import {
  ORIGIN_BUFFER_ITERATIONS,
  ORIGIN_BUFFER_BYTE_LENGTH,
} from '../../constants'
import {
  getEncryptedHash,
  getEncryptedOnlineHash,
  createPinAesData,
} from '../../actions'
import { getLsData } from '../lib/get-ls-data'
import { parseOriginBuffer } from '../lib/parse-origin-buffer'
import { ActiveSession, StarterKit } from '../types'

let session: ActiveSession | null = null

export const getSession = () => {
  if (!session) {
    throw new Error('Attempt to access an inactive session')
  }

  return session
}

const startSession = async (buffer: ArrayBuffer): Promise<StarterKit> => {
  if (buffer.byteLength !== ORIGIN_BUFFER_BYTE_LENGTH) {
    throw new Error('The origin buffer must be 256 bytes long')
  }

  const {
    id,
    iv,
    lsKey,
    entropy,
    keyPairSeedBuffer,
    secretBoxIvBuffer,
    secretBoxKeyBuffer,
    cryptoKeyBuffer,
  } = parseOriginBuffer(buffer)

  const keyPairSeed = new Uint8Array(keyPairSeedBuffer)
  const secretBoxIv = new Uint8Array(secretBoxIvBuffer)
  const secretBoxKey = new Uint8Array(secretBoxKeyBuffer)
  const cryptoKey = await createAesKey(cryptoKeyBuffer)

  session = {
    iv,
    lsKey,
    entropy,
    cryptoKey,
    keyPairSeed,
    secretBoxIv,
    secretBoxKey,
    originBuffer: buffer,
  }

  return {
    id,
    data: await getLsData(lsKey, iv, cryptoKey),
  }
}

export const enterWithOriginPassword = async (
  password: string,
): Promise<StarterKit> =>
  startSession(
    await pbkdf2(
      getBufferOfText(password),
      ORIGIN_BUFFER_BYTE_LENGTH,
      ORIGIN_BUFFER_ITERATIONS,
    ),
  )

export const enterWithPin = async (pin: string): Promise<StarterKit> => {
  let hash: string

  if (isOnlineMode.value) {
    const onlineHash = await getEncryptedOnlineHash(pin)

    if (!onlineHash) {
      throw new Error('No encrypted hash available online')
    }

    hash = bufferToBase64(onlineHash)
  } else {
    const offlineHash = getEncryptedHash()

    if (!offlineHash) {
      throw new Error('No encrypted hash available locally')
    }

    hash =
      typeof offlineHash === 'string'
        ? offlineHash
        : bufferToBase64(offlineHash)
  }

  const { iv, key } = await createPinAesData(pin)
  const decryptedData = await decrypt(iv, key, base64ToBuffer(hash))

  return startSession(decryptedData)
}

export const exit = () => {
  session = null
}
