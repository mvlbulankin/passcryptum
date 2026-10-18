import { exit as exitCoreSession } from '#/core'

import {
  closeSession,
  privateSessionId,
} from '@/entities/session/model/private'

// An unattended logged-in tab keeps the master secret material in RAM
// indefinitely. Log out after a period of no interaction.
export const IDLE_TIMEOUT = 5 * 60 * 1000

const CHECK_INTERVAL = 30 * 1000

let lastActivity = Date.now()

const activity = () => {
  lastActivity = Date.now()
}

export const watchIdleLogout = () => {
  for (const event of ['pointerdown', 'keydown']) {
    window.addEventListener(event, activity, { passive: true })
  }

  setInterval(() => {
    if (
      privateSessionId.value !== null &&
      Date.now() - lastActivity > IDLE_TIMEOUT
    ) {
      closeSession()
      exitCoreSession()
    }
  }, CHECK_INTERVAL)
}
