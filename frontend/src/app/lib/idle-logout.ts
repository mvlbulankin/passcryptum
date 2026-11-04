import { session } from '@/entities/session'

// An unattended logged-in tab keeps the master secret material in RAM
// indefinitely. Log out after a period of no interaction — through the same
// session.exit() the menu uses, with no UI ceremony. The reactive
// projections follow from the session's own notification.
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
    if (session.isActive() && Date.now() - lastActivity > IDLE_TIMEOUT) {
      session.exit()
    }
  }, CHECK_INTERVAL)
}
