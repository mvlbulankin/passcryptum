import { useDialog, useMessage, useLoadingBar } from 'naive-ui'
import {
  vaultSync,
  type ClearOutcome,
  type PullOutcome,
  type PushOutcome,
  type SyncReason,
} from '#/core'

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

type Action = 'upload' | 'download' | 'delete'

/**
 * What each action says for each outcome. The sync module reports a closed
 * vocabulary; this table is the whole of the UI's interpretation of it, so a
 * new outcome cannot be silently reported as a success (the previous
 * `result: string` shape let `corrupt` fall through to "nothing new").
 */
const TEXTS: {
  upload: Record<'pushed' | 'nothingToPush', string>
  download: Record<'pulled' | 'nothingOnServer' | 'corrupt', string>
  delete: Record<'cleared' | 'alreadyEmpty', string>
} = {
  upload: {
    pushed: 'Services have been uploaded to server successfully',
    nothingToPush: 'There is nothing to upload',
  },
  download: {
    pulled: 'Services have been downloaded from server successfully',
    nothingOnServer: 'Services not found on server',
    corrupt: 'The copy on the server cannot be read — it was left untouched',
  },
  delete: {
    cleared: 'All of your services have been deleted from server',
    alreadyEmpty: 'All of your services have already been deleted from server',
  },
}

/** Only these outcomes changed nothing; everything else is a failure. */
const FAILED_RESULTS: ReadonlySet<string> = new Set(['corrupt'])

const reasonText = (reason: SyncReason, action: Action) => {
  switch (reason) {
    case 'unknownProfile':
      return 'Your public key is not registered'
    case 'network':
      return 'Network error — check the connection and try again'
    default:
      return `An error occurred while ${
        action === 'delete' ? 'deleting' : `${action}ing`
      } services`
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
    action: Action,
    operation: () => Promise<PushOutcome | PullOutcome | ClearOutcome>,
  ) => {
    try {
      const outcome = await runBlocking(operation, loadingBar)

      if (!outcome.ok) {
        if (outcome.reason === 'unknownProfile') {
          showPublicKeyError(dialog)
        } else {
          message.error(reasonText(outcome.reason, action))
        }

        return
      }

      const texts: Record<string, string> = TEXTS[action]
      const text = texts[outcome.result] ?? 'Done'

      if (FAILED_RESULTS.has(outcome.result)) {
        message.error(text)
      } else {
        message.success(text)
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
