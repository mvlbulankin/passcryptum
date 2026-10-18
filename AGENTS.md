# Passcryptum

Self-hosted zero-knowledge password manager: Go backend with an embedded Vue + TypeScript SPA (`backend/`, `frontend/`), Caddy gateway (automatic HTTPS), SQLite, deployed with Docker Compose.

## Repository map

- `README.md` — product overview, deploy, links to the docs.
- `docs/` — index in `docs/README.md`: user guides and `adr/` (decisions).
- `GLOSSARY.md` — canonical domain terms (Origin Buffer, Profile, Credential, Protector, Entropy, Wire Protocol). Use these words exactly.
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
server change must keep it green. Read `docs/adr/` before changing an area a
decision covers, and add a record instead of re-litigating one.

Agent tooling (skills, plans) is local-only and intentionally not tracked
in this repository.
