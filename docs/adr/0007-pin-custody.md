# 0007. PIN Custody is one module and one owner of the device PIN record

Date: 2026-11-04
Status: accepted

## Context

Holding the Origin Buffer under a PIN — online as a Credential on the
server, offline as an encrypted blob on the device — was spread over four
layers: `modules/core/actions` (KDFs and the stored-blob check),
`modules/core/pin` (set/delete), `modules/core/session` (the mode and the
PIN flags), and two near-identical modals. No module owned the invariants
that actually mattered:

- the unnamed three-key device record (`public_key`, `protector`,
  `random_string`) was written by one module, read by another, and torn
  down by a third;
- the stored-blob length check hardcoded `364`, a value derived from the
  256-byte Origin Buffer through AES padding and base64 — changing the
  buffer length would have silently bricked every stored PIN;
- every layer re-collapsed the wire client's error kinds until a network
  outage during online PIN login was reported to the user as "Wrong PIN".

## Decision

`modules/core/pin` is the single owner of PIN Custody (GLOSSARY). Its
interface is `store` / `release` / `revoke` / `isSet` / `mode` / `subscribe`;
the KDFs, the device record, the derived blob length, and the Credential
calls are implementation. `core/actions` is deleted rather than kept beside
it.

1. **Custody is autonomous from the session.** It is created with an
   injected storage and wire client, and `store` takes the Origin Buffer as
   an argument. `session.enterWithPin` delegates to `release`; the session
   never writes PIN keys itself, and exposes `mode()`/`setMode()` only as a
   delegation because the app-level switch speaks through it.
2. **Failures cross the seam as a closed vocabulary** — `wrongPin`,
   `noStoredBuffer`, `unknownProfile`, `unknownCredential`, `network`,
   `unexpected` — and the UI maps them to texts. Nothing compares error
   message strings to decide what to show. The session surfaces
   `PinReleaseError` carrying the reason, so a caller cannot flatten it
   back into a guess.
3. **One notification channel.** The custody notifies its subscribers;
   `entities/session` derives the PIN flags from it. The second channel that
   existed for this (`touchSession`, called by hand at five sites) is gone,
   and the session's interface no longer exposes `isOnlinePinSet` /
   `isOfflinePinSet`.

## Considered options

- **Keep `core/actions` and add a thin custody facade.** Rejected by the
  deletion test: the four functions would simply relocate, and the
  invariants (the three-key record, the derived length) would still have no
  owner.
- **Expose the source explicitly on release** (`releaseFromServer` /
  `releaseLocal`). Rejected: the source follows the stored mode, so an
  explicit parameter would make every caller re-implement that branch.
- **Have the session own the mode, with the custody reading the same key.**
  Rejected: two readers of one key is the same scattering this record
  removes; the mode answers "where does the login material come from",
  which is custody semantics.

## Consequences

Online PIN login became unit-testable for the first time: the wire client is
injected like storage, so `enterWithPin` is exercised against a fake wire in
`session.spec` instead of only through the env-gated live suite.

The interface is intentionally narrow: a future custody kind (a hardware
key, say) is a new `CustodyKind`, not a new set of ad-hoc functions. Adding
one must extend the reason vocabulary too, since the UI maps reasons, not
errors.
