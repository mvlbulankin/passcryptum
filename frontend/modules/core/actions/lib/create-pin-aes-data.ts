import { pbkdf2, createAesKey, getBufferOfText } from '../../shared'
import {
  PIN_BUFFER_ITERATIONS,
  PIN_BUFFER_BYTE_LENGTH,
  LS_KEY_RANDOM_STRING,
} from '../../constants'
import type { SessionStorage } from '../../session/lib/types'

/**
 * The AES key and IV that protect the Origin Buffer at rest, derived from
 * the PIN and the per-install random string. Takes the storage explicitly:
 * the session owns persistence, this helper must not reach for a global.
 */
export const createPinAesData = async (
  pin: string,
  storage: SessionStorage,
) => {
  const random = storage.getItem(LS_KEY_RANDOM_STRING) ?? ''

  const buffer = await pbkdf2(
    getBufferOfText([pin, random].join()),
    PIN_BUFFER_BYTE_LENGTH,
    PIN_BUFFER_ITERATIONS,
  )

  return {
    iv: buffer.slice(0, 16),
    key: await createAesKey(buffer.slice(16)),
  }
}
