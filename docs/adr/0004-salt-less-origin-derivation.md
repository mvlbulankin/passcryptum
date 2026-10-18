# 0004. Salt-less origin buffer derivation is accepted deliberately

Date: 2026-10-18
Status: accepted

## Context

The origin buffer is derived from the user's password via
`PBKDF2(password, salt = SHA-256(password), 262 144 iterations)`. The salt
is a pure function of the input: it contains not a single bit outside the
password. Consequences:

- Two users with the same password derive byte-identical origin buffers and
  therefore identical Ed25519 public keys — password equality is observable
  by the server operator.
- A precomputed dictionary ("password → public key") is calculated once and
  applies to every user of every instance running this code; the salt adds
  no per-user uniqueness.

Three fixes were considered: an instance-wide random salt served by the
login page (not secret, cheap to build); a per-user salt plus a public
account identifier (heavier: adds a concept the protocol does not have);
and a salt as a second carried secret, 1Password-style (strongest against
server compromise, but losing the salt means losing the vault with no
recovery). Every variant shares the same cost: a new salt changes the root
of the derivation tree — new origin buffer, new profile key (re-onboard),
re-encrypted vault, re-enrolled PINs, and **every generated service password
changes**.

## Decision

Salt-less derivation is accepted for the current deployment. The deciding
argument is the threat model: the instance is single-profile (one user), and
both attacks the defect enables need multiple profiles to pay off — there is
nobody to compare passwords with, and a universal dictionary costs the same
as a targeted attack against one user (salty or not: 262 144 iterations per
guess either way). The defense of this particular user rests on the entropy
of the origin password, the KDF cost, and the rate limiter.

**The trigger to reopen this decision is the appearance of a second Profile
on the instance.** The system allows the admin to onboard several public
keys; at ≥2 profiles password-equality detection becomes live, and any move
toward multi-user operation starts here.

## Consequences

No migration now; the derivation tree stays stable; the login UX unchanged.
Accepted risks: precomputed dictionaries remain applicable to instances
running this code (moot for a single-profile deployment); a second profile
must reopen this record.
