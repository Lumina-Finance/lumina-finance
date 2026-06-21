type CursorTooltipPositionStrategy = 'absolute' | 'fixed'

type CursorTooltipPositionOptions = {
  origin: HTMLElement
  tooltip: HTMLElement
  clientX: number
  clientY: number
  bounds?: HTMLElement | DOMRect
  offset?: number
  margin?: number
  strategy?: CursorTooltipPositionStrategy
}

type ApplyCursorTooltipPositionOptions = CursorTooltipPositionOptions & {
  xProperty: string
  yProperty: string
}

const DEFAULT_CURSOR_TOOLTIP_OFFSET = 10
const DEFAULT_CURSOR_TOOLTIP_MARGIN = 8
const DEFAULT_CURSOR_TOOLTIP_STRATEGY: CursorTooltipPositionStrategy = 'fixed'

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function getBoundsRect(bounds: HTMLElement | DOMRect | undefined, fallback: DOMRect) {
  if (!bounds) return fallback
  return 'getBoundingClientRect' in bounds ? bounds.getBoundingClientRect() : bounds
}

function getDefaultBoundsRect(origin: HTMLElement) {
  const surface = origin.closest('[data-tooltip-bounds], .app-card')
  return surface && 'getBoundingClientRect' in surface
    ? surface.getBoundingClientRect()
    : origin.getBoundingClientRect()
}

export function getCursorTooltipPosition({
  origin,
  tooltip,
  clientX,
  clientY,
  bounds,
  offset = DEFAULT_CURSOR_TOOLTIP_OFFSET,
  margin = DEFAULT_CURSOR_TOOLTIP_MARGIN,
  strategy = DEFAULT_CURSOR_TOOLTIP_STRATEGY,
}: CursorTooltipPositionOptions) {
  const originRect = origin.getBoundingClientRect()
  const boundsRect = getBoundsRect(bounds, getDefaultBoundsRect(origin))
  const coordinateLeft = strategy === 'fixed' ? 0 : originRect.left
  const coordinateTop = strategy === 'fixed' ? 0 : originRect.top
  const minX = boundsRect.left - coordinateLeft + margin
  const minY = boundsRect.top - coordinateTop + margin
  const maxX = boundsRect.right - coordinateLeft - tooltip.offsetWidth - margin
  const pointerX = clientX - coordinateLeft
  const pointerY = clientY - coordinateTop

  // The tooltip sits above the cursor unless it would clip the top bound, where it flips below. The
  // vertical follow and the flip offset are returned apart so the flip can animate while the tooltip
  // keeps tracking the cursor instantly
  const placeAbove = pointerY - tooltip.offsetHeight - offset >= minY
  const flipY = placeAbove ? -(tooltip.offsetHeight + offset) : offset

  return {
    x: clamp(pointerX - tooltip.offsetWidth - offset, minX, maxX),
    y: pointerY,
    flipY,
    maxWidth: Math.max(boundsRect.width - margin * 2, 1),
  }
}

export function applyCursorTooltipPosition({
  tooltip,
  xProperty,
  yProperty,
  ...options
}: ApplyCursorTooltipPositionOptions) {
  const position = getCursorTooltipPosition({ tooltip, ...options })
  tooltip.style.position = options.strategy ?? DEFAULT_CURSOR_TOOLTIP_STRATEGY
  tooltip.style.zIndex = '60'
  tooltip.style.setProperty('--app-cursor-tooltip-max-width', `${position.maxWidth}px`)
  tooltip.style.setProperty(xProperty, `${position.x}px`)
  tooltip.style.setProperty(yProperty, `${position.y}px`)
  tooltip.style.setProperty('--cursor-tooltip-flip-y', `${position.flipY}px`)
}
