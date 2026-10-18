import { useLoadingBar } from 'naive-ui'
import { exit as exitCoreSession } from '#/core'

import { DROPDOWN_TIMEOUT } from '@/shared'
import { closeSession } from '../model/private'

export const useExit = () => {
  const loadingBar = useLoadingBar()

  return {
    exit() {
      loadingBar.start()

      setTimeout(() => {
        closeSession()
        // The UI previously only cleared reactive state; the core
        // session (zeroized buffers) was never dropped on "exit".
        exitCoreSession()
        loadingBar.finish()
      }, DROPDOWN_TIMEOUT)
    },
  }
}
