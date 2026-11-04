# 0008. Each PIN custody owns its own salt

Date: 2026-11-04
Status: accepted

## Context

The key that encrypts the Origin Buffer at rest is
`PBKDF2(PIN + random_string, 512, 2^19)`. There is **one** `random_string`
per device, and two custodities seal data with that key: the offline blob
held in `localStorage`, and the online Credential's `entropy` stored on the
server. Sharing one salt tied the two together in ways nobody had designed:

1. **Offline-only devices had no salt at all.** `random_string` was written
   only by the online hand-over, so a device that set just an offline PIN
   encrypted under `PBKDF2(PIN + "")`. `docs/pin.md` promised a random
   string next to the ciphertext; it was not there, and the PIN became the
   only cost of a guess.
2. **Setting an online PIN broke an existing offline PIN.** The online
   hand-over generated a fresh `random_string` and overwrote the old one, so
   the offline blob no longer opened — reported as "Wrong PIN" on the
   correct PIN.
3. **Revoking the online PIN broke an existing offline PIN.** `revoke`
   deleted `random_string` along with the Credential, with the same result.
   Worse than (2) because revoking looks harmless, and `isSet('offline')`
   kept reporting a working PIN.

Each was a silent failure of a security-critical path. None was reachable
from the unit tests, which exercised each operation in isolation, and no
e2e test touched a PIN at all.

## Decision

Each custody owns its salt.

- `random_string` is the **offline** salt, written when an offline PIN is
  set — and generated then if the device has none, so an offline-only device
  now gets a real per-device salt.
- `online_random_string` is the **online** salt, written only by a
  successful online hand-over.
- Neither operation touches the other custody's salt: `store('online')` and
  `revoke('online')` leave the offline salt alone, and vice versa.

No compatibility shim was written. The fleet's PINs were removed before this
landed, so there are no blobs sealed under the shared salt to migrate;
re-enrolling an online PIN creates the dedicated salt. A device that somehow
reaches this version with PIN data should set its PINs again — the
alternative (reading legacy salts) is what kept the coupling alive.

## Rejected alternatives

- **Generate the salt lazily in the offline path only.** Changes the derived
  key for exactly the devices that have an offline PIN today — the same
  silent breakage, applied to everyone at once.
- **Keep one shared salt and document the sequences.** Leaves three ways to
  lose a working PIN, one of which (`revoke`) looks harmless.
- **Migrate the stored entropy on first successful online login.** Needs a
  new Credential write on a path that is supposed to be read-only, and
  cannot help a device whose offline blob was already orphaned.

## Consequences

The `docs/pin.md` promise ("a random string stored next to the encrypted
buffer") is now true for both custodities, so the empty-salt caveat is gone.

`e2e/pin.spec.ts` drives the two sequences that used to break — online PIN
then offline PIN, and revoke-online then offline sign-in — through the real
UI, and the first of them goes red if the salts are shared again (verified
by reintroducing the shared salt).

`isSet('online')` includes the online salt in its record again: every write
now creates it, so its absence means an incomplete pairing.
