# Passcryptum core

The modules that hold secrets: the session, the vault, the wire client, PIN
handling and the crypto primitives underneath. Nothing here knows about Vue
or the DOM — the one exception is `src/entities/session`, which projects the
session into reactive state.

Import from the barrel (`#/core`) only. `core/index.ts` lists the surface the
application actually uses; everything else is an implementation detail, and
`modules/core/test/barrel.spec.ts` fails the build if `src/` reaches past it.

## What is here

| Module         | Owns                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `session/`     | who is logged in: the derived keys, the vault instance, the visited flag                           |
| `vault/`       | Services as stored on the device: one encrypted blob, its format, export to a file and import back |
| `wire/`        | the Wire Protocol client — the only way the app talks to the server                                |
| `pin/`         | PIN Custody: holding the Origin Buffer under a PIN, online or offline (GLOSSARY)                   |
| `sync/`        | pushing and pulling the Vault: the zero-knowledge envelope and the merge policy                    |
| `generator/`   | service password derivation from Entropy                                                           |
| `shared/`      | crypto/encoding primitives and the Origin Buffer layout                                            |
| `constants.ts` | protocol and storage constants (iterations, key names, minimum PIN length)                         |

## Logging in and out

"Logging in" means deriving the Origin Buffer and starting a session;
"logging out" means destroying it.

```ts
createSession(options?): Session

Session.enter(password): Promise<StarterKit>   // origin password
Session.enterWithPin(pin): Promise<StarterKit> // offline or online PIN
Session.exit(): void
```

`StarterKit` carries the Profile id and the stored Services (or `null`).
`enter` is slow by design: PBKDF2 with 262 144 iterations.

After `exit()`, every secret accessor throws `SessionClosedError`; the vault
closes with it, and the Origin Buffer is zeroized before the reference is
dropped.

`enterWithPin` delegates to the PIN Custody and surfaces its failure
vocabulary as `PinReleaseError` (`reason`: wrongPin, noStoredBuffer,
network, …) — a network outage is no longer reported as a wrong PIN.

## Holding the Origin Buffer under a PIN

```ts
pinCustody.store(kind, pin, buffer) // hand it over: 'online' | 'offline'
pinCustody.release(pin) // take it back; source follows the mode
pinCustody.revoke(kind) // drop one custody
pinCustody.isSet(kind) // derived from storage, never stale
```

Online custody is a Credential on the server (the device keeps the public
key and the Protector); offline custody is an encrypted blob on the device.
The KDFs, the localStorage record and the wire calls stay behind the
interface; failures come back as a closed outcome vocabulary the UI maps to
texts. The session exposes `mode()`/`setMode()` as a delegation to the
custody, which owns the stored mode.

## Reading and writing Services

```ts
Session.vault(): Vault

Vault.read(): Promise<ServicesConfig | null>
Vault.write(services): Promise<void>
Vault.clear(): Promise<void>
Vault.exportBytes(): Promise<Uint8Array | null>
Vault.importBytes(bytes): Promise<ServicesConfig | null>
Vault.importText(text): Promise<ServicesConfig | null>
```

The interface speaks `ServicesConfig`. The on-disk envelope (marker, per-save
IV, AES-CBC), the pre-3.0 static-IV format and hex encoding stay inside the
module. A blob that cannot be read is dropped and reported as `null`.

## Talking to the server

```ts
wire.getServices(keyPairSeed) / setServices(...) / clearServices(...)
wire.getEntropy(...) / createCredential(...) / deleteCredential(...)
```

Each function is one Wire Protocol endpoint; framing, signing, nonce and
version headers are internal — an endpoint table drives one request builder.
Failures are `WireError` with a `kind`;
`isForbidden(e)` answers the one case the UI treats specially.

## Synchronising the Vault

```ts
vaultSync.push(device) / pull(device) / clear(device)
```

`device` is what a device contributes: `keyPairSeed`, `transportKeys()`,
`vault`, and `apply(services)`. The zero-knowledge envelope (vault bytes
wrapped in the session's secretbox keys) and the merge policy — pulling
merges with what the device holds instead of overwriting it — are the
module's business. Outcomes are a closed vocabulary
(`pushed`/`nothingToPush`, `pulled`/`nothingOnServer`/`corrupt`/
`emptyAfterMerge`, `cleared`/`alreadyEmpty`, plus `unknownProfile`,
`network`, `unexpected`).

## Subscribing to state

```ts
Session.subscribe(listener): () => void
pinCustody.subscribe(listener): () => void
```

The session and the custody are plain state; `src/entities/session` wraps
them in refs and re-reads on change. PIN flags are derived from the
custody's storage on each read, never snapshotted — a stale flag cannot
appear.

## Tests

Specs live next to the code (`*/test/*.spec.ts`) and run in `happy-dom`, so
localStorage and the DOM are available. `wire/test/live.spec.ts` additionally
talks to a real backend when `PC_BASE_URL` (and a profile's keys) are set;
`e2e/run.sh` runs it on every invocation.
