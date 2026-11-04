import { PinReleaseError, type CustodyReason } from '#/core'

import { session, initSession } from '../model/private'
import { isCalculationInProgress } from '../model/public'

// The flag gates the login form (disabled input + button). It must be
// released on EVERY exit path — a failed attempt that leaves it set locks
// the user out of the form until a page reload.

/** The custody's closed vocabulary, mapped to what the login form can say. */
const pinReleaseMessage = (reason: CustodyReason): string => {
  switch (reason) {
    case 'wrongPin':
      return 'Wrong PIN'
    case 'noStoredBuffer':
      return 'No PIN is set on this device'
    case 'network':
      return 'Network error — check the connection and try again'
    default:
      return 'Failed to sign in with the PIN'
  }
}

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
    if (e instanceof PinReleaseError) {
      throw new Error(pinReleaseMessage(e.reason))
    }

    throw e
  } finally {
    isCalculationInProgress.value = false
  }
}
