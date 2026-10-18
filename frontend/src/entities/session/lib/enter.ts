import { enterWithOriginPassword, enterWithPin } from '#/core'

import { initSession } from '../model/private'
import { isCalculationInProgress } from '../model/public'

// The flag gates the login form (disabled input + button). It must be
// released on EVERY exit path — a failed attempt that leaves it set locks
// the user out of the form until a page reload.

export const enterByPassword = async (password: string) => {
  isCalculationInProgress.value = true

  try {
    const { id, data } = await enterWithOriginPassword(password)

    initSession(id, data)
  } finally {
    isCalculationInProgress.value = false
  }
}

export const enterByPin = async (pin: string) => {
  isCalculationInProgress.value = true

  try {
    const { id, data } = await enterWithPin(pin)

    initSession(id, data)
  } catch (e) {
    void e

    throw new Error('Wrong PIN')
  } finally {
    isCalculationInProgress.value = false
  }
}
