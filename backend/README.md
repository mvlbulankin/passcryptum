# Passcryptum backend

Go service on the standard library (no framework, no ORM, no CGO) +
`modernc.org/sqlite` (pure Go). One binary serves the API, the embedded
frontend, and owns the SQLite file. See ADR-0001 for the architecture.

## Layout

- `internal/wire/` — the Wire Protocol: per-endpoint recipes and the shared
  request pipeline (headers, timestamp window, signatures, replay);
  see ADR-0002/0003.
- `internal/guard/` — in-memory security state: per-IP rate limiting, POST
  replay cache, per-profile credential lockout.
- `internal/store/` — all SQL: profiles and credentials, PBKDF2 pin
  re-hash on write.
- `server.go` — endpoints as recipe values + domain logic; static SPA.
- `main.go` — CLI (`serve`, `genkey`, `add-public-key`,
  `delete-public-key`) and env config.

## Build & run

```bash
go build -o passcryptum .
PC_DB=/tmp/pc.db ./passcryptum serve 127.0.0.1:8000
```

## Tests

```bash
go test ./...        # unit tests (wire, guard, store)
./contract/run.sh    # wire-protocol contract suite vs a throwaway live server
```

The contract suite (see `contract/README.md`) pins the protocol behavior
of any Passcryptum backend; it is the safety net for every server change.

## Environment

`PC_DB` (SQLite path), `PC_RATE_PER_MIN` (per-IP requests/min, default
300), `PC_PROFILE_FAIL_MAX` (failed credential auths per profile per
10 minutes before lockout, default 100). Contract tests: `PC_BASE_URL`,
`PC_PRIVATE_SEED`, `PC_PUBLIC_KEY`, `PC_INSECURE`.
