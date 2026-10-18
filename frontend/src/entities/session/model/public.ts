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

import { privateServices, privateSessionId, session } from './private'

export const isCalculationInProgress = ref(false)

// PIN availability is derived from the session (which derives it from
// storage), not snapshotted — so it cannot go stale behind a setter nobody
// remembered to call. The ref only exists to re-evaluate on session changes.
export const sessionRevision = ref(0)

session.subscribe(() => {
  sessionRevision.value += 1
})

export const isOnlinePinSet = computed(
  () => sessionRevision.value >= 0 && session.isOnlinePinSet(),
)

export const isOfflinePinSet = computed(
  () => sessionRevision.value >= 0 && session.isOfflinePinSet(),
)

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
