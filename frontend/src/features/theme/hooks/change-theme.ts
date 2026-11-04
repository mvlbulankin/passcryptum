import { computed, watch } from 'vue'
import { useLoadingBar } from 'naive-ui'

import { setTheme } from '@/dom'
import { DROPDOWN_TIMEOUT } from '@/shared'
import { runBlocking } from '@/entities/session'
import { isDarkTheme } from '../model'
import { lsKey, themeVariants } from '../constants'

export const useChangeTheme = () => {
  const loadingBar = useLoadingBar()

  const themeName = computed(() =>
    isDarkTheme.value ? themeVariants.light : themeVariants.dark,
  )

  const changeTheme = () => {
    void runBlocking(
      () =>
        new Promise<void>(resolve => {
          localStorage.setItem(lsKey, themeName.value)

          setTimeout(() => {
            isDarkTheme.value = !isDarkTheme.value
            resolve()
          }, DROPDOWN_TIMEOUT)
        }),
      loadingBar,
    )
  }

  watch(isDarkTheme, setTheme, { immediate: true })

  return { themeName, changeTheme }
}
