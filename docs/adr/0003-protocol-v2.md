# 0003. Protocol v2: method-bound signatures, one-sided window, replay on all signed requests, client-side PIN KDF

Date: 2026-10-18
Status: accepted

## Context

Protocol v1 (ADR-0002) has four weaknesses inherited from the original
design:

1. Signatures do not cover the HTTP method, so a captured GET signature
   also verifies as DELETE on the same endpoint.
2. The timestamp window is symmetric (±300 s): requests pre-issued for the
   future are accepted, widening the replay surface.
3. Only POST mutations are replay-checked; GET/DELETE can be freely
   re-sent within the window.
4. The `Hashed-Pin` wire value is a single unsalted SHA-512 of the PIN, so
   a captured or logged header costs one hash operation per dictionary
   guess.

## Decision

Version 2, negotiated by the `Protocol-Version: 2` header (ADR-0002 keeps
v1 servable alongside):

1. **Method-bound signatures with a per-request nonce.** v2 signs
   `method ‖ ts ‖ nonce` (header recipes) and `method ‖ ts ‖ nonce ‖ payload`
   (body recipes), where `nonce` is 16 random bytes sent in the `Nonce`
   header. The wire framing is unchanged; only the signature input grows. A
   captured GET signature no longer verifies as DELETE, and — because the
   nonce differs per request — two requests in the same second never share a
   signature (without it, a double GET collided with itself in the replay
   cache: found by the live cross-language test).
2. **One-sided window.** v2 accepts `0 ≤ now − ts ≤ 300`; timestamps from
   the future are rejected.
3. **Replay rejection on every signed request.** v2 GET/DELETE are cached
   in the replay cache as well, keyed by signature + nonce. The nonce makes
   every legitimate request's signature unique, so no accepted edge
   remains: an exact resubmission is a replay, and anything fresh passes.
4. **Client-side PIN KDF.** The v2 wire value of `Hashed-Pin` is
   `PBKDF2-SHA512(SHA-512(pin), salt = profile public key, 600 000
   iterations, 32 bytes)`. The salt is the public key — not the protector,
   the otherwise natural choice — because the protector does not exist yet
   when a credential is created; the public key is available to the client
   at both moments (from the session at creation, from local storage at
   login). The server remains format-agnostic: it re-hashes whatever it
   receives with its own salt (the protector). A captured header now costs
   ~600k iterations per guess.
5. **Minimum PIN length 8** enforced by the client at PIN-set time, bounding
   the dictionary space the KDF defends.

Unsigned credential requests carry no nonce and keep their factor-auth
quirk (no signature, therefore no replay key).

Stripping the version header cannot downgrade a signed request: the v2
signature does not verify under v1 rules (different message). For the
unsigned credential endpoints the header only relaxes the window —
documented, accepted.

## Consequences

Replay and dictionary attacks against captured traffic drop from cheap to
practical-infeasible for a personal threat model. Costs: PIN entry does two
600k derivations (client + server re-hash, ~0.5 s, rare operation);
deploying v2 requires re-enrolling the online PIN on each device (the
stored credential hashes the v1 wire value); v1 stays in the codebase until
a separate retirement decision.

## Amendment (2026-10-28): the future edge gets a 60 s grace

Shipped zero-future-tolerance rejected real devices: a client clock one
second ahead — ordinary RTC drift between rare time syncs — failed every
signed request with `400 Invalid timestamp` (incident: Chrome/Win11, +1 s;
an iPad on the same account worked). The window becomes
`−60 ≤ now − ts ≤ 300` (`FutureTolerance` in `internal/wire`).

The trade: a pre-issued request is now usable 60 s early, and the validity
span grows 300 → 360 s — still covered whole by the replay-cache TTL
(600 s), so exact-duplicate replay stays dead for the entire life of a
signature. 60 s is the JWT ecosystem's canonical clock-skew leeway and a
fifth of the backward window; v2 remains far tighter on the future side
than the symmetric ±300 s defaults of Kerberos, AWS SigV4 and Stripe
webhooks. v1 is untouched.

Residual, accepted: a device more than 60 s ahead still fails with the
generic client error; the rejection is now visible in the server log
(`rejected … reason=Timestamp: Invalid timestamp` — field errors carry an
audit reason since this change). Should seamless sync on arbitrarily
skewed clocks ever be wanted, the recorded follow-up is client clock
discipline: stamping requests with server-reconciled time taken from the
`Date` response header.
