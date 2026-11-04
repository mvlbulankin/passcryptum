import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import { vaultSync, type SyncReason } from '#/core'

import { runBlocking, session, importServices } from '@/entities/session'
import { showPublicKeyError } from '@/shared'

/**
 * The device the sync module needs, read from the live session. Three
 * fields — the session is a dependency of this adapter, not of the module.
 */
const currentDevice = () => ({
  keyPairSeed: session.keyPairSeed(),
  transportKeys: () => session.transportKeys(),
  vault: session.vault(),
  apply: (services: Parameters<typeof importServices>[0]) =>
    importServices(services),
})

const reasonText = (
  reason: SyncReason,
  action: 'upload' | 'download' | 'delete',
) => {
  switch (reason) {
    case 'unknownProfile':
      return 'Your public key is not registered'
    case 'network':
      return 'Network error — check the connection and try again'
    default:
      return `An error occurred while ${action === 'delete' ? 'deleting' : `${action}ing`} services`
  }
}

/**
 * Pushing and pulling the Vault. The module owns the envelope and the merge
 * policy; this hook owns only what a component cannot know: the dialogs,
 * the toasts and the loading bar.
 */
export const useVaultSync = () => {
  const dialog = useDialog()
  const message = useMessage()
  const loadingBar = useLoadingBar()

  const run = async (
    action: 'upload' | 'download' | 'delete',
    operation: () => Promise<
      { ok: true; result: string } | { ok: false; reason: SyncReason }
    >,
  ) => {
    try {
      const outcome = await runBlocking(operation, loadingBar)

      if (outcome.ok) {
        message.success(successText(action, outcome.result))
      } else if (outcome.reason === 'unknownProfile') {
        showPublicKeyError(dialog)
      } else {
        message.error(reasonText(outcome.reason, action))
      }
    } catch {
      message.error(reasonText('unexpected', action))
    }
  }

  return {
    uploadServices: () => run('upload', () => vaultSync.push(currentDevice())),

    downloadServices: () =>
      run('download', () => vaultSync.pull(currentDevice())),

    deleteServices: () => run('delete', () => vaultSync.clear(currentDevice())),
  }
}

const successText = (
  action: 'upload' | 'download' | 'delete',
  result: string,
) => {
  if (action === 'upload') {
    return 'Services have been uploaded to server successfully'
  }

  if (action === 'download') {
    return result === 'pulled'
      ? 'Services have been downloaded from server successfully'
      : 'There was nothing new on the server'
  }

  return result === 'cleared'
    ? 'All of your services have been deleted from server'
    : 'All of your services have already been deleted from server'
}
