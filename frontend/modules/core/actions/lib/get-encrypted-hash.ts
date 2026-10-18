import { base64ToUint8Array } from '#/core'

import { wire } from '../../wire'
import type { SessionStorage } from '../../session/lib/types'
import { computeWireHashedPin } from './compute-wire-hashed-pin'
import {
  LS_KEY_PIN,
  LS_KEY_PROTECTOR,
  LS_KEY_PUBLIC_KEY,
} from '../../constants'

const validateEncryptedHash = (hash: string): boolean =>
  hash.length === 364 && /^[A-Za-z0-9+/=]+$/.test(hash)

export const getEncryptedHash = (storage: SessionStorage): string | null => {
  const hash = storage.getItem(LS_KEY_PIN)

  if (!hash || !validateEncryptedHash(hash)) {
    storage.removeItem(LS_KEY_PIN)

    return null
  }

  return hash
}

export const getEncryptedOnlineHash = async (
  pin: string,
  storage: SessionStorage,
) => {
  const publicKey = storage.getItem(LS_KEY_PUBLIC_KEY)
  const protector = storage.getItem(LS_KEY_PROTECTOR)

  if (!publicKey || !protector) {
    throw new Error('Getting online PIN failed')
  }

  try {
    // v2 wire value: PBKDF2-stretched with the public key as salt (ADR-0001)
    const hashedPin = await computeWireHashedPin(
      pin,
      base64ToUint8Array(publicKey),
    )

    const entropy = await wire.getEntropy(
      base64ToUint8Array(publicKey),
      hashedPin,
      base64ToUint8Array(protector),
    )

    return Uint8Array.from(entropy).buffer
  } catch {
    throw new Error('Getting online PIN failed')
  }
}
