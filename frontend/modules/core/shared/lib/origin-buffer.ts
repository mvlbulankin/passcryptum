import { stringifyBuffer } from './buffer'
import { capitals } from './charset'
import { formatPassword } from './format-password'

// The Origin Buffer layout. One place, so the app and anything mirroring it
// (tests, tooling) cannot drift apart silently.
const ID_BYTES = 8
const ENTROPY_RANGE = [8, 120] as const
// Bytes 120–136 are reserved: the pre-3.0 blob IV lived here. Blobs have
// carried their own fresh random IV since 3.0, and the legacy format is
// retired (ADR-0009); the range stays reserved so no other range shifts.
const KEY_PAIR_SEED_RANGE = [136, 168] as const
const SECRET_BOX_IV_RANGE = [168, 192] as const
const SECRET_BOX_KEY_RANGE = [192, 224] as const

export const parseOriginBuffer = (buffer: ArrayBuffer) => ({
  id: formatPassword(buffer.slice(0, ID_BYTES), 4, [capitals]),
  lsKey: stringifyBuffer(buffer.slice(0, ID_BYTES)),
  entropy: buffer.slice(ENTROPY_RANGE[0], ENTROPY_RANGE[1]),
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
