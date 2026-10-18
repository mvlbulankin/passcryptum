import { base64ToBuffer, bufferToBase64 } from '#/core'

import { isOnlineMode } from '@/features/online-mode'
import { parseOriginBuffer } from '../lib/parse-origin-buffer'
import { stringify } from '../../../services/features/lib/stringify'
import { ActiveSession, StarterKit } from '../types'

import { createVault, type Vault } from '../../vault'
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

let session: ActiveSession | null = null
let activeVault: Vault | null = null

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

  // The vault is created with the session and dies with it.
  activeVault = createVault({ lsKey, cryptoKey, legacyIv: iv })

  const services = await activeVault.read()

  return {
    id,
    data: services === null ? null : stringify(services),
  }
}

/** The vault of the active session. Throws when there is no session. */
export const getVault = (): Vault => {
  if (!activeVault) {
    throw new Error('Attempt to access an inactive session')
  }

  return activeVault
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

// Zeroize the secret material on logout instead of only dropping the
// references (the README defines logout as "deletion of these data from the
// RAM"). CryptoKey is non-extractable already; the rest are buffers we own.
const zeroizeSession = (s: ActiveSession) => {
  new Uint8Array(s.iv).fill(0)
  new Uint8Array(s.entropy).fill(0)
  new Uint8Array(s.originBuffer).fill(0)
  s.keyPairSeed.fill(0)
  s.secretBoxIv.fill(0)
  s.secretBoxKey.fill(0)
}

export const exit = () => {
  if (session) {
    zeroizeSession(session)
  }

  activeVault?.close()
  activeVault = null
  session = null
}
