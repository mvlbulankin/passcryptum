import { describe, it, expect } from 'vitest'

import { isCalculationInProgress, runBlocking, type Bar } from '../lib/busy'

// The busy discipline is in-process state with no I/O: exercised straight
// through its interface, no mocks beyond recording what the bar was asked
// to do.

const recordingBar = (): Bar & { calls: string[] } => {
  const calls: string[] = []

  return {
    calls,
    start: () => void calls.push('start'),
    finish: () => void calls.push('finish'),
    error: () => void calls.push('error'),
  }
}

describe('runBlocking', () => {
  it('holds the flag while the action runs', async () => {
    expect(isCalculationInProgress.value).toBe(false)

    const during = await runBlocking(async () => isCalculationInProgress.value)

    expect(during).toBe(true)
    expect(isCalculationInProgress.value).toBe(false)
  })

  it('releases the flag when the action throws, and rethrows', async () => {
    const boom = new Error('boom')

    await expect(
      runBlocking(() => {
        throw boom
      }),
    ).rejects.toBe(boom)

    expect(isCalculationInProgress.value).toBe(false)
  })

  it('finishes the bar on success and errors it on failure', async () => {
    const bar = recordingBar()

    await runBlocking(() => 'ok', bar)
    expect(bar.calls).toEqual(['start', 'finish'])

    const failing = recordingBar()

    await expect(
      runBlocking(() => Promise.reject(new Error('x')), failing),
    ).rejects.toThrow('x')
    expect(failing.calls).toEqual(['start', 'error'])
  })

  it('releases the flag only when the outermost operation finishes', async () => {
    const outer = recordingBar()

    await runBlocking(async () => {
      await runBlocking(() => 'inner', outer)

      // The inner call is done; the outer one is not.
      expect(isCalculationInProgress.value).toBe(true)
    }, outer)

    expect(isCalculationInProgress.value).toBe(false)
    expect(outer.calls).toEqual(['start', 'finish'])
  })

  it('returns the action result', async () => {
    await expect(runBlocking(async () => 42)).resolves.toBe(42)
  })
})
