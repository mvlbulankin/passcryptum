// Vault sync — pushing and pulling Services to the server. The
// Zero-Knowledge envelope (vault bytes wrapped in the session's secretbox
// keys), the merge policy and the failure vocabulary live here; callers
// keep the dialog and the toast.

import { createVaultSync } from './lib/sync'

export { createVaultSync } from './lib/sync'

export type {
  ClearOutcome,
  PullOutcome,
  PushOutcome,
  SyncReason,
  VaultSync,
  VaultSyncDevice,
} from './lib/types'

/** The one sync for the app: the real wire client. */
export const vaultSync = createVaultSync()
