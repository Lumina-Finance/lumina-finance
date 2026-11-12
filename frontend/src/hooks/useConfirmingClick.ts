import { useEffect, useState, type RefObject } from 'react'

/**
 * Whether a button that needs a second click is waiting for it. A press anywhere outside the
 * button ends that, as does the button locking while its action runs
 *
 * Returns the flag and its setter. The button's own click sets the flag
 */
export function useConfirmingClick(buttonRef: RefObject<HTMLElement | null>, locked: boolean) {
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming || locked) return
    const onPointer = (event: PointerEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setConfirming(false)
      }
    }

    // Defers listener registration so the click that arms confirmation does not immediately cancel it
    const timeoutId = window.setTimeout(() => window.addEventListener('pointerdown', onPointer), 0)
    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [buttonRef, confirming, locked])

  return [confirming, setConfirming] as const
}
