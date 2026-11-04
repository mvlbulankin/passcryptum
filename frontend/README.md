# Passcryptum frontend

Vue 3 + TypeScript single-page application. Builds to a single
`index.html` with inlined JS/CSS (`vite-plugin-singlefile`) which the Go
binary embeds and serves — the deployed frontend is one file.

## Scripts

```bash
npm ci
npm run dev          # dev server; /api proxied to http://127.0.0.1:8000
npm run test         # vitest unit tests
npm run type-check   # vue-tsc
npm run lint         # eslint + stylelint
npm run lint:fix
npm run format       # prettier (check); format:fix to write
npm run build        # single-file build into dist/
```

`VITE_API_BASE_URL` overrides the API base at build time (default:
same origin). The service worker's cache version is stamped per build.

## Structure

Feature-Sliced layout:

- `modules/` — reusable, UI-framework-light layers:
  - `modules/core/` — all cryptography: session (origin buffer), PIN
    Custody (holding the Origin Buffer under a PIN, online or offline),
    vault (the encrypted local blob), sync (pushing/pulling the vault),
    **wire/** — the Wire Protocol client, the only place the app talks to
    the server;
  - `modules/services/` — pure functions over the services config
    (parse/stringify/merge).
- `src/` — application layers: `entities/`, `features/`, `widgets/`,
  `pages/`, `app/` (FSD).

Imports cross two seams only: `#/core` (barrel, enforced by
`modules/core/test/barrel.spec.ts`) and `@/entities/session` +
feature-to-feature (enforced by `src/entities/session/test/seams.spec.ts`).

Path aliases: `#/` → `modules/`, `@/` → `src/`.

Domain terms (Origin Buffer, PIN Custody, Profile, Credential, Protector,
Entropy, Hashed PIN, Services, Vault, Wire Protocol) are defined in the root
`GLOSSARY.md`.
