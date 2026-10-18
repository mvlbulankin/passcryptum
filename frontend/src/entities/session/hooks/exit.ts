import { useLoadingBar } from 'naive-ui'
import { createEmptyServices } from '#/services'

import { DROPDOWN_TIMEOUT } from '@/shared'
import { session, privateSessionId, privateServices } from '../model/private'

export const useExit = () => {
  const loadingBar = useLoadingBar()

  return {
    exit() {
      loadingBar.start()

      setTimeout(() => {
        // One path: the session closes itself (zeroizing what it owns and
        // closing the vault); the reactive projections follow.
        session.exit()
        privateSessionId.value = null
        privateServices.value = createEmptyServices()
        loadingBar.finish()
      }, DROPDOWN_TIMEOUT)
    },
  }
}
