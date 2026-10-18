import type { ServicesConfig } from '../../../services/types'
import { parse } from '../../../services/features/lib/parse'

import {
  fromHex,
  encryptBlob,
  readServices,
  stringifyServices,
  toHex,
} from './blob'
import { VaultClosedError } from './types'
import type { Vault, VaultSession, VaultStorage } from './types'

/**
 * Creates the vault for an active session. The session supplies the storage
 * key name and the AES key; the storage supplies persistence. Both are
 * injected, which is what lets tests run without a browser.
 */
export const createVault = (
  session: VaultSession,
  storage: VaultStorage = localStorage,
): Vault => {
  let closed = false

  const assertOpen = () => {
    if (closed) {
      throw new VaultClosedError()
    }
  }

  const read = async (): Promise<ServicesConfig | null> => {
    assertOpen()

    const hex = storage.getItem(session.lsKey)

    if (!hex) {
      return null
    }

    let services: ServicesConfig | null

    try {
      services = await readServices(
        fromHex(hex),
        session.cryptoKey,
        session.legacyIv,
      )
    } catch {
      services = null
    }

    if (services === null) {
      // Unreadable or corrupt: drop it, as the app always has.
      storage.removeItem(session.lsKey)
    }

    return services
  }

  const write = async (services: ServicesConfig): Promise<void> => {
    assertOpen()

    const blob = await encryptBlob(stringifyServices(services), session.cryptoKey)

    storage.setItem(session.lsKey, toHex(blob))
  }

  const clear = async (): Promise<void> => {
    assertOpen()
    storage.removeItem(session.lsKey)
  }

  const exportBytes = async (): Promise<Uint8Array | null> => {
    assertOpen()

    const hex = storage.getItem(session.lsKey)

    return hex ? new Uint8Array(fromHex(hex)) : null
  }

  const importBytes = async (
    bytes: ArrayBuffer,
  ): Promise<ServicesConfig | null> => {
    assertOpen()

    return readServices(bytes, session.cryptoKey, session.legacyIv)
  }

  const importText = async (text: string): Promise<ServicesConfig | null> => {
    assertOpen()

    // Pasted plaintext (a JSON export) parses directly; anything else is
    // treated as an encrypted hex blob. Both are legitimate import paths.
    const plain = parse(text)

    if (plain.length > 0) {
      return plain
    }

    try {
      return await readServices(
        fromHex(text.trim()),
        session.cryptoKey,
        session.legacyIv,
      )
    } catch {
      return null
    }
  }

  const close = () => {
    closed = true
  }

  return { read, write, clear, exportBytes, importBytes, importText, close }
}
