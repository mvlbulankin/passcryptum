import { session, initSession } from '../model/private'
import { isCalculationInProgress } from '../model/public'

// The flag gates the login form (disabled input + button). It must be
// released on EVERY exit path — a failed attempt that leaves it set locks
// the user out of the form until a page reload.

export const enterByPassword = async (password: string) => {
  isCalculationInProgress.value = true

  try {
    const kit = await session.enter(password)

    initSession(kit.id, kit.services)
  } finally {
    isCalculationInProgress.value = false
  }
}

export const enterByPin = async (pin: string) => {
  isCalculationInProgress.value = true

  try {
    const kit = await session.enterWithPin(pin)

    initSession(kit.id, kit.services)
  } catch (e) {
    void e

    throw new Error('Wrong PIN')
  } finally {
    isCalculationInProgress.value = false
  }
}
