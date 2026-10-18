import { ref } from 'vue'
import { createSession } from '#/core'
import { createEmptyServices, parse } from '#/services'

// The one session instance for the app. Everything reactive below is a
// projection of it: the session owns the truth, Vue only renders it.
export const session = createSession()

export const privateSessionId = ref<string | null>(null)

export const privateServices = ref(createEmptyServices())

/** Re-reads the session into the reactive projections. */
export const syncFromSession = () => {
  privateSessionId.value = session.isActive() ? session.profileId() : null

  if (!session.isActive()) {
    privateServices.value = createEmptyServices()
  }
}

export const initSession = (id: string, services: string | null) => {
  privateSessionId.value = id
  privateServices.value = parse(services)
}
