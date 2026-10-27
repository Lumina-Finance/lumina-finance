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

/**
 * The whole viewport, which holds a disabled control's reason in since the control belongs to no card
 */
export function getViewportBounds() {
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}
