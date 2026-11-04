// PIN Custody (GLOSSARY): the device's arrangement for holding the Origin
// Buffer under a PIN — online as a Credential on the server, offline as an
// encrypted blob. store/release/revoke/isSet/mode is the whole interface;
// the KDFs, the localStorage record, the derived blob length and the wire
// calls sit behind it.

import { createPinCustody } from './lib/custody'

export { createPinCustody } from './lib/custody'

export type {
  CustodyKind,
  CustodyMode,
  CustodyReason,
  CustodyStorage,
  PinCustody,
  ReleaseOutcome,
  RevokeOutcome,
  StoreOutcome,
} from './lib/types'

/** The one custody for the app: browser storage, the real wire client. */
export const pinCustody = createPinCustody()
