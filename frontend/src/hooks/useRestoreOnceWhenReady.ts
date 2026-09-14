import { useCallback, useEffect, useState } from 'react'

interface RestoreOnceController {
  reset: (shouldRestore: boolean) => void
  recordOpen: (open: boolean, shouldRestore: boolean) => void
  consume: <T>(readyValue: T | null, restore: (value: T) => void) => void
}

/**
 * Creates the one-time state machine used by delayed field restoration
 */
export function createRestoreOnceController(
  initialShouldRestore: boolean,
  initialOpen?: boolean,
): RestoreOnceController {
  let pending = initialShouldRestore
  let wasOpen = initialOpen

  return {
    reset(shouldRestore) {
      pending = shouldRestore
    },
    recordOpen(open, shouldRestore) {
      const opening = open && wasOpen === false
      wasOpen = open
      if (opening) pending = shouldRestore
    },
    consume(readyValue, restore) {
      if (!pending || readyValue === null) return

      // Clear first because restoring usually causes another render synchronously
      pending = false
      restore(readyValue)
    },
  }
}

interface RestoreOnceWhenReadyOptions<T> {
  open?: boolean
  shouldRestore: boolean
  readyValue: T | null
  restore: (value: T) => void
}

/**
 * Restores one value after it becomes available, with optional open-edge and explicit resets
 */
export function useRestoreOnceWhenReady<T>({
  open,
  shouldRestore,
  readyValue,
  restore,
}: RestoreOnceWhenReadyOptions<T>): () => void {
  const [controller] = useState(() => createRestoreOnceController(shouldRestore, open))

  useEffect(() => {
    if (open !== undefined) controller.recordOpen(open, shouldRestore)
  }, [controller, open, shouldRestore])

  useEffect(() => {
    controller.consume(readyValue, restore)
  }, [controller, open, readyValue, restore])

  return useCallback(() => {
    controller.reset(shouldRestore)
  }, [controller, shouldRestore])
}
