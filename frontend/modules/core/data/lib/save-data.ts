import { getSession } from '../../session'
import {
  encrypt,
  getBufferOfText,
  stringifyBuffer,
  concatBuffers,
} from '../../shared'

const BLOB_MARKER = new Uint8Array([0x01]).buffer

// Fresh random IV per encryption (the legacy format used a static IV
// origin buffer, reused for every save of the services blob).
export const saveData = async (data: string) => {
  const { lsKey, cryptoKey } = getSession()
  const iv = crypto.getRandomValues(new Uint8Array(16)).buffer
  const cipher = await encrypt(iv, cryptoKey, getBufferOfText(data))

  localStorage.setItem(
    lsKey,
    stringifyBuffer(concatBuffers(concatBuffers(BLOB_MARKER, iv), cipher)),
  )
}
