# 0006. The server speaks one wire protocol; v1 serving is retired

Date: 2026-11-04
Status: accepted

## Context

ADR-0002 promised the frozen v1 semantics stay servable indefinitely
because deployed devices hold cached frontend shells that speak it, and
shells refresh at the browser's pace. Two things changed since. ADR-0005
made propagation deterministic (two launches) for every shell carrying
`registration.update()`; only shells frozen before that change never
update, and one manual site-data clear recovers such a device. And the
fleet is now known-current: every device has been cleared and runs a shell
that sends `Protocol-Version: 2` on every request. The v1 code path serves
shells that no longer exist, while every doc that explains "v1 vs v2"
costs a reader more than it tells them.

## Decision

1. The server speaks **one** wire protocol. Every request must carry
   `Protocol-Version: 2`; a missing header, `1`, or any other value is a
   `400` naming the header, rejected before any other parsing. The current
   frontend already sends the header on every request, so no client change
   is needed.
2. The semantics are inherited unchanged from ADR-0003 and its amendment:
   method-bound signatures with a per-request nonce, the one-sided window
   `−60 ≤ now − ts ≤ 300`, replay rejection on every signed request.
   Relaxing the window to the industry-symmetric ±300 s was considered and
   rejected: it would re-accept pre-issued requests, extend the
   post-restart replay exposure (the replay cache is process-local by
   design) from 360 s to 600 s, and put the validity span exactly at the
   replay-cache TTL with zero margin.
3. The versioning **mechanism** stays (ADR-0002): semantic changes still
   ship as new versions negotiated by this header. Retirement removes a
   version, not versioning.
4. Living documentation (README, GLOSSARY, per-component docs) describes
   the one protocol without v1/v2 comparative history; the ADRs remain the
   historical record. This supersedes ADR-0002's "v1 stays servable
   indefinitely" clause and the v1 holdover noted in ADR-0005's
   consequences.

## Consequences

- A stale cached shell that predates the header gets a `400` on its first
  request. Its service worker still updates (ADR-0005 — the update fetch
  touches `/sw.js`, not the API), so it recovers within two launches;
  only a shell frozen before ADR-0005 needs one manual site-data clear.
  Accepted: the fleet is known-current.
- The unsigned credential endpoints lose the symmetric ±300 s window the
  missing header used to buy them; the one-sided window now applies
  uniformly.
- `internal/wire` loses the version branch entirely (`checkTimestamp`
  oneSided, the two message formats); the contract suite pins the single
  protocol, including the header requirement, and no longer pins the
  accepted-pre-issue quirk.
