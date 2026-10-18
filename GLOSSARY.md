# Passcryptum Glossary

Canonical domain terms. No implementation details.

## Origin Buffer

A 256-byte block, the source of all of the user's cryptographic material:
the Ed25519 key pair seed, the secret box key, the AES key, and the password
generation entropy. Unlocked by a PIN via PBKDF2. Stored on the user's
device; never sent to the server. IVs are not taken from the buffer — each
record gets a fresh random IV; legacy blobs with a static IV are still
readable.

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

The value of the `Hashed-Pin` header. In protocol v1 — a single unsalted
SHA-512 of the PIN. In v2 — `PBKDF2-SHA512(SHA-512(pin), salt = public key,
600k iterations)`; the server additionally re-hashes what it receives with
its own salt (the protector). The client enforces a minimum PIN length of 8.

## Services

The encrypted AES-CBC blob of the user's data (logins and per-service
password settings). Opaque to the server. Stored in the Profile;
synchronized between the user's devices.

## Wire Protocol

The frontend↔server protocol: base64 headers (`Public-Key`, `Hashed-Pin`,
`Protector`, `Timestamp`, `Signature`), bodies of
`base64(signature ‖ 4-byte LE timestamp ‖ payload)`, four endpoints
(`/api/profiles/`, `/api/credentials/`). GET/DELETE on credentials carry no
signature at all (factors instead of a signature).

Two versions ([ADR-0003](docs/adr/0003-protocol-v2.md)): **v1** — symmetric ±300 s window, signatures over
`timestamp` (headers) / `ts ‖ payload` (bodies), replay protection on POST
only. **v2** — requested via the `Protocol-Version: 2` header: signatures
include the HTTP method (`method ‖ ts` / `method ‖ ts ‖ payload`), the
window is one-sided `0 ≤ now − ts ≤ 300`, replay protection covers every
signed request, and the wire Hashed-Pin is the client-side PBKDF2 (see
Hashed PIN). The server speaks both; v1 stays for devices with cached older
shells. Protocol versions are independent of product versions (2.x/3.x).

## Zero-Knowledge

The system property: the server stores only blobs it cannot decrypt and
never has access to the user's plaintext data in any operation.
