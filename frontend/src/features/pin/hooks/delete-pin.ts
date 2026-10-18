import { computed } from 'vue'
import { useMessage, useDialog, useLoadingBar } from 'naive-ui'
import { deleteOnlinePin, deleteOfflinePin, isForbidden } from '#/core'

import {
  isOnlinePinSet,
  isOfflinePinSet,
  isCalculationInProgress,
} from '@/entities/session'
import { touchSession } from '../model'
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
            // The request must settle before the UI claims success: the
            // old code fired the message while the request was in flight.
            const revoked = await deleteOnlinePin(localStorage)

            if (!revoked) {
              showPublicKeyError(dialog)
            } else {
              message.info('Your online PIN has been deleted')
            }
          } catch (e) {
            if (isForbidden(e)) {
              showPublicKeyError(dialog)
            } else {
              message.error('Failed to delete the online PIN')
            }
          } finally {
            touchSession()
            loadingBar.finish()
          }
        },
      })
    },
  }
}

export const useDeleteOfflinePin = () => {
  const dialog = useDialog()
  const message = useMessage()
  const loadingBar = useLoadingBar()

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
          deleteOfflinePin(localStorage)
          touchSession()
          message.info('Your offline PIN has been deleted')
          requestAnimationFrame(() => loadingBar.finish())
        },
      })
    },
  }
}
