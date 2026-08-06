import { useLayoutEffect, useState, type RefObject } from 'react'

interface UseDropdownGrownWidthParams {
  /** The box itself, which is the element sized to its own contents while it is open */
  boxRef: RefObject<HTMLDivElement | null>

  /** True for as long as the box is floating, which outlasts `open` by the length of the collapse */
  placed: boolean
}

/**
 * Tracks the widest an open box has been, so what it holds can only ever widen it
 *
 * The box is sized to its contents, so filtering a list down to its shortest option would otherwise
 * take the whole panel in with it on every keystroke. Watched rather than measured once, since what
 * the box holds keeps changing after it opens: the search filters it, and a list that loads a page
 * at a time gets the rest of its options while it is already open.
 *
 * What is done with this width is settled in `getDropdownBoxWidths`, which gives it up when the
 * window no longer has room for it and again when the box closes.
 */
export function useDropdownGrownWidth({
  boxRef,
  placed,
}: UseDropdownGrownWidthParams): number {
  const [grownWidth, setGrownWidth] = useState(0)

  useLayoutEffect(() => {
    const box = boxRef.current

    // Back in its slot, where the box is as wide as the slot and has nothing to remember. Dropping
    // it here rather than when the list closes leaves the width to be let go of with the placement
    // it belongs to, at the end of the collapse
    if (!placed || !box) {
      setGrownWidth(0)
      return
    }

    // The offset width rather than the observer's own box, since this is applied back as a minimum
    // width, which is measured to the outside of the border while the observer reports the inside
    const measure = () => setGrownWidth((grown) => Math.max(grown, box.offsetWidth))

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [boxRef, placed])

  return grownWidth
}
