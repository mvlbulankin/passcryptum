# 0001. Architecture: single Go binary, SQLite, Caddy gateway

Date: 2026-10-18
Status: accepted

## Context

Passcryptum 2.x was a standalone offline SPA. Version 3 adds server
synchronization of the encrypted vault — the design recorded in the
[upstream notes](../upstream/README.md) — which makes the project a
self-hosted full-stack application: a frontend, a backend, and a TLS entry
point.

## Decision

- **Backend**: Go on the standard library (`net/http`, `crypto/ed25519`,
  `database/sql`), no framework, no ORM, no CGO. One static binary (~10 MB)
  that serves both the API and the embedded frontend.
- **Storage**: SQLite (modernc, pure Go), a single file next to the binary.
  Schema is embedded and applied at startup; migrations ship as code.
  Backups are intentionally not configured: copies of the master secret live
  on the user's devices (the server is a sync channel, not the only home of
  the data).
- **Frontend**: Vue 3 + TypeScript, single-file build (one `index.html` with
  inlined JS/CSS) embedded into the binary via `embed.FS`.
- **Gateway**: Caddy as the only public port. It terminates TLS automatically
  (Let's Encrypt with ZeroSSL fallback, renewal included), enforces the body
  cap and security headers, and proxies to the Go service on the internal
  compose network.
- **Deployment**: Docker Compose with two services (`passcryptum`,
  `gateway`). Admin onboarding of profiles happens through CLI subcommands of
  the same binary; there is no registration by design.

The alternative — making the Go binary an ACME participant itself (autocert)
and folding the gateway away — was rejected: ACME renewal would become
runtime application logic on a dynamic-DNS domain, and the gateway keeps
TLS/limits/headers in one place with a clear responsibility.

## Consequences

One process to build, deploy, and monitor; the frontend build is part of
`go build`. The gateway stays the single point where transport security and
volumetric limits live. The SQLite file and the binary are the entire
server-side state.
