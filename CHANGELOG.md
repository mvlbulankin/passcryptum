# Changelog

All notable changes to Passcryptum. This project continues
[nelkor/passcryptum](https://github.com/nelkor/passcryptum) (v2.1.4 was its
last release).

## 3.0.1

### Fixed

- **Sync on devices with a fast clock.** The v2 time window accepted
  nothing from the future, so a device clock even one second ahead failed
  every signed request with `400 Invalid timestamp` — v1's symmetric ±300 s
  window never had this failure mode; v2 inherited it from the one-sided
  window (ADR-0003, amendment 2026-10-28). The window is now
  `−60 ≤ now − ts ≤ 300`: 60 s is the JWT ecosystem's canonical clock-skew
  leeway. Protocol v1 behavior is unchanged.

### Changed

- Wire 400 rejections are logged (`rejected <method> <path> ip=… pub=…
  reason=…`), visually distinct from 403 `denied` lines. Previously a
  timestamp rejection left no trace in the server log, which made the
  clock-skew incident a blind diagnosis.

## 3.0.0

2.x was a standalone offline password manager: one file, everything derived
on the device, nothing shared between devices. 3.0 keeps that model and adds
an optional self-hosted server so devices can synchronize the encrypted
vault — still zero-knowledge: the server only ever stores blobs it cannot
read.

### Added

- **Server synchronization.** Upload/download of the encrypted vault between
  devices. The vault stays encrypted with keys derived from the origin
  password; the server sees opaque bytes and signatures only.
- **Go backend** (`backend/`): HTTP service on the standard library, SQLite
  storage (pure-Go driver, no CGO), the compiled frontend embedded in the
  binary. One static binary serves both API and UI.
- **Admin CLI**: `genkey`, `add-public-key`, `delete-public-key`, `serve`.
  Profiles are created by onboarding a public key — there is no registration
  by design; a profile that is not onboarded simply has no server access.
- **Online mode and PIN storage.** The origin buffer can be stored on the
  server, encrypted under a PIN; each device gets its own *protector* (a
  server-issued random secret) and its own credential. Up to 10 credentials
  per profile, oldest evicted first. Offline mode still works exactly as in
  2.x.
- **Wire Protocol** between the SPA and the backend: base64 headers, Ed25519
  signatures, timestamped bodies. Versioned through the `Protocol-Version`
  header, so older cached frontends keep working.
- **Protocol v2** (current): signatures bind the HTTP method and a
  per-request nonce, the timestamp window is one-sided (`0 ≤ now − ts ≤ 300`),
  replay protection covers every signed request, and `Hashed-Pin` is stretched
  with PBKDF2 (600k iterations, salted by the profile's public key). Version 1
  remains served for devices that have not refreshed their service worker.
- **Deployment**: Docker Compose with the app plus a Caddy gateway that
  handles TLS automatically (Let's Encrypt), security headers and request
  size limits.
- **Contract tests** (`backend/contract/`): a black-box suite that pins the
  wire protocol against a live binary — the safety net for any server change.
- **End-to-end tests** (`frontend/e2e/`): Playwright against the real stack,
  covering sign-in, device-to-device sync (including the double-upload replay
  case), file round-trip, the Android-emulation sync flow, and service-worker
  update propagation through a real build.

### Changed

- The frontend talks to the server through a single wire-client module
  instead of six hand-assembled call sites; `axios` is gone.
- Service PINs: minimum length of 8 characters when setting one.
- The header shows the real build version (stamped from `package.json`)
  instead of a hardcoded 2.x string.
- Frontend toolchain refreshed: eslint 10 (flat config), vite 8, vitest 5,
  stylelint 17, vue-tsc 3; TypeScript 5.9 (7.x is still a preview).

### Fixed

- **Downloading the vault was broken**: the upload stores the local AES
  envelope (marker ‖ per-save IV ‖ ciphertext) inside a secretbox, while the
  download read it as raw AES-CBC — every second device ended up with an
  empty vault. It now unwraps secretbox first, then the AES envelope.
- Sign-in left the form disabled after a wrong password until a page reload
  (the in-progress flag was not reset on the error path).
- Replayed requests: two identical requests within one second used to share
  a signature and the second was rejected; the v2 nonce makes each request
  unique.
- **Returning devices received app updates only after a long delay.** The
  service worker serves the single-file app shell cache-first, and the
  browser's own update check is throttled: a registered worker is re-checked
  on navigation, but at most once every 24 hours. A device therefore kept
  serving the build it first cached (measured: zero update-check requests
  over three launches) until the window expired, and a phone stuck on an
  earlier build failed every vault download with a generic error while fresh
  browsers worked. The app now calls `registration.update()` on every launch:
  a redeployed build reaches returning devices on their second launch, no
  manual cache clear. The backend also pins `Cache-Control: no-cache` on
  `/sw.js` as defense in depth against intermediaries (gateway, CDN, proxy)
  in front of it (ADR 0005). Devices frozen on builds from before this change
  still need one manual site-data clear — see the upgrade notes.

### Security

- Per-IP rate limiting and per-profile credential lockout (unthrottled PIN
  guessing was possible before).
- POST replay rejection; v2 extends it to every signed request.
- PIN material is never stored verbatim: the server re-hashes it with
  PBKDF2-SHA512 salted by the protector, and upgrades older rows lazily.
- Per-save random IVs for the local vault blob (the old format reused a
  static IV from the origin buffer).
- Clipboard auto-clear, idle auto-logout, and zeroization of key material on
  logout.
- The service worker derives its origin from its registration scope, so any
  self-hosted instance caches and proxies itself.

### Upgrade notes

- **Origin password and generated service passwords do not change.** The
  derivation from the origin password is untouched.
- A server-side profile must be onboarded by the admin (public key) before a
  device can use online mode. Until then the app works offline, as in 2.x.
- After updating to the v2 client, **set the online PIN again on each
  device**: the wire value of the PIN hash changed. Offline PINs are
  unaffected.
- The server stores credentials created by 2.x-era clients as-is; they are
  upgraded to the hashed form on the next successful PIN login.
- **A device already running an older build does not update itself.** Builds
  from before the update-on-launch change execute a shell that never asks the
  server for a new worker, so they stay on whatever they first cached: clear
  site data once by hand on such a device, then updates flow automatically
  (ADR 0005).
