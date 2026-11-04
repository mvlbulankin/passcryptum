# 0009. The pre-3.0 vault blob format is retired

Date: 2026-11-04
Status: accepted

## Context

Since 3.0 the Vault blob has had two formats: the current
`0x01 ‖ fresh IV(16) ‖ AES-CBC(json)` and the pre-3.0 raw
`AES-CBC(json)` under a static IV sliced from the Origin Buffer
(bytes 120–136). The reader dispatched between them structurally, by
length. Every piece of that compatibility existed only to keep pre-3.0
blobs openable: the `legacyIv` field crossed the session→vault seam,
`parseOriginBuffer` handed out a slice nothing else uses, and two tests
pinned the dispatch (including the marker-collision search).

The deployment is the single-profile instance of ADR-0004, and its
fleet is known-current on 3.0+ with sync: every stored blob — device
storages, the server profile, the exports that matter — is in the
current format. This was verified before the change, not assumed.

## Decision

1. The current format is the **only** format. `decryptBlob` reads
   `0x01 ‖ IV(16) ‖ AES-CBC(json)` and rejects everything else without
   decrypting: a byte sequence whose length is a multiple of 16 is not
   a blob.
2. The `legacyIv` field is deleted from `VaultSession`, and the Origin
   Buffer slice that fed it is no longer parsed out. Bytes 120–136
   stay **reserved** so no other range shifts — the layout itself is
   load-bearing (it derives keys and password-generation entropy).
3. Living documentation (GLOSSARY, code comments) describes the one
   format; this record is the historical trace that a second format
   and its compatibility path ever existed.

## Consequences

- A pre-3.0 blob found after this change — a stale device's storage, an
  old hex export — reads as unreadable, and `vault.read()` drops
  unreadable blobs (as it always has). The data is recoverable only
  with a pre-3.0 build or a pre-3.0 plaintext export, never by a
  current build.
- Pre-3.0 hex exports no longer import through `importText` /
  `importBytes`. Plaintext JSON imports are unaffected.
- The server is untouched: the Wire Protocol carries opaque bytes, the
  contract suite does not pin the blob format — the Vault owns it.
- Unlike ADR-0004 there is no reopening trigger: reinstating the code
  would resurrect the static-IV format rather than recover data.
