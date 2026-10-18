export type WireErrorKind =
  | 'forbidden' // 403: profile not onboarded, credential auth failed, replay
  | 'network' // transport refused / network failure
  | 'unexpectedStatus' // a status the contract does not define for the endpoint
  | 'malformedResponse' // body is not the JSON-encoded string the protocol promises

export class WireError extends Error {
  constructor(
    public readonly kind: WireErrorKind,
    public readonly status?: number,
  ) {
    super(`wire: ${kind}${status !== undefined ? ` (status ${status})` : ''}`)
    this.name = 'WireError'
  }
}

// 403 is the contract's only defined failure; callers translate it to the
// "public key not onboarded" dialog. One helper instead of N catch cascades.
export const isForbidden = (e: unknown): e is WireError =>
  e instanceof WireError && e.kind === 'forbidden'
