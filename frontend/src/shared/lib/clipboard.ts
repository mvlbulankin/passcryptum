const type = 'text/plain'

// Auto-clear the clipboard after a copied secret, but only if the
// clipboard still contains exactly what we wrote (never wipe the user's
// newer copy). Commercial managers (KeePassXC/1Password/Bitwarden) do this.
export const CLIPBOARD_CLEAR_DELAY = 30_000

let clearTimer: ReturnType<typeof setTimeout> | undefined

const polyfillCopy = async (str: string | Promise<string>) =>
  navigator.clipboard.writeText(await str)

const clearIfStillOurs = async (copied: string) => {
  try {
    if (!document.hasFocus()) {
      return
    }

    const current = await navigator.clipboard.readText()

    if (current === copied) {
      await polyfillCopy('')
    }
  } catch {
    // Clipboard read permission is not granted: do nothing. Clearing
    // blindly risks wiping unrelated content, which is worse.
  }
}

const scheduleClear = (copied: string) => {
  if (copied.length === 0) {
    return
  }

  clearTimeout(clearTimer)
  clearTimer = setTimeout(
    () => void clearIfStillOurs(copied),
    CLIPBOARD_CLEAR_DELAY,
  )
}

export const writeToClipboard = (str: string | Promise<string>) => {
  if (!document.hasFocus()) {
    return
  }

  void Promise.resolve(str).then(resolved => {
    if ('ClipboardItem' in window) {
      const clipboardItem = new ClipboardItem({
        [type]: Promise.resolve(resolved).then(
          result => new Blob([result], { type }),
        ),
      })

      void navigator.clipboard
        .write([clipboardItem])
        .then(() => scheduleClear(resolved))
    } else {
      void polyfillCopy(resolved).then(() => scheduleClear(resolved))
    }
  })
}
