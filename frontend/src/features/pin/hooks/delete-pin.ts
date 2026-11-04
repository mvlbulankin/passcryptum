import { computed } from 'vue'
import { useMessage, useDialog, useLoadingBar } from 'naive-ui'
import { pinCustody } from '#/core'

import {
  isOnlinePinSet,
  isOfflinePinSet,
  isCalculationInProgress,
} from '@/entities/session'
import { showPublicKeyError } from '@/features/storage/lib/public-key-error'

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
          loadingBar.start()

          try {
            const revoked = await pinCustody.revoke('online')

            if (revoked.ok) {
              message.info('Your online PIN has been deleted')
            } else if (
              revoked.reason === 'unknownCredential' ||
              revoked.reason === 'unknownProfile'
            ) {
              // The credential (or the profile) is gone server-side; the
              // device's record cannot be used to revoke what is not there.
              showPublicKeyError(dialog)
            } else {
              message.error('Failed to delete the online PIN')
            }
          } finally {
            // The custody notified its subscribers: PIN availability
            // re-derives without a manual touch.
            loadingBar.finish()
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
          loadingBar.start()

          pinCustody.revoke('offline')
          message.info('Your offline PIN has been deleted')
          requestAnimationFrame(() => loadingBar.finish())
        },
      })
    },
  }
}
