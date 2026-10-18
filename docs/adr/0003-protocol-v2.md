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

1. **Method-bound signatures.** v2 signs `method ‖ timestamp` (header
   recipes) and `method ‖ ts ‖ payload` (body recipes). The wire framing is
   unchanged; only the signature input grows. A captured GET signature no
   longer verifies as DELETE.
2. **One-sided window.** v2 accepts `0 ≤ now − ts ≤ 300`; timestamps from
   the future are rejected.
3. **Replay rejection on every signed request.** v2 GET/DELETE are cached
   in the replay cache as well. Signatures are now unique per request
   (fresh timestamp), so legitimate traffic never collides — with one
   accepted edge: two byte-identical requests within the same second share
   a signature and the second gets 403.
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
