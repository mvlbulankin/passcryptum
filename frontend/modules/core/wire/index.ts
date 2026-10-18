// Wire Protocol client — the single place the frontend speaks the protocol
// (ADR-0002), in its current version v2 (ADR-0003). Interface: six endpoint
// functions + WireError. Everything
// else (base64 headers, framing, signing, URLs, transport) is implementation.

import { createWireClient } from './lib/client'
import { fetchTransport } from './lib/transport'

export { createWireClient } from './lib/client'

export { WireError, isForbidden } from './lib/wire-error'

export type { WireErrorKind } from './lib/wire-error'

export type {
  Transport,
  WireClient,
  WireRequest,
  WireResponse,
} from './lib/types'

export const wire = createWireClient(fetchTransport)
