# Contract tests (ADR-0002)

Wire-protocol v1 contract tests. They pin what ANY backend must do:
status codes, success bodies, and the documented quirks (symmetric ±300s
timestamp window, unsigned credential GET/DELETE, 10-credential eviction,
services overwrite without versioning).

This suite is the contract itself.

## Run

Local throwaway Go backend:

    ./run.sh

Any live backend (e.g. the docker-compose stack):

    PC_BASE_URL=https://<host> PC_PRIVATE_SEED=<priv_b64> PC_PUBLIC_KEY=<pub_b64> \
      go test ./contract -count=1

(`passcryptum genkey` prints a keypair; onboard the public one first.)

## Env

| var | meaning |
|---|---|
| `PC_BASE_URL` | backend under test (unset => tests skip) |
| `PC_PRIVATE_SEED` | base64 ed25519 seed (32B) of an onboarded profile |
| `PC_PUBLIC_KEY` | base64 ed25519 public key (32B) of the same profile |
| `PC_INSECURE` | any value: skip TLS verification (self-signed test stacks) |

## Quirks deliberately pinned (do NOT "fix" without a protocol-version decision)

- pre-issued (+299s) requests are accepted (fixed in v2, ADR-0003; v1 keeps it)
- `GET/DELETE /api/credentials/` carry no signature
- `DELETE /api/credentials/` needs only Protector + Public-Key
- services POST is an unversioned overwrite (stale replay reverts data)
- 11th credential silently evicts the oldest
- `TestHardenedErrors` pins error paths the original design left
  unspecified (405 and 4xx, never 500).
