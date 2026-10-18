// Session module types. The interface speaks domain facts (identity, keys,
// mode); the Origin Buffer layout, PIN derivation and persistence stay
// behind the seam.

import type { Vault } from '../../vault'

export type SessionMode = 'online' | 'offline'

/** Persistence the session needs. localStorage satisfies it. */
export type SessionStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type SessionDeps = {
  storage?: SessionStorage
}

/** What a caller learns from a successful entry. */
export type StarterKit = {
  /** Four-letter Profile id derived from the Origin Buffer. */
  id: string
  /** Stored Services as JSON, or null when this device has none yet. */
  services: string | null
}

/** The two keys that wrap the vault for transport over the Wire Protocol. */
export type TransportKeys = {
  secretBoxIv: Uint8Array
  secretBoxKey: Uint8Array
}

export type Session = {
  enter(password: string): Promise<StarterKit>
  enterWithPin(pin: string): Promise<StarterKit>
  exit(): void

  isActive(): boolean
  subscribe(listener: () => void): () => void

  // Secrets — each throws SessionClosedError once the session is gone.
  profileId(): string
  publicKey(): Uint8Array
  keyPairSeed(): Uint8Array
  entropy(): Uint8Array
  originBuffer(): ArrayBuffer
  transportKeys(): TransportKeys
  vault(): Vault

  mode(): SessionMode
  setMode(mode: SessionMode): void

  /** PIN availability, derived from storage — never a stale copy. */
  isOnlinePinSet(): boolean
  isOfflinePinSet(): boolean

  hasVisited(): boolean
  markVisited(): void
}

/** Use of a session that has ended: nothing secret is available any more. */
export class SessionClosedError extends Error {
  constructor() {
    super('The session is not active')
    this.name = 'SessionClosedError'
  }
}
