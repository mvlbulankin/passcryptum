import { useLoadingBar } from 'naive-ui'

import { isOnlineMode } from '../model'
import { session } from '@/entities/session'

export const useChangeOnlineMode = () => {
  const loadingBar = useLoadingBar()

  const toggleOnlineMode = () => {
    loadingBar.start()
    session.setMode(isOnlineMode.value ? 'offline' : 'online')
    loadingBar.finish()
  }

  return { toggleOnlineMode }
}
