import {
  add,
  deleteLogin,
  deleteService,
  ServicesConfig,
  checkForEmptiness,
  mergeConfigurations,
  createEmptyServices,
  updateVersionOfLogin,
  updateServicePreferences,
} from '#/services'
import { ref, computed } from 'vue'
import { pinCustody } from '#/core'

import { privateServices, privateSessionId, session } from './private'

// The busy owner: the flag is written by runBlocking alone.
export { isCalculationInProgress, runBlocking } from '../lib/busy'

export type { Bar } from '../lib/busy'

// PIN availability is derived from the custody's storage — never a stale
// copy. The refs exist only to re-evaluate on changes: the session fires on
// enter/exit/mode, the custody on store/revoke/mode (no manual touch calls).
export const sessionRevision = ref(0)

session.subscribe(() => {
  sessionRevision.value += 1
})

pinCustody.subscribe(() => {
  sessionRevision.value += 1
})

// Re-computed on any session or custody change: pinCustody.isSet reads
// storage, so the revision is tracked explicitly rather than inferred.
export const isOnlinePinSet = computed(() => {
  void sessionRevision.value

  return pinCustody.isSet('online')
})

export const isOfflinePinSet = computed(() => {
  void sessionRevision.value

  return pinCustody.isSet('offline')
})

export const sessionId = computed(() => privateSessionId.value)

const saveServices = () => session.vault().write(privateServices.value)

export const addServiceAndLogin = (serviceName: string, loginName: string) => {
  add(privateServices.value, serviceName.trim(), loginName.trim())

  return saveServices()
}

export const importServices = (newServices: ServicesConfig) => {
  privateServices.value = mergeConfigurations(
    privateServices.value,
    newServices,
  )

  return saveServices()
}

export const areServicesEmpty = computed(() =>
  checkForEmptiness(privateServices.value),
)

export const clearServices = () => {
  void session.vault().clear()

  privateServices.value = createEmptyServices()
}

export const setServicePreferences = (
  name: string,
  passwordLengthIndex: number,
  useSpecialCharacters: boolean,
) => {
  updateServicePreferences(
    privateServices.value,
    name,
    passwordLengthIndex,
    useSpecialCharacters,
  )

  return saveServices()
}

export const rmService = (name: string) => {
  deleteService(privateServices.value, name)

  return saveServices()
}

export const rmLogin = (serviceName: string, loginName: string) => {
  deleteLogin(privateServices.value, serviceName, loginName)

  return saveServices()
}

export const setVersionOfLogin = (
  serviceName: string,
  loginName: string,
  version: number,
) => {
  updateVersionOfLogin(privateServices.value, serviceName, loginName, version)

  return saveServices()
}
