import { checkForEmptiness, mergeConfigurations } from '../../../services'

import { decryptData, encryptData } from '../../shared'
import { WireError, wire as defaultWire } from '../../wire'
import type { WireClient } from '../../wire'
import type {
  ClearOutcome,
  PullOutcome,
  PushOutcome,
  SyncReason,
  VaultSync,
  VaultSyncDevice,
} from './types'

const fail = (reason: SyncReason) => ({ ok: false as const, reason })

/**
 * A wire failure becomes a sync outcome. Every endpoint here is
 * signature-authenticated, so a 403 always means the same thing: the
 * Profile is not onboarded.
 */
const wireFailure = (e: unknown) => {
  if (e instanceof WireError) {
    if (e.kind === 'forbidden') {
      return fail('unknownProfile')
    }

    if (e.kind === 'network') {
      return fail('network')
    }
  }

  return fail('unexpected')
}

export const createVaultSync = (
  deps: { wire?: WireClient } = {},
): VaultSync => {
  const wireClient = deps.wire ?? defaultWire

  const push = async (device: VaultSyncDevice): Promise<PushOutcome> => {
    try {
      const bytes = await device.vault.exportBytes()

      if (!bytes) {
        return { ok: true, result: 'nothingToPush' }
      }

      // The Zero-Knowledge envelope: the vault's own bytes wrapped in this
      // session's secretbox keys. The server never sees either key.
      const { secretBoxIv, secretBoxKey } = device.transportKeys()
      const envelope = encryptData(bytes, secretBoxIv, secretBoxKey)

      await wireClient.setServices(device.keyPairSeed, envelope)

      return { ok: true, result: 'pushed' }
    } catch (e) {
      return wireFailure(e)
    }
  }

  const pull = async (device: VaultSyncDevice): Promise<PullOutcome> => {
    try {
      const envelope = await wireClient.getServices(device.keyPairSeed)

      if (!envelope) {
        return { ok: true, result: 'nothingOnServer' }
      }

      const { secretBoxIv, secretBoxKey } = device.transportKeys()
      const bytes = decryptData(envelope, secretBoxIv, secretBoxKey)

      if (!bytes) {
        return { ok: true, result: 'corrupt' }
      }

      // The vault knows its own storage format; anything it cannot read is
      // as useless to the caller as a broken envelope.
      const pulled = await device.vault.importBytes(
        new Uint8Array(bytes).buffer,
      )

      if (!pulled || checkForEmptiness(pulled)) {
        return { ok: true, result: 'corrupt' }
      }

      // Merge policy: pulling never clobbers what this device already has.
      const merged = mergeConfigurations(await current(device), pulled)

      if (checkForEmptiness(merged)) {
        return { ok: true, result: 'emptyAfterMerge' }
      }

      await device.apply(merged)

      return { ok: true, result: 'pulled' }
    } catch (e) {
      return wireFailure(e)
    }
  }

  const clear = async (device: VaultSyncDevice): Promise<ClearOutcome> => {
    try {
      const result = await wireClient.clearServices(device.keyPairSeed)

      return {
        ok: true,
        result: result === 'cleared' ? 'cleared' : 'alreadyEmpty',
      }
    } catch (e) {
      return wireFailure(e)
    }
  }

  return { push, pull, clear }
}

/** What this device currently holds, as the merge's left-hand side. */
const current = async (device: VaultSyncDevice) =>
  (await device.vault.read()) ?? []
