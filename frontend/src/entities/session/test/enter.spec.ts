import { webcrypto } from 'crypto'

import { describe, it, expect, beforeEach } from 'vitest'
import { pinCustody } from '#/core'

import { enterByPin } from '../lib/enter'
import { session } from '../model/private'
import { isCalculationInProgress } from '../lib/busy'

Object.defineProperty(global, 'crypto', { value: webcrypto })

// The flag discipline itself lives in busy.spec (runBlocking owns it). What
// is pinned here is what a PIN attempt MEANS: the custody's reason must
// survive to the login form verbatim — a network outage is not a wrong PIN.
// No mocks: the real session, the real custody, the real storage.

const originBuffer = () => crypto.getRandomValues(new Uint8Array(256)).buffer

describe('PIN entry', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('says no PIN is set when nothing is held', async () => {
    await expect(enterByPin('12345678')).rejects.toThrow(
      'No PIN is set on this device',
    )

    expect(isCalculationInProgress.value).toBe(false)
    expect(session.isActive()).toBe(false)
  })

  it('says the PIN is wrong when the stored custody refuses it', async () => {
    await pinCustody.store('offline', '12345678', originBuffer())

    await expect(enterByPin('87654321')).rejects.toThrow('Wrong PIN')

    expect(isCalculationInProgress.value).toBe(false)
    expect(session.isActive()).toBe(false)
  })

  it('signs in with the stored PIN and the flag is released', async () => {
    await pinCustody.store('offline', '12345678', originBuffer())

    await enterByPin('12345678')

    expect(session.isActive()).toBe(true)
    expect(isCalculationInProgress.value).toBe(false)

    session.exit()
  })
})
