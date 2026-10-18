# 0002. The Wire Protocol is a versioned public contract

Date: 2026-10-18
Status: accepted

## Context

The frontend and the backend talk over a custom cryptographic protocol:
base64 headers
(`Public-Key`, `Hashed-Pin`, `Protector`, `Timestamp`, `Signature`), POST
bodies of `base64(signature(64B) ‖ timestamp(4B LE) ‖ payload)`, four endpoints
(`/api/profiles/`, `/api/credentials/`). GET/DELETE on credentials carry no
signature: they authenticate by factors (public key + PIN hash + protector),
not by signature — a quirk inherited from the original design.

Deployed devices hold cached frontend shells (a service worker serves them),
so the server must keep speaking the protocol those shells speak, across
releases.

## Decision

The protocol is treated as a public contract, not as an implementation
detail:

1. Its behavior is pinned by a black-box contract suite
   (`backend/contract/`) that runs against a live binary. A backend change
   that breaks the suite breaks the contract.
2. The protocol is versioned through the `Protocol-Version` header. Version
   v1 — the original semantics — stays servable indefinitely: symmetric
   ±300 s timestamp window, signatures over the bare timestamp (header
   recipes) or `ts ‖ payload` (bodies), replay protection on POST
   mutations only.
3. Changes to protocol semantics happen only as new versions (see ADR-0003
   for v2), never silently on the same version number.

## Consequences

Frontends update at their own pace (the service worker refreshes shells);
the server never forces a coordinated upgrade. Shell refresh is not prompt,
though — see [ADR-0005](0005-service-worker-updates.md): the browser's own
update check is throttled to once per 24 hours, so a stale shell can outlive
a deploy. That is exactly why v1 must stay servable indefinitely. Carrying
two protocol versions is permanent maintenance cost, accepted for
unbreakable clients.
