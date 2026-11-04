import { PinReleaseError, type CustodyReason } from '#/core'

import { session, setServices } from '../model/private'

// What a login attempt MEANS. Holding the busy flag and driving the loading
// bar is runBlocking's job; the page wraps the attempt in it.

/** The custody's closed vocabulary, mapped to what the login form can say. */
export const pinReleaseMessage = (reason: CustodyReason): string => {
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
  const kit = await session.enter(password)

  setServices(kit.services)
}

export const enterByPin = async (pin: string) => {
  try {
    const kit = await session.enterWithPin(pin)

    setServices(kit.services)
  } catch (e) {
    if (e instanceof PinReleaseError) {
      throw new Error(pinReleaseMessage(e.reason))
    }

    throw e
  }
}
