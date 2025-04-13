import { ref, computed } from 'vue'

import { lsKey, modeVariants } from './constants'

const lsMode = localStorage.getItem(lsKey)
const isLsOnlineMode = lsMode === modeVariants.online

export const isOnlineMode = ref(lsMode ? isLsOnlineMode : false)

export const mode = computed(() =>
  isOnlineMode.value ? modeVariants.online : modeVariants.offline,
)
