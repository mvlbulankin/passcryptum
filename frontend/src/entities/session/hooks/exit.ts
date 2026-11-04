import { useLoadingBar } from 'naive-ui'

import { DROPDOWN_TIMEOUT } from '@/shared'
import { runBlocking } from '../lib/busy'
import { session } from '../model/private'

export const useExit = () => {
  const loadingBar = useLoadingBar()

  return {
    exit() {
      // The timeout is the menu's close animation, not work: it runs inside
      // the blocking window so the bar and the flag cover the whole exit.
      void runBlocking(
        () =>
          new Promise<void>(resolve => {
            setTimeout(() => {
              // One path: the session closes itself (zeroizing what it owns
              // and closing the vault); the reactive projections follow from
              // its notification.
              session.exit()
              resolve()
            }, DROPDOWN_TIMEOUT)
          }),
        loadingBar,
      )
    },
  }
}
