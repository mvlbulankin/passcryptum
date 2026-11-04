import { ref } from 'vue'
import { createSession } from '#/core'
import { createEmptyServices, parse } from '#/services'

// The one session instance for the app. Everything reactive below is a
// projection of it: the session owns the truth, Vue only renders it.
export const session = createSession()

export const privateSessionId = ref<string | null>(null)

export const privateServices = ref(createEmptyServices())

/**
 * Re-reads the session into the reactive projections. The session's own
 * notifications drive it, so enter, exit and the idle logout all land here
 * instead of each remembering to reset the refs itself.
 *
 * Services are NOT re-read here: they arrive with the StarterKit from
 * enter() (reading them back would repeat an async vault read), and they
 * survive a mode change. Only "no session" clears them.
 */
export const syncFromSession = () => {
  privateSessionId.value = session.isActive() ? session.profileId() : null

  if (!session.isActive()) {
    privateServices.value = createEmptyServices()
  }
}

session.subscribe(syncFromSession)

/** Hand the Services a successful entry delivered. */
export const setServices = (services: string | null) => {
  privateServices.value = parse(services)
}
