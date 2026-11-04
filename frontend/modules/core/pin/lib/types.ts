/** The two custodies a device can hold. Both can be set at once. */
export type CustodyKind = 'online' | 'offline'

/** Where login material comes from; also the app's online/offline mode. */
export type CustodyMode = 'online' | 'offline'

/**
 * Why a custody operation failed. A closed vocabulary: the UI maps these to
 * texts, nothing string-matches error messages. Kinds the operation cannot
 * produce are simply never returned (store answers no wrongPin; release
 * answers no unknownProfile — the server's bare 403 cannot tell them apart).
 */
export type CustodyReason =
  | 'wrongPin' // release: the PIN does not unlock what is stored
  | 'noStoredBuffer' // nothing of this kind is stored on the device
  | 'unknownProfile' // store online: the Profile is not onboarded (403)
  | 'unknownCredential' // revoke online: the Credential is already gone (403)
  | 'network'
  | 'unexpected'

/** Persistence the custody needs. localStorage satisfies it. */
export type CustodyStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type StoreOutcome = { ok: true } | { ok: false; reason: CustodyReason }

export type RevokeOutcome = StoreOutcome

export type ReleaseOutcome =
  { ok: true; buffer: ArrayBuffer } | { ok: false; reason: CustodyReason }

/**
 * PIN Custody (GLOSSARY): the device's arrangement for holding the Origin
 * Buffer under a PIN — online as a Credential on the server, offline as an
 * encrypted blob. Everything else (KDFs, the localStorage record, the wire
 * calls, the derived blob length) is implementation behind this interface.
 */
export type PinCustody = {
  /** Hand the Origin Buffer over, to be held under the PIN. */
  store(
    kind: CustodyKind,
    pin: string,
    buffer: ArrayBuffer,
  ): Promise<StoreOutcome>

  /**
   * Take the Origin Buffer back under a PIN. The source — server or local
   * blob — follows the stored mode; callers never choose it.
   */
  release(pin: string): Promise<ReleaseOutcome>

  /** Drop the custody of one kind. Never touches the Origin Buffer itself. */
  revoke(kind: CustodyKind): Promise<RevokeOutcome>

  /** Derived from storage on each read, never a stale snapshot. */
  isSet(kind: CustodyKind): boolean

  mode(): CustodyMode
  setMode(mode: CustodyMode): void

  subscribe(listener: () => void): () => void
}
