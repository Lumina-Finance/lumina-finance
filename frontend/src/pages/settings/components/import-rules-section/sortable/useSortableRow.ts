import { useDndContext } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * How the rows slide aside while one is held, and how a dropped row settles, in the app's own duration and curve
 * rather than the library's 200 ms `ease`
 */
const SORT_TRANSITION = { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }

/**
 * A dropped row that lands closer than this to where it was let go has nothing to ease. A row's slot is read in whole
 * pixels, so a single pixel may be rounding
 */
const SETTLE_MIN_OFFSET_PX = 2

/**
 * Whether a drop has asked for a move that the rows don't show yet
 *
 * The list the rows sit in shows a moved rule a few frames after the drop, while the library lets go of the rows'
 * displacement in the drop's own frame. Until the order changes, the rows keep the look the drag left them in, so the
 * held row and the rows it passed don't drift back toward the slots they are leaving
 */
export const SortLandingContext = createContext(false)

type DrawnStyle = Pick<CSSProperties, 'transform' | 'transition'>

/** How far a row is drawn from its own slot right now, with a transition under way counted at its current point */
function readDrawnOffset(node: HTMLElement): number {
  const value = getComputedStyle(node).transform
  const flat = /^matrix\((.+)\)$/.exec(value)
  if (flat) return Number(flat[1].split(',')[5]) || 0
  const spatial = /^matrix3d\((.+)\)$/.exec(value)
  return spatial ? Number(spatial[1].split(',')[13]) || 0 : 0
}

/**
 * What a row needs to take part in a sortable list: its element's ref and moving style, the props of
 * the grip that picks it up, and whether it is being dragged
 *
 * @param id - The row's own id, the one its list was given
 * @param disabled - Holds the row still, for a list that is saving a move
 */
export function useSortableRow(id: string, disabled = false) {
  const shouldReduceMotion = useReducedMotion()
  const isLanding = useContext(SortLandingContext)
  const { activatorEvent } = useDndContext()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isSorting } =
    useSortable({
      id,
      disabled,
      // Under reduced motion the rows jump to their places
      transition: shouldReduceMotion ? null : SORT_TRANSITION,
    })
  const nodeRef = useRef<HTMLElement | null>(null)
  const heldRef = useRef<{ slot: number; drawn: number; byKeyboard: boolean } | null>(null)

  const rowRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node
      setNodeRef(node)
    },
    [setNodeRef],
  )

  const gripNodeRef = useRef<HTMLElement | null>(null)
  const gripRef = useCallback(
    (node: HTMLElement | null) => {
      gripNodeRef.current = node
      setActivatorNodeRef(node)
    },
    [setActivatorNodeRef],
  )

  const sortingStyle: DrawnStyle = {
    transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
  }
  // The look the last render of the drag drew, kept for the rows to wait in
  const [dragLook, setDragLook] = useState<DrawnStyle>({})
  if (isSorting && (dragLook.transform !== sortingStyle.transform || dragLook.transition !== sortingStyle.transition)) {
    setDragLook(sortingStyle)
  }
  const drawnStyle = isLanding && !isSorting ? dragLook : sortingStyle

  // The library puts a dropped row into its new slot in one step. A row let go with the mouse or a finger lands away
  // from the slot it is drawn in, so it is slid there from where it was let go. The slot and the distance are read
  // from layout, so neither the page's scroll nor a transition under way changes them. A row moved with the keyboard
  // travelled while it was held, and has nothing left to travel at the drop
  useLayoutEffect(() => {
    const node = nodeRef.current
    if (!node) return

    if (isDragging) {
      heldRef.current = {
        slot: node.offsetTop,
        drawn: readDrawnOffset(node),
        byKeyboard: activatorEvent instanceof KeyboardEvent,
      }
      return
    }

    const held = heldRef.current
    if (!held) return
    const grip = gripNodeRef.current
    if (isLanding) {
      // Moving the row's element in the list blurs the grip, and the library gives it focus back in the same
      // commit. Each time, the grip's ring fades out and back in. A row moved with the keyboard keeps the ring's
      // fade off from the drop until the order has landed, so the ring is drawn at full strength throughout. Only
      // this refocus skips the fade
      if (held.byKeyboard && grip) grip.style.transition = 'none'
      return
    }
    heldRef.current = null
    if (held.byKeyboard) {
      if (grip) {
        if (document.activeElement === document.body) grip.focus({ preventScroll: true })
        // Reading the style settles it with no transition, so letting the transition back in changes nothing drawn
        void getComputedStyle(grip).outlineColor
        grip.style.removeProperty('transition')
      }
      return
    }
    if (shouldReduceMotion) return
    const offset = held.slot + held.drawn - node.offsetTop
    if (Math.abs(offset) < SETTLE_MIN_OFFSET_PX) return
    node.animate(
      [{ transform: `translate3d(0, ${offset}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
      SORT_TRANSITION,
    )
  })

  const style: CSSProperties = {
    transform: drawnStyle.transform,
    transition: drawnStyle.transition,
    position: isDragging ? 'relative' : undefined,
    zIndex: isDragging ? 10 : undefined,
  }

  return {
    rowRef,
    rowStyle: style,
    gripRef,
    gripProps: disabled ? {} : { ...attributes, ...listeners },
    isDragging,
  }
}
