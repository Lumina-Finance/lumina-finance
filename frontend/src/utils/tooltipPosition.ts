import { STACKING_LEVELS } from '@/constants/stackingLevels'

type CursorTooltipPositionStrategy = 'absolute' | 'fixed'

type CursorTooltipPositionOptions = {
  origin: HTMLElement
  tooltip: HTMLElement
  clientX: number
  clientY: number
  bounds?: HTMLElement | DOMRect

  // A box the tooltip must not cover, such as the control it explains when no cursor is over it. It then
  // hangs clear below the box or, with no room there, rises clear above it
  keepClear?: DOMRect

  // With a box to keep clear, rise above it while there is room, and hang below only otherwise
  preferAbove?: boolean
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

/**
 * Works out where a tooltip that follows the cursor should sit, held inside the card it belongs to
 * rather than inside the viewport
 *
 * Without an explicit bounds element the nearest enclosing card is used. Coordinates come back in the
 * space the chosen strategy needs, relative to the viewport when fixed and to the origin element when
 * absolute, together with the width the tooltip has to wrap within
 */
export function getCursorTooltipPosition({
  origin,
  tooltip,
  clientX,
  clientY,
  bounds,
  keepClear,
  preferAbove = false,
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
  // With a box to keep clear, the tooltip hangs from the box's bottom edge, or from its top edge when
  // there is no room below, in place of from the cursor
  const maxY = boundsRect.bottom - coordinateTop - margin
  const roomBelowBox =
    keepClear !== undefined && keepClear.bottom - coordinateTop + offset + tooltip.offsetHeight <= maxY
  const roomAboveBox = keepClear !== undefined && keepClear.top - coordinateTop - offset - tooltip.offsetHeight >= minY
  // A box that prefers its tooltip above gets it there while there is room, since what sits below a
  // control, such as the selector under a card's header on a phone, is more likely to be covered
  const hangsBelow = preferAbove && roomAboveBox ? false : roomBelowBox
  const pointerY = (keepClear ? (hangsBelow ? keepClear.bottom : keepClear.top) : clientY) - coordinateTop

  // The tooltip sits above the cursor unless it would clip the top bound, where it flips below. The
  // vertical follow and the flip offset are returned apart so the flip can animate while the tooltip
  // keeps tracking the cursor instantly
  const placeAbove = keepClear ? !hangsBelow : pointerY - tooltip.offsetHeight - offset >= minY
  const flipY = placeAbove ? -(tooltip.offsetHeight + offset) : offset

  return {
    // Hung from a box, the tooltip's right edge lines up with the box's, not the cursor offset left of it
    x: clamp(pointerX - tooltip.offsetWidth - (keepClear ? 0 : offset), minX, maxX),
    y: pointerY,
    flipY,
    maxWidth: Math.max(boundsRect.width - margin * 2, 1),
  }
}

/**
 * Positions a tooltip element against the cursor by writing the computed coordinates onto its style
 *
 * The two axes are written to custom properties the caller names, so a stylesheet decides how each one
 * animates, while the positioning strategy, stacking order, available width and flip offset are set
 * directly
 */
export function applyCursorTooltipPosition({
  tooltip,
  xProperty,
  yProperty,
  ...options
}: ApplyCursorTooltipPositionOptions) {
  const position = getCursorTooltipPosition({ tooltip, ...options })
  tooltip.style.position = options.strategy ?? DEFAULT_CURSOR_TOOLTIP_STRATEGY
  tooltip.style.zIndex = String(STACKING_LEVELS.tooltip)
  tooltip.style.setProperty('--app-cursor-tooltip-max-width', `${position.maxWidth}px`)
  tooltip.style.setProperty(xProperty, `${position.x}px`)
  tooltip.style.setProperty(yProperty, `${position.y}px`)
  tooltip.style.setProperty('--cursor-tooltip-flip-y', `${position.flipY}px`)
}
