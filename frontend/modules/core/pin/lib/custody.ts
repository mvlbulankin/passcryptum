import {
  base64ToBuffer,
  base64ToUint8Array,
  bufferToBase64,
  createAesKey,
  decrypt,
  encrypt,
  generateRandomString,
  getBufferOfText,
  getKeyPairFromSeed,
  parseOriginBuffer,
  pbkdf2,
  uint8ArrayToBase64,
} from '../../shared'
import { WireError, wire as defaultWire } from '../../wire'
import type { WireClient } from '../../wire'
import {
  LS_KEY_MODE,
  LS_KEY_PIN,
  LS_KEY_PROTECTOR,
  LS_KEY_PUBLIC_KEY,
  LS_KEY_ONLINE_RANDOM_STRING,
  LS_KEY_RANDOM_STRING,
  ORIGIN_BUFFER_BYTE_LENGTH,
  PIN_BUFFER_BYTE_LENGTH,
  PIN_BUFFER_ITERATIONS,
  WIRE_PIN_ITERATIONS,
} from '../../constants'
import type {
  CustodyKind,
  CustodyMode,
  CustodyReason,
  CustodyStorage,
  PinCustody,
  ReleaseOutcome,
  RevokeOutcome,
  StoreOutcome,
} from './types'

// AES-CBC pads a block-aligned 256-byte buffer with one full block, and
// base64 encodes three bytes as four characters. The stored-blob length is
// derived from the Origin Buffer length, not hardcoded: a buffer-length
// change must not silently brick every stored PIN (this used to be a bare
// `364` with nothing connecting it to the 256 it came from).
const AES_BLOCK_BYTES = 16

const PIN_BLOB_B64_LENGTH =
  4 * Math.ceil((ORIGIN_BUFFER_BYTE_LENGTH + AES_BLOCK_BYTES) / 3)

const isValidPinBlob = (blob: string): boolean =>
  blob.length === PIN_BLOB_B64_LENGTH && /^[A-Za-z0-9+/=]+$/.test(blob)

/** The offline blob, validated; unreadable entries are dropped. */
const getStoredPinBlob = (storage: CustodyStorage): string | null => {
  const blob = storage.getItem(LS_KEY_PIN)

  if (!blob || !isValidPinBlob(blob)) {
    storage.removeItem(LS_KEY_PIN)

    return null
  }

  return blob
}

/**
 * The AES key and IV that protect the Origin Buffer at rest, derived from
 * the PIN and the per-install random string.
 */
const pinAesData = async (pin: string, random: string) => {
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

/**
 * The protocol's wire value for the Hashed-Pin header (ADR-0003): the bare
 * SHA-512 of the PIN stretched with PBKDF2-SHA512 salted by the profile's
 * public key, so a captured header costs ~600k iterations per guess. The
 * public key is the salt because it is known to the client both when
 * creating a Credential and when authenticating.
 */
const computeWireHashedPin = async (
  pin: string,
  publicKey: Uint8Array,
): Promise<Uint8Array> => {
  const pinHash = new Uint8Array(
    await crypto.subtle.digest('SHA-512', new TextEncoder().encode(pin)),
  )

  const salt = new Uint8Array(publicKey)

  const key = await crypto.subtle.importKey(
    'raw',
    pinHash.buffer,
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-512',
      salt: salt.buffer,
      iterations: WIRE_PIN_ITERATIONS,
    },
    key,
    32 * 8,
  )

  return new Uint8Array(bits)
}

const fail = (reason: CustodyReason): { ok: false; reason: CustodyReason } => ({
  ok: false,
  reason,
})

/** A wire failure becomes a custody outcome; forbidden means one thing per
 * operation, so the caller says what. */
const wireFailure = (
  e: unknown,
  forbidden: CustodyReason,
): { ok: false; reason: CustodyReason } => {
  if (e instanceof WireError) {
    if (e.kind === 'forbidden') {
      return fail(forbidden)
    }

    if (e.kind === 'network') {
      return fail('network')
    }
  }

  return fail('unexpected')
}

