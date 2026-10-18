import { computed } from 'vue'

import { session, sessionRevision } from '@/entities/session'

// The mode lives in the session; this is the Vue-facing projection of it.
// `sessionRevision` makes the computed re-evaluate when the mode changes.
export const isOnlineMode = computed(() => {
  void sessionRevision.value

  return session.mode() === 'online'
})

export const mode = computed(() =>
  session.mode() === 'online' ? 'Online' : 'Offline',
)
