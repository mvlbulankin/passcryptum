import { describe, it, expect, vi, beforeEach } from 'vitest'

// The session core is heavy (PBKDF2, localStorage); this test pins the FLAG
// discipline of the app-level entry point: whichever way the attempt ends,
// the "calculation in progress" flag must be released — otherwise the login
// form stays disabled until the page reloads.

const enterWithOriginPassword = vi.fn()
const enterWithPin = vi.fn()

vi.mock('#/core', () => ({
  enterWithOriginPassword: (...args: unknown[]) => enterWithOriginPassword(...args),
  enterWithPin: (...args: unknown[]) => enterWithPin(...args),
}))

vi.mock('../model/private', () => ({
  initSession: vi.fn(),
}))

const { isCalculationInProgress } = await import('../model/public')
const { enterByPassword, enterByPin } = await import('../lib/enter')

describe('session entry flag discipline', () => {
  beforeEach(() => {
    enterWithOriginPassword.mockReset()
    enterWithPin.mockReset()
    isCalculationInProgress.value = false
  })

  it('releases the flag after a failed password attempt', async () => {
    enterWithOriginPassword.mockRejectedValue(new Error('bad password'))

    await expect(enterByPassword('wrong')).rejects.toThrow()

    expect(isCalculationInProgress.value).toBe(false)
  })

  it('releases the flag after a successful password attempt', async () => {
    enterWithOriginPassword.mockResolvedValue({ id: 'ABCD', data: null })

    await enterByPassword('right')

    expect(isCalculationInProgress.value).toBe(false)
  })

  it('releases the flag after a failed PIN attempt', async () => {
    enterWithPin.mockRejectedValue(new Error('bad pin'))

    await expect(enterByPin('0000')).rejects.toThrow('Wrong PIN')

    expect(isCalculationInProgress.value).toBe(false)
  })
})
