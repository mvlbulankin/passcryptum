import { useLoadingBar } from 'naive-ui'

import { isOnlineMode } from '../model'
import { lsKey, modeVariants } from '../constants'

export const useChangeOnlineMode = () => {
  const loadingBar = useLoadingBar()

  const toggleOnlineMode = () => {
    loadingBar.start()
    localStorage.setItem(
      lsKey,
      isOnlineMode.value ? modeVariants.offline : modeVariants.online,
    )
    isOnlineMode.value = !isOnlineMode.value
    loadingBar.finish()
  }

  return { toggleOnlineMode }
}
