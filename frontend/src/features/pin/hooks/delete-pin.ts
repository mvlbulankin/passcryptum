import { computed } from 'vue'
import { useMessage, useDialog, useLoadingBar } from 'naive-ui'
import { pinCustody } from '#/core'

import {
  isOnlinePinSet,
  isOfflinePinSet,
  isCalculationInProgress,
  runBlocking,
} from '@/entities/session'
import { showPublicKeyError } from '@/shared'

export const useDeleteOnlinePin = () => {
  const dialog = useDialog()
  const message = useMessage()
  const loadingBar = useLoadingBar()

  return {
    isDeleteOnlinePinDisabled: computed(
      () => !isOnlinePinSet.value || isCalculationInProgress.value,
    ),
    deleteOnlinePin() {
      dialog.warning({
        title: 'Your online PIN will be deleted',
        content: 'Are you sure you want to delete your online PIN?',
        positiveText: 'Yes, delete online PIN',
        negativeText: 'Cancel',
        async onPositiveClick() {
          try {
            const revoked = await runBlocking(
              () => pinCustody.revoke('online'),
              loadingBar,
            )

            if (revoked.ok) {
              message.info('Your online PIN has been deleted')
            } else if (revoked.reason === 'unknownCredential') {
              // The credential is gone server-side; the device's record
              // cannot revoke what is not there.
              showPublicKeyError(dialog)
            } else {
              message.error('Failed to delete the online PIN')
            }
          } catch {
            message.error('Failed to delete the online PIN')
          }
        },
      })
    },
  }
}

export const useDeleteOfflinePin = () => {
  const message = useMessage()
  const loadingBar = useLoadingBar()
  const dialog = useDialog()

  return {
    isDeleteOfflinePinDisabled: computed(
      () => !isOfflinePinSet.value || isCalculationInProgress.value,
    ),
    deleteOfflinePin() {
      dialog.warning({
        title: 'Your offline PIN will be deleted',
        content: 'Are you sure you want to delete your offline PIN?',
        positiveText: 'Yes, delete offline PIN',
        negativeText: 'Cancel',
        onPositiveClick() {
          void runBlocking(() => pinCustody.revoke('offline'), loadingBar)

          message.info('Your offline PIN has been deleted')
        },
      })
    },
  }
}
