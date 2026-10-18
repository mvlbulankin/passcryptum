# Passcryptum

Self-hosted zero-knowledge password manager: Go backend with an embedded Vue + TypeScript SPA (`backend/`, `frontend/`), Caddy gateway (automatic HTTPS), SQLite, deployed with Docker Compose.

## Repository map

- `README.md` — product overview, deploy, links to per-part dev docs.
- `GLOSSARY.md` — canonical domain terms (Origin Buffer, Profile, Credential, Protector, Entropy, Wire Protocol). Use these words exactly.
- `docs/adr/` — architecture decision records. Read before re-litigating a decision.
- `docs/` — user-facing docs (PIN usage, recommendations, password generation).
- `.scratch/upstream/` — local copies of the upstream issues this project continues (#187 implemented, #159 open).
- `backend/` — Go service (`internal/{wire,guard,store}`), see `backend/README.md`.
- `frontend/` — Vue SPA (`modules/core/wire` is the protocol client), see `frontend/README.md`.

## Working in this repo

```bash
# backend
cd backend && go test ./... && ./contract/run.sh

# frontend
cd frontend && npm run test && npm run type-check && npm run lint
```

The contract suite in `backend/contract/` pins the wire protocol; any
server change must keep it green (ADR-0002).

Agent tooling (skills, plans) is local-only and intentionally not tracked
in this repository.
