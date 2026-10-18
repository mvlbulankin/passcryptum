import { describe, it, expect, vi, beforeEach } from 'vitest'

// The session core is heavy (PBKDF2, storage); this pins the FLAG discipline
// of the app-level entry point: whichever way the attempt ends, the
// "calculation in progress" flag must be released — otherwise the login form
// stays disabled until the page reloads.

const enter = vi.fn()
const enterWithPin = vi.fn()
const initSession = vi.fn()

vi.mock('../model/private', () => ({
  session: {
    enter: (...a: unknown[]) => enter(...a),
    enterWithPin: (...a: unknown[]) => enterWithPin(...a),
    subscribe: () => () => undefined,
    isOnlinePinSet: () => false,
    isOfflinePinSet: () => false,
    vault: () => ({ write: () => Promise.resolve(), clear: () => Promise.resolve() }),
  },
  initSession: (...a: unknown[]) => initSession(...a),
}))

const { isCalculationInProgress } = await import('../model/public')
const { enterByPassword, enterByPin } = await import('../lib/enter')

const kit = { id: 'ABCD', services: null }

describe('session entry flag discipline', () => {
  beforeEach(() => {
    enter.mockReset()
    enterWithPin.mockReset()
    isCalculationInProgress.value = false
  })

  it('releases the flag after a failed password attempt', async () => {
    enter.mockRejectedValue(new Error('bad password'))

    await expect(enterByPassword('wrong')).rejects.toThrow()

    expect(isCalculationInProgress.value).toBe(false)
  })

  it('releases the flag after a successful password attempt', async () => {
    enter.mockResolvedValue(kit)

    await enterByPassword('right')

    expect(initSession).toHaveBeenCalledWith('ABCD', null)
    expect(isCalculationInProgress.value).toBe(false)
  })

  it('releases the flag after a failed PIN attempt', async () => {
    enterWithPin.mockRejectedValue(new Error('bad pin'))

    await expect(enterByPin('00000000')).rejects.toThrow('Wrong PIN')

    expect(isCalculationInProgress.value).toBe(false)
  })
})
