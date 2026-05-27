type CursorTooltipPositionOptions = {
  origin: HTMLElement
  tooltip: HTMLElement
  clientX: number
  clientY: number
  bounds?: HTMLElement | DOMRect
  offset?: number
  margin?: number
}

type ApplyCursorTooltipPositionOptions = CursorTooltipPositionOptions & {
  xProperty: string
  yProperty: string
}

const DEFAULT_CURSOR_TOOLTIP_OFFSET = 10
const DEFAULT_CURSOR_TOOLTIP_MARGIN = 8

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function getBoundsRect(bounds: HTMLElement | DOMRect | undefined, fallback: DOMRect) {
  if (!bounds) return fallback
  return 'getBoundingClientRect' in bounds ? bounds.getBoundingClientRect() : bounds
}

export function getCursorTooltipPosition({
  origin,
  tooltip,
  clientX,
  clientY,
  bounds,
  offset = DEFAULT_CURSOR_TOOLTIP_OFFSET,
  margin = DEFAULT_CURSOR_TOOLTIP_MARGIN,
}: CursorTooltipPositionOptions) {
  const originRect = origin.getBoundingClientRect()
  const boundsRect = getBoundsRect(bounds, originRect)
  const minX = boundsRect.left - originRect.left + margin
  const minY = boundsRect.top - originRect.top + margin
  const maxX = boundsRect.right - originRect.left - tooltip.offsetWidth - margin
  const maxY = boundsRect.bottom - originRect.top - tooltip.offsetHeight - margin
  const pointerX = clientX - originRect.left
  const pointerY = clientY - originRect.top
  const aboveY = pointerY - tooltip.offsetHeight - offset
  const belowY = pointerY + offset

  return {
    x: clamp(pointerX - tooltip.offsetWidth - offset, minX, maxX),
    y: clamp(aboveY >= minY ? aboveY : belowY, minY, maxY),
  }
}

export function applyCursorTooltipPosition({
  tooltip,
  xProperty,
  yProperty,
  ...options
}: ApplyCursorTooltipPositionOptions) {
  const position = getCursorTooltipPosition({ tooltip, ...options })
  tooltip.style.setProperty(xProperty, `${position.x}px`)
  tooltip.style.setProperty(yProperty, `${position.y}px`)
}
