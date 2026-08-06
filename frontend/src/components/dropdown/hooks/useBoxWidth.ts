import { useLayoutEffect, useState, type RefObject } from 'react'
import { useReducedMotion } from 'motion/react'

interface UseDropdownBoxWidthParams {
  /** The box itself, which is the element sized to its own contents while it is open */
  boxRef: RefObject<HTMLDivElement | null>

  /** False for the length of the collapse, which the box is still floating for */
  open: boolean

  /** True for as long as the box is floating, which outlasts `open` by the length of the collapse */
  placed: boolean
}

interface DropdownBoxWidthState {
  /** The widest the box has been since it opened, or 0 before it has been measured */
  grownWidth: number

  /**
   * Whether the box may be given the whole of its room yet
   *
   * True once it has been on screen for a frame, which is what the widening moves from, and true
   * from the start for a user who has asked for no motion, where there is nothing to move.
   */
  painted: boolean
}

/**
 * Follows the open box's width, so it can only ever widen and has somewhere to widen from
 *
 * The box is sized to its contents, so filtering a list down to its shortest option would otherwise
 * take the whole panel in with it on every keystroke. Watched rather than measured once, since what
 * the box holds keeps changing after it opens: the search filters it, and a list that loads a page
 * at a time gets the rest of its options while it is already open.
 *
 * What is done with either value is settled in `getDropdownBoxWidths`, which gives the grown width
 * up when the window no longer has room for it and again when the box closes.
 */
export function useDropdownBoxWidth({
  boxRef,
  open,
  placed,
}: UseDropdownBoxWidthParams): DropdownBoxWidthState {
  const shouldReduceMotion = useReducedMotion()
  const [grownWidth, setGrownWidth] = useState(0)
  const [painted, setPainted] = useState(false)

  useLayoutEffect(() => {
    const box = boxRef.current

    // Back in its slot, where the box is as wide as the slot and has nothing to remember. Dropping
    // it here rather than when the list closes leaves the width to be let go of with the placement
    // it belongs to, at the end of the collapse
    if (!placed || !box) {
      setGrownWidth(0)
      setPainted(false)
      return
    }

    // Closing keeps the width the box reached, which is what it narrows from, and stops following
    // a list that is on its way out
    if (!open) return

    // Waiting for a frame is what lets the box grow rather than appear grown. A ceiling raised in
    // the same frame the box is placed goes from having none at all to being a number, which
    // nothing can animate, so the box has to be seen at its slot's width once first
    const frame = requestAnimationFrame(() => setPainted(true))

    // Taken from where the box is rather than raised from what it last reached, so one reopened
    // part way through closing carries on from its current width instead of jumping back out to
    // the width it had before
    const start = () => setGrownWidth(box.offsetWidth)
    const measure = () => setGrownWidth((grown) => Math.max(grown, box.offsetWidth))

    // The offset width rather than the observer's own box, since this is applied back as a minimum
    // width, which is measured to the outside of the border while the observer reports the inside
    start()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [boxRef, open, placed])

  // Nothing to wait for when there is no animation to give the wait to, where holding the box at
  // its slot's width would only show it narrow for a frame on the way to the same place
  return { grownWidth, painted: painted || Boolean(shouldReduceMotion) }
}
