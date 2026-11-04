import { useLoadingBar } from 'naive-ui'

import { isOnlineMode } from '../model'
import { runBlocking, session } from '@/entities/session'

export const useChangeOnlineMode = () => {
  const loadingBar = useLoadingBar()

  const toggleOnlineMode = () =>
    runBlocking(
      () => session.setMode(isOnlineMode.value ? 'offline' : 'online'),
      loadingBar,
    )

  return { toggleOnlineMode }
}
