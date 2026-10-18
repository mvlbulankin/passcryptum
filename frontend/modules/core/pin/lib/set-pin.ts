import {
  bufferToBase64,
  uint8ArrayToBase64,
  encrypt,
  generateRandomString,
} from '../../shared'
import { wire, isForbidden } from '../../wire'
import {
  LS_KEY_PIN,
  LS_KEY_PROTECTOR,
  LS_KEY_PUBLIC_KEY,
  LS_KEY_RANDOM_STRING,
} from '../../constants'
import { createPinAesData, computeWireHashedPin } from '../../actions'
import type { Session, SessionStorage } from '../../session'

/** Stores the Origin Buffer locally, encrypted under the PIN. */
export const setOfflinePin = async (
  session: Session,
  storage: SessionStorage,
  pin: string,
) => {
  const { iv, key } = await createPinAesData(pin, storage)

  storage.setItem(
    LS_KEY_PIN,
    bufferToBase64(await encrypt(iv, key, session.originBuffer())),
  )
}

/** Publishes the Origin Buffer to the server under a PIN; returns the protector. */
export const setOnlinePin = async (
  session: Session,
  storage: SessionStorage,
  pin: string,
) => {
  storage.setItem(LS_KEY_RANDOM_STRING, generateRandomString())

  const { iv, key } = await createPinAesData(pin, storage)

  const encryptedOriginBuffer = new Uint8Array(
    await encrypt(iv, key, session.originBuffer()),
  )

  const publicKey = session.publicKey()
  const hashedPin = await computeWireHashedPin(pin, publicKey)

  try {
    const protector = await wire.createCredential(
      session.keyPairSeed(),
      hashedPin,
      encryptedOriginBuffer,
    )

    storage.setItem(LS_KEY_PUBLIC_KEY, uint8ArrayToBase64(publicKey))
    storage.setItem(LS_KEY_PROTECTOR, uint8ArrayToBase64(protector))

    return { success: true as const }
  } catch (e) {
    if (isForbidden(e)) {
      return { success: false as const, reason: '403' as const }
    }

    throw e instanceof Error ? e : new Error(String(e))
  }
}
