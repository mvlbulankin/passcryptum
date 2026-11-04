import { computed, readonly, ref } from 'vue'

// "A blocking operation is in flight" — one owner for the whole app.
//
// The flag gates the login form and the header menu: an operation that
// throws without releasing it locks the user out until a page reload (the
// hazard its first comment warned about was live in three components). The
// loading bar has the same discipline and drifted the same way. Both live
// here now: `runBlocking` is the only writer, and it cannot skip its exit
// path.

const depth = ref(0)

/** True while any blocking operation is in flight. Never write to it. */
export const isCalculationInProgress = readonly(computed(() => depth.value > 0))

/** The part of naive-ui's loading bar `runBlocking` drives. */
export type Bar = {
  start(): void
  finish(): void
  error(): void
}

/**
 * Runs an operation with the busy flag held (and the loading bar shown).
 *
 * Nested calls are safe: the flag is released when the outermost operation
 * finishes, so an inner action cannot clear the flag an outer one still
 * needs. The bar is driven by the outermost operation too — one bar for one
 * user-visible wait, not one per nested call.
 *
 * Errors are rethrown: the flag is always released, and the caller keeps
 * the choice of what to show.
 */
export const runBlocking = async <T>(
  action: () => T | Promise<T>,
  bar?: Bar,
): Promise<T> => {
  const outer = depth.value === 0

  depth.value += 1

  if (outer) {
    bar?.start()
  }

  let failed = false

  try {
    return await action()
  } catch (e) {
    failed = true

    throw e
  } finally {
    depth.value -= 1

    if (depth.value === 0) {
      if (failed) {
        bar?.error()
      } else {
        bar?.finish()
      }
    }
  }
}
