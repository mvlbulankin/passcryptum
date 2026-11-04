import type { ServicesConfig } from '../../../services'

import type { Vault } from '../../vault'
import type { WireClient } from '../../wire'

/**
 * What pushing or pulling the Vault needs from the device: the keys the
 * session derived, the vault that owns the storage format, and a way to
 * apply merged Services. Passed per call, so the module holds no singleton
 * and tests speak to it with a real vault and a fake wire.
 */
export type VaultSyncDevice = {
  /** The Ed25519 seed that signs Wire Protocol requests. */
  keyPairSeed: Uint8Array
  /** The secretbox keys that wrap vault bytes for transport. */
  transportKeys(): { secretBoxIv: Uint8Array; secretBoxKey: Uint8Array }
  vault: Vault
  /** Merge pulled Services into the device's own and persist them. */
  apply(services: ServicesConfig): Promise<void> | void
}

/** Why a sync operation failed. A closed vocabulary, like PIN Custody's. */
export type SyncReason = 'unknownProfile' | 'network' | 'unexpected'

export type PushOutcome =
  | { ok: true; result: 'pushed' | 'nothingToPush' }
  | { ok: false; reason: SyncReason }

export type PullOutcome =
  | {
      ok: true
      result: 'pulled' | 'nothingOnServer' | 'corrupt' | 'emptyAfterMerge'
    }
  | { ok: false; reason: SyncReason }

export type ClearOutcome =
  | { ok: true; result: 'cleared' | 'alreadyEmpty' }
  | { ok: false; reason: SyncReason }

/** The wire's own vocabulary for DELETE: what the module reports. */
export type WireClearResult = 'cleared' | 'already-empty'

/**
 * Synchronising the Vault between devices (the reason 3.0 exists). The
 * Zero-Knowledge envelope — vault bytes wrapped in the session's secretbox
 * keys — and the merge policy belong here, behind three operations; UI
 * callers keep only the confirmation dialog and the toast.
 */
export type VaultSync = {
  push(device: VaultSyncDevice): Promise<PushOutcome>
  pull(device: VaultSyncDevice): Promise<PullOutcome>
  clear(device: VaultSyncDevice): Promise<ClearOutcome>
}

export type SyncWire = WireClient
