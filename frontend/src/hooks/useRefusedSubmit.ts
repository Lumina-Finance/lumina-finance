import { useCallback, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { getFirstProblem, getShownProblems, type FieldProblems } from '@/utils/refusedSubmit'

const REVEAL_ROOM_ABOVE = '2rem'
const REVEAL_ROOM_BELOW = '1.5rem'

/**
 * Lets a dialog's action button look and work as clickable until a press finds something missing or
 * wrong, then marks every problem on its own field and holds the button off until each is fixed
 *
 * The form's validation stays the one source of `problems`, recomputed on every render from its state.
 * Pass the first return value's `errors` to the fields and `blockedReason` to the action button, which
 * stays focusable and explains itself in its tooltip. The submit handler starts with `guard()`
 *
 * A refused press focuses the first field with a problem and, only when it and its message are not
 * already fully in view, scrolls just far enough to show them, so a message on a row that sits off
 * screen, most of all on a phone, is never missed and a form that already shows the problem stays put
 *
 * @param problems - Every problem the form has right now, by field
 * @param order - The fields in the order the dialog draws them
 * @param controlIds - The id of the control that takes focus for each field
 */
export function useRefusedSubmit<F extends string>(
  problems: FieldProblems<F>,
  order: readonly F[],
  controlIds: Record<F, string>,
) {
  const shouldReduceMotion = useReducedMotion()
  const [refused, setRefused] = useState(false)
  const [touched, setTouched] = useState<ReadonlySet<F>>(new Set())
  const firstProblem = getFirstProblem(problems, order)

  // Everything is fixed, so the form is back to a fresh one: the button is whole again and a field cleared
  // later is only marked once it is left or the button is pressed again
  if (refused && !firstProblem) setRefused(false)

  const reset = useCallback(() => {
    setRefused(false)
    setTouched(new Set())
  }, [])

  const touch = useCallback((field: F) => {
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)))
  }, [])

  const markRefused = useCallback(() => setRefused(true), [])

  /** Returns whether the form may go ahead. When it may not, marks the problems and brings the first into view */
  function guard(): boolean {
    if (!firstProblem) return true

    setRefused(true)
    const controlId = controlIds[firstProblem.field]
    // Waits a frame so the messages the refusal shows are on the page before the body scrolls
    window.requestAnimationFrame(() => {
      const control = document.getElementById(controlId)
      if (!control) return
      control.focus({ preventScroll: true, focusVisible: true })
      // Room above for the label row that carries the message, and below so the field never rests on the footer's edge
      // A footer that sticks to the bottom of the scrolling body covers the last rows of its scroll view, so the room below
      // has to include its height or the field would count as in view while it sits under the footer
      const footer = control.closest('.app-modal-body')?.querySelector<HTMLElement>('.app-modal-footer')
      const footerHeight = footer && getComputedStyle(footer).position === 'sticky' ? footer.offsetHeight : 0
      control.style.scrollMarginBlock = `${REVEAL_ROOM_ABOVE} calc(${REVEAL_ROOM_BELOW} + ${footerHeight}px)`
      control.scrollIntoView({ behavior: shouldReduceMotion ? 'auto' : 'smooth', block: 'nearest' })
      control.style.scrollMarginBlock = ''
    })
    return false
  }

  return {
    errors: getShownProblems(problems, refused, touched),
    blockedReason: refused ? firstProblem?.message : undefined,
    guard,
    touch,
    reset,
    markRefused,
  }
}
