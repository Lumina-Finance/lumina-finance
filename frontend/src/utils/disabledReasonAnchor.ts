import type { CursorTooltipPointer } from '@/hooks/useCursorTooltip'

/**
 * The point a disabled control's reason is placed against when no cursor is over the control, as when
 * the control is reached by keyboard or tapped
 *
 * The reason ends at the control's right edge. Whether it rises above the control or hangs below it is
 * the tooltip's own placement, which keeps clear of the control's box
 */
export function getReasonAnchor(control: Pick<DOMRect, 'right' | 'top'>): CursorTooltipPointer {
  return { clientX: control.right, clientY: control.top }
}

/**
 * The whole viewport, which holds a disabled control's reason in since the control belongs to no card
 */
export function getViewportBounds() {
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}