export const createPinCustody = (
  deps: { storage?: CustodyStorage; wire?: WireClient } = {},
): PinCustody => {
  // globalThis.localStorage (not the bare global): importing this module in
  // a non-browser context must not throw at module scope.
  const storage = deps.storage ?? globalThis.localStorage
  const wireClient = deps.wire ?? defaultWire

  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())

  /**
   * A custody's salt. Each custody owns one: the offline blob and the online
   * Credential are sealed independently, so setting, re-setting or revoking
   * one can never invalidate the other. A device with no salt stored has
   * none (the PIN alone keys the blob) — see storeOffline.
   */
  const saltOf = (kind: CustodyKind) =>
    storage.getItem(
      kind === 'online' ? LS_KEY_ONLINE_RANDOM_STRING : LS_KEY_RANDOM_STRING,
    ) ?? ''

  const mode = (): CustodyMode =>
    storage.getItem(LS_KEY_MODE) === 'Online' ? 'online' : 'offline'

  const storeOffline = async (
    pin: string,
    buffer: ArrayBuffer,
  ): Promise<StoreOutcome> => {
    // Generated here rather than reused when absent: a device that never set
    // an online PIN used to encrypt under an empty salt, which `docs/pin.md`
    // did not mention and which made the PIN the only cost of a guess.
    const salt = saltOf('offline') || generateRandomString()

    try {
      const { iv, key } = await pinAesData(pin, salt)

      storage.setItem(
        LS_KEY_PIN,
        bufferToBase64(await encrypt(iv, key, buffer)),
      )
      storage.setItem(LS_KEY_RANDOM_STRING, salt)
      notify()

      return { ok: true }
    } catch {
      return fail('unexpected')
    }
  }

  const storeOnline = async (
    pin: string,
    buffer: ArrayBuffer,
  ): Promise<StoreOutcome> => {
    // The online custody's own salt, distinct from the offline one so the
    // two cannot invalidate each other. A fresh one per hand-over, persisted
    // only on success: a failed hand-over must not re-salt the key an
    // existing custody depends on.
    const salt = saltOf('online') || generateRandomString()

    try {
      const { iv, key } = await pinAesData(pin, salt)
      const encrypted = new Uint8Array(await encrypt(iv, key, buffer))

      const { keyPairSeedBuffer } = parseOriginBuffer(buffer)
      const keyPairSeed = new Uint8Array(keyPairSeedBuffer)
      const { publicKey } = getKeyPairFromSeed(keyPairSeed)

      const hashedPin = await computeWireHashedPin(pin, publicKey)

      const protector = await wireClient.createCredential(
        keyPairSeed,
        hashedPin,
        encrypted,
      )

      storage.setItem(LS_KEY_ONLINE_RANDOM_STRING, salt)
      storage.setItem(LS_KEY_PUBLIC_KEY, uint8ArrayToBase64(publicKey))
      storage.setItem(LS_KEY_PROTECTOR, uint8ArrayToBase64(protector))
      notify()

      return { ok: true }
    } catch (e) {
      return wireFailure(e, 'unknownProfile')
    }
  }

  const releaseOffline = async (pin: string): Promise<ReleaseOutcome> => {
    const blob = getStoredPinBlob(storage)

    if (!blob) {
      return fail('noStoredBuffer')
    }

    try {
      const { iv, key } = await pinAesData(pin, saltOf('offline'))
      const buffer = await decrypt(iv, key, base64ToBuffer(blob))

      return { ok: true, buffer }
    } catch {
      // A well-formed blob that does not open under this PIN: the PIN is
      // what unlocks it (corruption is indistinguishable), so wrongPin is
      // the actionable answer.
      return fail('wrongPin')
    }
  }

  const releaseOnline = async (pin: string): Promise<ReleaseOutcome> => {
    const publicKey = storage.getItem(LS_KEY_PUBLIC_KEY)
    const protector = storage.getItem(LS_KEY_PROTECTOR)

    if (!publicKey || !protector) {
      return fail('noStoredBuffer')
    }

    try {
      const hashedPin = await computeWireHashedPin(
        pin,
        base64ToUint8Array(publicKey),
      )

      const entropy = await wireClient.getEntropy(
        base64ToUint8Array(publicKey),
        hashedPin,
        base64ToUint8Array(protector),
      )

      const { iv, key } = await pinAesData(pin, saltOf('online'))
      const buffer = await decrypt(iv, key, Uint8Array.from(entropy).buffer)

      return { ok: true, buffer }
    } catch (e) {
      if (e instanceof WireError) {
        // The server answers a bare 403 to a wrong PIN, a stale device
        // record and a lockout alike: indistinguishable, so one answer.
        if (e.kind === 'forbidden') {
          return fail('wrongPin')
        }

        if (e.kind === 'network') {
          return fail('network')
        }
      }

      return fail('unexpected')
    }
  }

  const revokeOffline = (): RevokeOutcome => {
    storage.removeItem(LS_KEY_PIN)
    notify()

    return { ok: true }
  }

  const revokeOnline = async (): Promise<RevokeOutcome> => {
    const publicKey = storage.getItem(LS_KEY_PUBLIC_KEY)
    const protector = storage.getItem(LS_KEY_PROTECTOR)

    if (!publicKey || !protector) {
      return fail('noStoredBuffer')
    }

    try {
      await wireClient.deleteCredential(
        base64ToUint8Array(publicKey),
        base64ToUint8Array(protector),
      )
    } catch (e) {
      return wireFailure(e, 'unknownCredential')
    }

    storage.removeItem(LS_KEY_PROTECTOR)
    storage.removeItem(LS_KEY_PUBLIC_KEY)
    // The online salt only. The offline custody's salt is not ours to touch:
    // deleting it used to silently kill a PIN the user still had set.
    storage.removeItem(LS_KEY_ONLINE_RANDOM_STRING)
    notify()

    return { ok: true }
  }

  return {
    store: (kind: CustodyKind, pin, buffer) =>
      kind === 'online' ? storeOnline(pin, buffer) : storeOffline(pin, buffer),

    release: async pin =>
      mode() === 'online' ? releaseOnline(pin) : releaseOffline(pin),

    revoke: (kind: CustodyKind) =>
      kind === 'online' ? revokeOnline() : Promise.resolve(revokeOffline()),

    isSet(kind: CustodyKind) {
      if (kind === 'offline') {
        return getStoredPinBlob(storage) !== null
      }

      return Boolean(
        storage.getItem(LS_KEY_PUBLIC_KEY) &&
        storage.getItem(LS_KEY_PROTECTOR) &&
        storage.getItem(LS_KEY_ONLINE_RANDOM_STRING),
      )
    },

    mode,

    setMode(next: CustodyMode) {
      storage.setItem(LS_KEY_MODE, next === 'online' ? 'Online' : 'Offline')
      notify()
    },

    subscribe(listener) {
      listeners.add(listener)

      return () => void listeners.delete(listener)
    },
  }
}
