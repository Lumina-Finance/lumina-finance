import type { CursorTooltipPointer } from '@/hooks/useCursorTooltip'

/**
 * The point a disabled control's reason is placed against when no cursor is over the control, as when
 * the control is reached by keyboard or tapped
 *
 * The reason ends level with the control's right edge. It hangs below the control, or rises above it when there
 * is no room below, as the tooltip placement keeps clear of the control's box
 */
export function getReasonAnchor(control: Pick<DOMRect, 'right' | 'bottom'>): CursorTooltipPointer {
  return { clientX: control.right, clientY: control.bottom }
}

type Edges = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>

/**
 * Whether any part of a box is inside every box that clips it, so a control scrolled past the edge of its
 * surface is not in view even while it is inside the window
 */
export function isBoxInView(box: Edges, clips: Edges[]) {
  return clips.every(
    (clip) => box.left < clip.right && box.right > clip.left && box.top < clip.bottom && box.bottom > clip.top,
  )
}

/**
 * The boxes that cut a control off: the window and each scrolling or clipping surface around it
 */
export function getClippingBoxes(control: HTMLElement) {
  const boxes: Edges[] = [getViewportBounds()]
  for (let node = control.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node)
    if (overflowX !== 'visible' || overflowY !== 'visible') boxes.push(node.getBoundingClientRect())
  }
  return boxes
}

/**
 * The whole viewport, which holds a disabled control's reason in since the control belongs to no card
 */
export function getViewportBounds() {
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}
