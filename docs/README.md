# Documentation

Three kinds of documents, kept apart on purpose:

- **[How to use Passcryptum](pin.md)** — user-facing guides:
  [PIN usage](pin.md), [recommendations](recommendations.md),
  [password generation](password-generation.md).
- **[Architecture decisions](adr/)** — why the system is built the way it
  is, one decision per record. Read the relevant record before changing an
  area it covers; do not re-litigate a decision without a new record.
- **[Upstream notes](upstream/)** — local copies of the two issues from
  [nelkor/passcryptum](https://github.com/nelkor/passcryptum) that define the
  3.x direction (one implemented, one open).

Per-component developer docs live next to their code:
[backend](../backend/README.md), [frontend](../frontend/README.md),
[core module](../frontend/modules/core/README.md),
[services module](../frontend/modules/services/README.md),
[contract suite](../backend/contract/README.md). Domain vocabulary is in the
root [GLOSSARY](../GLOSSARY.md); work conventions for agents are in
[AGENTS](../AGENTS.md).

## Architecture decision records

| # | Decision | Status |
|---|---|---|
| [0001](adr/0001-architecture.md) | Single Go binary, SQLite, Caddy gateway | accepted |
| [0002](adr/0002-wire-protocol-contract.md) | The Wire Protocol is a versioned public contract | accepted |
| [0003](adr/0003-protocol-v2.md) | Protocol v2: method-bound signatures with nonce, one-sided window, replay on all signed requests, client-side PIN KDF | accepted |
| [0004](adr/0004-salt-less-origin-derivation.md) | Salt-less origin buffer derivation is accepted deliberately | accepted |

New records: copy the shape of an existing one, number sequentially, and add
the row above.
