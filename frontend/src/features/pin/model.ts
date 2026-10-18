import { ref } from 'vue'

import { session, sessionRevision } from '@/entities/session'

export const showSetOnlinePinModal = ref(false)

export const showSetOfflinePinModal = ref(false)

/** Re-evaluates PIN-dependent computeds after a PIN changed. */
export const touchSession = () => {
  sessionRevision.value += 1
}

export { session }
