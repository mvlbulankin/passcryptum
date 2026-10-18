// Vault module types. The interface speaks the domain: Services in, Services
// out. Every representation the blob passes through (hex, bytes, envelope,
// AES ciphertext) stays behind this seam.

import type { ServicesConfig } from '../../../services/types'

/** What the vault needs from an active session — nothing else. */
export type VaultSession = {
  lsKey: string
  cryptoKey: CryptoKey
  /** The origin buffer's IV slice, for reading pre-3.0 (static-IV) blobs. */
  legacyIv: ArrayBuffer
}

/** The slice of Web Storage the vault uses. localStorage satisfies it. */
export type VaultStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type Vault = {
  /** Stored Services, or null when there is none (corrupt blobs are dropped). */
  read(): Promise<ServicesConfig | null>
  write(services: ServicesConfig): Promise<void>
  clear(): Promise<void>
  /** The encrypted blob as bytes, for export to a file. */
  exportBytes(): Promise<Uint8Array | null>
  /** Reads bytes produced by exportBytes (or an older device's file). */
  importBytes(bytes: ArrayBuffer): Promise<ServicesConfig | null>
  /** Reads pasted text: plaintext JSON or an encrypted blob. */
  importText(text: string): Promise<ServicesConfig | null>
  close(): void
}

/** Use after close: the session is gone, the vault is unusable. */
export class VaultClosedError extends Error {
  constructor() {
    super('Vault used after the session ended')
    this.name = 'VaultClosedError'
  }
}
