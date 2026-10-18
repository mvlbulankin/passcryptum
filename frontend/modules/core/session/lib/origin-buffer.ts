import { sign } from 'tweetnacl'

import { capitals, formatPassword, stringifyBuffer } from '../../shared'

// The Origin Buffer layout. One place, so the app and anything mirroring it
// (tests, tooling) cannot drift apart silently.
const ID_BYTES = 8
const ENTROPY_RANGE = [8, 120] as const
const IV_RANGE = [120, 136] as const
const KEY_PAIR_SEED_RANGE = [136, 168] as const
const SECRET_BOX_IV_RANGE = [168, 192] as const
const SECRET_BOX_KEY_RANGE = [192, 224] as const

export const parseOriginBuffer = (buffer: ArrayBuffer) => ({
  id: formatPassword(buffer.slice(0, ID_BYTES), 4, [capitals]),
  lsKey: stringifyBuffer(buffer.slice(0, ID_BYTES)),
  entropy: buffer.slice(ENTROPY_RANGE[0], ENTROPY_RANGE[1]),
  iv: buffer.slice(IV_RANGE[0], IV_RANGE[1]),
  keyPairSeedBuffer: buffer.slice(
    KEY_PAIR_SEED_RANGE[0],
    KEY_PAIR_SEED_RANGE[1],
  ),
  secretBoxIvBuffer: buffer.slice(
    SECRET_BOX_IV_RANGE[0],
    SECRET_BOX_IV_RANGE[1],
  ),
  secretBoxKeyBuffer: buffer.slice(
    SECRET_BOX_KEY_RANGE[0],
    SECRET_BOX_KEY_RANGE[1],
  ),
  cryptoKeyBuffer: buffer.slice(SECRET_BOX_KEY_RANGE[1]),
})

/** The Ed25519 key pair derived from the Origin Buffer's seed slice. */
export const deriveKeyPair = (keyPairSeed: Uint8Array) => {
  const { secretKey, publicKey } = sign.keyPair.fromSeed(keyPairSeed)

  return { secretKey, publicKey }
}
