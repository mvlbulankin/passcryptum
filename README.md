# Passcryptum

A free open source cryptographic password manager.
Self-hosted, zero-knowledge, full-stack.

Remember only one password and have unique strong passwords for each of
your accounts. Unlike other password managers, Passcryptum does not store
passwords in the cloud or on your devices: they are derived from your
origin password on demand. You cannot lose your passwords even if you lose
everything. Version 3 adds optional server synchronization of your
encrypted vault between devices — the server stays zero-knowledge
throughout.

> This project continues [nelkor/passcryptum](https://github.com/nelkor/passcryptum).

## Getting started

- Create the only strong password which you will have to remember;
- Log in to Passcryptum with this password;
- Add your account by service name and login;
- Copy your password with the button;
- Change the password in that account to the generated one.

Well done — you have transferred an account to Passcryptum.

Set a PIN to avoid re-entering the origin password constantly: read
[PIN usage](docs/pin.md) for why it matters and how to use it. The online PIN
additionally lets new devices pull your encrypted vault from your server.
Learn our [recommendations](docs/recommendations.md) on recovery strategies
and the [password generation algorithm](docs/password-generation.md).

## Architecture

```
browser ── Caddy (:443, automatic TLS, security headers, body cap)
              └── passcryptum (Go): /api/* + embedded SPA + SQLite (volume)
```

Two containers, one binary. The wire protocol between the SPA and the
backend is a versioned public contract pinned by contract tests
([backend/contract](backend/contract/README.md)).

**Versioning note:** the protocol is versioned by the `Protocol-Version`
header (`2` today; requests without it get the v1 behaviour). Protocol
versions are independent of product versions (2.x → 3.x).

## Documentation

- [docs/](docs/README.md) — user guides and architecture decisions.
- [CHANGELOG.md](CHANGELOG.md) — what 3.0 changed against 2.x.
- [GLOSSARY.md](GLOSSARY.md) — canonical domain terms.
- [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md) —
  per-component developer docs.

## Deploy

1. Any server with Docker. Synced clock is mandatory: requests carry a unix
   timestamp and the server enforces a 300 s window (one-sided in protocol
   v2 — a timestamp from the future is rejected).
2. Put your domain into `gateway/Caddyfile` — Caddy obtains and renews the
   certificate automatically (no certbot).
3. Build and run:

```bash
docker build -f backend/Dockerfile -t passcryptum-go .
docker compose up -d backend
docker compose run --rm backend genkey            # prints a keypair
docker compose run --rm backend add-public-key <PUB>
docker compose up -d                              # Caddy gets TLS for the domain
```

Profiles exist only if their public key was added by the admin (CLI
`add-public-key` / `delete-public-key`) — there is no registration by
design.

### Running it locally

`gateway/Caddyfile` defaults to the production domain, and Caddy treats a
domain it does not hold a certificate for as an instruction to go and get
one. Starting the stack on a laptop therefore sends **real** ACME requests
for your domain — and Let's Encrypt answers with rate limits (5 failed
validations per hour per identifier, then a lockout), so a few local runs
can block the actual deploy.

Serve from Caddy's internal CA instead: point `TLS_DIR` at `gateway/local`,
which contains a one-line `tls internal`. Caddy then issues a local
certificate and never contacts a public CA.

```bash
# Gateway only, serving on https://localhost:8443 from the internal CA
docker run --rm -p 8443:8443 \
  -v "$PWD/gateway/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$PWD/gateway/local:/etc/caddy/local:ro" \
  -e SITE_ADDRESS=localhost:8443 \
  -e TLS_DIR=/etc/caddy/local \
  -e UPSTREAM=<host>:8000 \
  caddy:2
```

Browsers warn about the certificate until you trust Caddy's local root
(`docker run ... caddy trust`, or import the root from the `caddy_data`
volume) — expected: that certificate is for the local machine only. The
e2e suite (`frontend/e2e/run.sh`) does the same thing with its own
self-signed pair. Production runs set none of these variables, which is
what makes Caddy use ACME.

### Environment

| variable | default | meaning |
|---|---|---|
| `PC_DB` | `/data/passcryptum.db` (in the image) | path to the SQLite file |
| `PC_RATE_PER_MIN` | `300` | per-IP requests per minute |
| `PC_PROFILE_FAIL_MAX` | `100` | failed credential auths per profile / 10 min (lockout) |
| `VITE_API_BASE_URL` | same origin | frontend build-time API base |

## License

MIT — see [LICENSE](LICENSE).
