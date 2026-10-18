// Wire Protocol client types. The transport is the seam: production injects
// the fetch adapter, tests inject a fake. Everything else (base64, framing,
// URLs) is implementation behind the WireClient interface.

export type WireRequest = {
  method: string
  url: string
  body?: string
  headers: Record<string, string>
}

export type WireResponse = {
  status: number
  body: string
}

export type Transport = (request: WireRequest) => Promise<WireResponse>

export type WireClient = {
  // GET /api/profiles/ — encrypted services blob, null when the profile has none (204)
  getServices(keyPairSeed: Uint8Array): Promise<Uint8Array | null>

  // POST /api/profiles/ — replace the profile's services blob
  setServices(keyPairSeed: Uint8Array, encrypted: Uint8Array): Promise<void>

  // DELETE /api/profiles/ — 'cleared' when a blob was removed, 'already-empty' on 204
  clearServices(keyPairSeed: Uint8Array): Promise<'cleared' | 'already-empty'>

  // GET /api/credentials/ — unsigned (v1 quirk): public key + hashed PIN +
  // protector + timestamp. Takes the public key directly: this runs before a
  // session exists (PIN login fetches the entropy to start one).
  getEntropy(
    publicKey: Uint8Array,
    hashedPin: Uint8Array,
    protector: Uint8Array,
  ): Promise<Uint8Array>

  // POST /api/credentials/ — issue a credential for the entropy; the server
  // answers with a fresh 32-byte protector
  createCredential(
    keyPairSeed: Uint8Array,
    hashedPin: Uint8Array,
    entropy: Uint8Array,
  ): Promise<Uint8Array>

  // DELETE /api/credentials/ — unsigned (v1 quirk): protector + public key +
  // timestamp suffice. Like getEntropy, runs without a session.
  deleteCredential(publicKey: Uint8Array, protector: Uint8Array): Promise<void>
}
