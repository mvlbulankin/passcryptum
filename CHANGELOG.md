# Changelog

## 3.0.0

The 2.x standalone offline password manager becomes a self-hosted,
synchronized, zero-knowledge system. Continues
[nelkor/passcryptum](https://github.com/nelkor/passcryptum) (v2.1.4);
server synchronization implements the design from its issue #187.

### Added

- **Server synchronization.** Encrypted vault upload/download between
  devices through a self-hosted server; the server never sees plaintext
  (zero-knowledge contract).
- **Go backend**: standard-library HTTP service with embedded SQLite
  (`backend/`), serving the API and the embedded SPA from one binary;
  admin CLI (`genkey`, `add-public-key`, `delete-public-key`).
- **Online PIN with protectors**: the origin buffer can be stored on the
  server, encrypted under a PIN; each device gets its own protector
  (credential), max 10 per profile with oldest-first eviction.
- **Wire Protocol v2** (`Protocol-Version: 2` header): signatures bind the
  HTTP method, one-sided ±300 s→[0, 300 s] timestamp window, replay
  protection on every signed request, PBKDF2-stretched `Hashed-Pin`
  (600k iterations, salted by the profile's public key), minimum PIN
  length of 8. v1 remains servable for cached older frontends.
- **Deployment**: Docker Compose (app + Caddy gateway with automatic TLS,
  security headers, request size limits).
- **Hardening**: per-IP rate limiting and per-profile credential lockout,
  POST replay cache, PIN re-hash at rest (PBKDF2-SHA512, salted by the
  protector, with lazy upgrade of pre-existing rows), random per-save IVs
  for the local vault blob, clipboard auto-clear, idle auto-logout, memory
  zeroization on logout, service worker with per-build cache versioning.

### Changed

- The frontend speaks to the server exclusively through a single wire
  client module; axios is no longer a dependency.
- Frontend toolchain: eslint 10 (flat config), vite 8, vitest 5,
  stylelint 17, vue-tsc 3.

### Notes for upgraders from 2.x

- The origin password and all generated service passwords are unchanged.
- Online PINs must be re-set once per device after upgrading to the v2
  client (offline PINs are unaffected).
