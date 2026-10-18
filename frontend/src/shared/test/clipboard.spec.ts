import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { CLIPBOARD_CLEAR_DELAY, writeToClipboard } from '../lib/clipboard'

// The clipboard is where plaintext passwords leak (history, cloud sync), so
// its rules are worth pinning: never write without focus, clear only what we
// wrote, and never clear blindly when the clipboard cannot be read.
describe('writeToClipboard', () => {
  let written: string[]
  let clipboardContent: string
  let focused: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    written = []
    clipboardContent = ''
    focused = true

    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => focused,
    })

    // happy-dom has no clipboard; provide what the module uses.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text: string) {
          written.push(text)
          clipboardContent = text
        },
        readText: async () => clipboardContent,
      },
    })

    Reflect.deleteProperty(
      window as unknown as Record<string, unknown>,
      'ClipboardItem',
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the secret', async () => {
    writeToClipboard('s3cret')
    await vi.waitFor(() => expect(written).toEqual(['s3cret']))
  })

  it('does nothing when the page is not focused', async () => {
    focused = false

    writeToClipboard('s3cret')
    await vi.advanceTimersByTimeAsync(0)

    expect(written).toEqual([])
  })

  it('accepts a promise of the secret', async () => {
    writeToClipboard(Promise.resolve('later'))
    await vi.waitFor(() => expect(written).toEqual(['later']))
  })

  it('clears the clipboard after the delay when it still holds our value', async () => {
    writeToClipboard('s3cret')
    await vi.waitFor(() => expect(written).toEqual(['s3cret']))

    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY)

    expect(written).toEqual(['s3cret', ''])
  })

  it('leaves a newer user copy alone', async () => {
    writeToClipboard('s3cret')
    await vi.waitFor(() => expect(written).toEqual(['s3cret']))

    clipboardContent = 'something the user copied since'

    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY)

    expect(written).toEqual(['s3cret'])
  })

  it('does not clear when the page lost focus by then', async () => {
    writeToClipboard('s3cret')
    await vi.waitFor(() => expect(written).toEqual(['s3cret']))

    focused = false

    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY)

    expect(written).toEqual(['s3cret'])
  })

  it('never schedules a clear for an empty secret', async () => {
    writeToClipboard('')
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY)

    expect(written).toEqual([''])
  })
})
