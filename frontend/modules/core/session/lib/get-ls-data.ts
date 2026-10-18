import { decryptBlob } from '../../actions'
import { parseHexToBuffer } from '../../shared'

export const getLsData = async (
  lsKey: string,
  iv: ArrayBuffer,
  key: CryptoKey,
) => {
  const lsData = localStorage.getItem(lsKey)

  if (!lsData) {
    return null
  }

  let buffer: ArrayBuffer | null = null

  try {
    buffer = parseHexToBuffer(lsData)
  } catch (e) {
    void e
  }

  const data = buffer && (await decryptBlob(buffer, iv, key))

  if (!data) {
    localStorage.removeItem(lsKey)

    return null
  }

  return data
}
