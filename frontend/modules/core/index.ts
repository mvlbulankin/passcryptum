// Passcryptum core — the public surface of the modules that hold secrets.
//
// Export here only what the application uses. Anything reaching further in
// (modules/core/*/lib, internal helpers, module types used by one caller) is
// an implementation detail; barrel.spec.ts fails the build if src/ does.
//
// The surface is grouped by intent, not by file:
//   session  — who is logged in and what the vault is
//   wire     — the only way to talk to the server
//   pin      — PIN Custody: holding the Origin Buffer under a PIN
//   crypto   — primitives the app composes itself (transport, generation)

export { createSession, SessionClosedError, PinReleaseError } from './session'

export type { Session, SessionDeps, SessionMode, StarterKit } from './session'

// Callers receive a Vault from session.vault(); naming the type is the app's
// business (the copy forms speak about it).
export type { Vault } from './vault'

export { wire, WireError, isForbidden } from './wire'

export type { WireErrorKind } from './wire'

export { generatePassword } from './generator'

export { MIN_PIN_LENGTH } from './constants'

// Transport crypto: the session's secretbox keys wrap vault bytes for the
// wire. Encoding helpers are needed wherever bytes meet text.
export {
  decryptData,
  encryptData,
  base64ToBuffer,
  bufferToBase64,
  base64ToUint8Array,
  uint8ArrayToBase64,
} from './shared'

export { pinCustody, createPinCustody } from './pin'

export type {
  PinCustody,
  CustodyKind,
  CustodyMode,
  CustodyReason,
  StoreOutcome,
  ReleaseOutcome,
  RevokeOutcome,
} from './pin'

// The Origin Buffer layout is shared by the session and the custody; it
// lives with the crypto primitives, not in either consumer.
export { parseOriginBuffer } from './shared'
