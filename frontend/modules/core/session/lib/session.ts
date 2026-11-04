import { stringify } from '../../../services'

import { createVault, type Vault } from '../../vault'
import {
  createAesKey,
  getBufferOfText,
  getKeyPairFromSeed,
  parseOriginBuffer,
  pbkdf2,
  uint8ArrayToBase64,
} from '../../shared'
import { pinCustody } from '../../pin'
import {
  ORIGIN_BUFFER_BYTE_LENGTH,
  ORIGIN_BUFFER_ITERATIONS,
  LS_KEY_VISITED,
} from '../../constants'
import { SessionClosedError, PinReleaseError } from './types'
import type {
  Session,
  SessionDeps,
  SessionMode,
  StarterKit,
  TransportKeys,
} from './types'

/**
 * Creates a session over a storage. The session owns everything that belongs
 * to "being logged in": the derailed secret material, the vault and the
 * visited flag. Consumers read narrow accessors instead of a record of raw
 * buffers, so nothing can reach a secret after exit(). PIN custody and the
 * online/offline mode are delegated to the injected custody (GLOSSARY:
 * PIN Custody).
 */
export const createSession = (deps: SessionDeps = {}): Session => {
  const storage = deps.storage ?? localStorage
  const custody = deps.custody ?? pinCustody

  let state: {
    originBuffer: ArrayBuffer
    entropy: ArrayBuffer
    cryptoKey: CryptoKey
    keyPairSeed: Uint8Array
    secretBoxIv: Uint8Array
    secretBoxKey: Uint8Array
    profileId: string
    vault: Vault
  } | null = null

  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())

  const active = () => {
    if (!state) {
      throw new SessionClosedError()
    }

    return state
  }

  const start = async (buffer: ArrayBuffer): Promise<StarterKit> => {
    if (buffer.byteLength !== ORIGIN_BUFFER_BYTE_LENGTH) {
      throw new Error('The origin buffer must be 256 bytes long')
    }

    const parsed = parseOriginBuffer(buffer)
    const keyPairSeed = new Uint8Array(parsed.keyPairSeedBuffer)
    const cryptoKey = await createAesKey(parsed.cryptoKeyBuffer)

    const vault = createVault(
      { lsKey: parsed.lsKey, cryptoKey, legacyIv: parsed.iv },
      storage,
    )

    state = {
      originBuffer: buffer,
      entropy: parsed.entropy,
      cryptoKey,
      keyPairSeed,
      secretBoxIv: new Uint8Array(parsed.secretBoxIvBuffer),
      secretBoxKey: new Uint8Array(parsed.secretBoxKeyBuffer),
      profileId: parsed.id,
      vault,
    }

    notify()

    const services = await vault.read()

    return {
      id: parsed.id,
      services: services === null ? null : stringify(services),
    }
  }

  const enter = async (password: string): Promise<StarterKit> => {
    const buffer = await pbkdf2(
      getBufferOfText(password),
      ORIGIN_BUFFER_BYTE_LENGTH,
      ORIGIN_BUFFER_ITERATIONS,
    )

    return start(buffer)
  }

  const enterWithPin = async (pin: string): Promise<StarterKit> => {
    // PIN entry means "pull the encrypted Origin Buffer from wherever the
    // custody keeps it" — the custody alone knows where that is.
    const released = await custody.release(pin)

    if (!released.ok) {
      throw new PinReleaseError(released.reason)
    }

    return start(released.buffer)
  }

  const exit = () => {
    if (state) {
      // Zeroize what we own: CryptoKey is non-extractable already, buffers
      // stay in the heap until collected unless we overwrite them.
      new Uint8Array(state.entropy).fill(0)
      new Uint8Array(state.originBuffer).fill(0)
      state.keyPairSeed.fill(0)
      state.secretBoxIv.fill(0)
      state.secretBoxKey.fill(0)

      state.vault.close()
      state = null
    }

    notify()
  }

  // The mode lives in the custody: it is the answer to "where does the
  // login material come from". The session keeps it on its interface
  // because the app-level online/offline switch speaks through the session.
  const mode = (): SessionMode => custody.mode()

  const setMode = (next: SessionMode) => {
    custody.setMode(next)
    notify()
  }

  return {
    enter,
    enterWithPin,
    exit,
    isActive: () => state !== null,
    subscribe(listener) {
      listeners.add(listener)

      return () => void listeners.delete(listener)
    },
    profileId: () => active().profileId,
    publicKey: () => getKeyPairFromSeed(active().keyPairSeed).publicKey,
    keyPairSeed: () => active().keyPairSeed,
    entropy: () => new Uint8Array(active().entropy),
    originBuffer: () => active().originBuffer,
    transportKeys: (): TransportKeys => ({
      secretBoxIv: active().secretBoxIv,
      secretBoxKey: active().secretBoxKey,
    }),
    vault: () => active().vault,
    mode,
    setMode,
    hasVisited: () =>
      state !== null &&
      storage.getItem(LS_KEY_VISITED) ===
        uint8ArrayToBase64(getKeyPairFromSeed(active().keyPairSeed).publicKey),
    markVisited() {
      storage.setItem(
        LS_KEY_VISITED,
        uint8ArrayToBase64(getKeyPairFromSeed(active().keyPairSeed).publicKey),
      )
      notify()
    },
  }
}
