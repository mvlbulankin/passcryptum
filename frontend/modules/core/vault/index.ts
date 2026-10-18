// Vault — where Services live on this device. One blob, one format decision,
// one place that knows how it is encrypted and how it travels to a file.
// Callers work with ServicesConfig; no representation leaks out.

export { createVault } from './lib/vault'

export { VaultClosedError } from './lib/types'

export type { Vault, VaultSession, VaultStorage } from './lib/types'
