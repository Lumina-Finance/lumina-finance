import { useLayoutEffect, type RefObject } from 'react'

/**
 * Hands focus back to the button that opens a panel when the panel closes with focus inside it
 *
 * A closed panel that stays mounted is made inert so its controls leave the Tab order, and inert drops
 * focus held inside it to the page. The browser moves that focus only at its next rendering update, so
 * it is still inside the panel when this runs
 */
export function useFocusHeadOnClose(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  headRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    if (!open && panelRef.current?.contains(document.activeElement)) headRef.current?.focus()
  }, [open, panelRef, headRef])
}
