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

const LABEL_REACH = 24

/**
 * The box a disabled control's reason keeps clear of: the control and the label that names it, so a
 * reason rising above a field never lands on the field's own label
 */
export function getReasonKeepClear(control: HTMLElement): DOMRect {
  const box = control.getBoundingClientRect()
  // The first of the ids when several name the control
  const labelId = control.getAttribute('aria-labelledby')?.trim().split(/\s+/)[0]
  const label = (labelId ? control.ownerDocument.getElementById(labelId) : null) ?? (control as HTMLButtonElement).labels?.[0]
  if (!label) return box
  const labelBox = label.getBoundingClientRect()
  // Only a label that sits beside the control, not a heading far from it. A label wrapping a large block would widen the box, which no control does
  const gap = Math.max(labelBox.top - box.bottom, box.top - labelBox.bottom)
  if (gap > LABEL_REACH) return box
  const left = Math.min(box.left, labelBox.left)
  const top = Math.min(box.top, labelBox.top)
  const right = Math.max(box.right, labelBox.right)
  const bottom = Math.max(box.bottom, labelBox.bottom)
  return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top } as DOMRect
}

/**
 * The whole viewport, which holds a disabled control's reason in since the control belongs to no card
 */
export function getViewportBounds() {
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}
