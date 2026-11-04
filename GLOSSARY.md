# Passcryptum Glossary

Canonical domain terms. No implementation details.

## Origin Buffer

A 256-byte block, the source of all of the user's cryptographic material:
the Ed25519 key pair seed, the secret box key, the AES key, and the password
generation entropy. Unlocked by a PIN via PBKDF2. Stored on the user's
device; never sent to the server. IVs are not taken from the buffer — each
record gets a fresh random IV; legacy blobs with a static IV are still
readable.

## PIN Custody

The device's arrangement for holding the Origin Buffer under a PIN, so the
user can return without the master password. Two independent kinds: online
custody stores it as a Credential on the server (the device keeps the public
key and the Protector); offline custody keeps an encrypted blob on the
device. Either can be set or revoked independently, and revoking custody
never touches the Origin Buffer itself.

## Profile

The server-side entity identified by an Ed25519 public key (`public_key`).
The unit of onboarding: the admin adds/removes public keys manually via the
CLI. Holds the user's encrypted services (the synchronized data blob).

## Credential

A server-side entity: a `pin` + `protector` + `entropy` triple bound to a
Profile. The server cannot decrypt any of the fields. At most 10
credentials per profile (the oldest is evicted).

## Protector

A random 32-byte secret issued by the server when a Credential is created.
Together with the hashed PIN it forms the knowledge factor for retrieving
entropy. Never stored on the device as plaintext as part of the Origin
Buffer — it is handed to the user for safekeeping.

## Entropy

The secret blob from which the Origin Buffer is derived on the device.
Stored on the server encrypted; retrieving it requires proving knowledge of
the protector and the (hashed) PIN.

## Hashed PIN

The value of the `Hashed-Pin` header:
`PBKDF2-SHA512(SHA-512(pin), salt = public key, 600k iterations)`; the
server additionally re-hashes what it receives with its own salt (the
protector). The client enforces a minimum PIN length of 8.

## Services

The encrypted AES-CBC blob of the user's data (logins and per-service
password settings). Opaque to the server. Stored in the Profile;
synchronized between the user's devices.

## Vault

Services as they live on the device: one encrypted blob (the current format
carries a marker and a fresh IV per save; pre-3.0 blobs with a static IV are
still readable), plus everything about how it is stored, exported to a file
and imported back. The Vault owns the format; the Wire Protocol only carries
the bytes between devices.

## Wire Protocol

The frontend↔server protocol. Every request carries `Protocol-Version: 2`
(the only version the server speaks) and base64 headers (`Public-Key`,
`Hashed-Pin`, `Protector`, `Timestamp`, plus `Signature` and `Nonce` on
signed requests); bodies of `base64(signature ‖ 4-byte LE timestamp ‖
payload)`. Signatures cover the HTTP method, the timestamp, a per-request
nonce and (for bodies) the payload:
`method ‖ ts ‖ nonce` / `method ‖ ts ‖ nonce ‖ payload`. Four endpoints
(`/api/profiles/`, `/api/credentials/`); GET/DELETE on credentials carry
no signature at all (factors instead of a signature). The timestamp window
is one-sided with a 60 s future grace, `−60 ≤ now − ts ≤ 300` — ordinary
client clock drift passes; anything further from the future is a
pre-issued request — and replay protection covers every signed request.
Semantic changes ship as a new version number negotiated by the header
([ADR-0002](docs/adr/0002-wire-protocol-contract.md)); the current
semantics are [ADR-0003](docs/adr/0003-protocol-v2.md) (there referred
to as "v2"), and the older v1 serving was retired by
[ADR-0006](docs/adr/0006-protocol-v1-retirement.md). Protocol versions
are independent of product versions (2.x/3.x).

## Zero-Knowledge

The system property: the server stores only blobs it cannot decrypt and
never has access to the user's plaintext data in any operation.
