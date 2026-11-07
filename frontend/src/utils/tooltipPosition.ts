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

type IconTooltipOffsetOptions = {
  icon: Pick<DOMRect, 'left' | 'width'>
  tooltipWidth: number

  /** The surface marked `data-tooltip-bounds` around the icon, if any */
  surface?: Pick<DOMRect, 'left' | 'right'>

  /** The page content beside the sidebar, absent where the page has none */
  page?: Pick<DOMRect, 'left' | 'right'>
  screenWidth: number
}

// Room kept between an icon's tooltip and each edge it stays within
const ICON_TOOLTIP_MARGIN = 8

/**
 * How far an icon's tooltip, centred on the icon, shifts sideways to stay within the screen and the
 * surface around it, and clear of the sidebar by keeping within the page content
 *
 * The page's left edge (the sidebar's) gives way to the surface's right edge where the
 * tooltip can't keep to both. A dialogue sits over the page rather than in it, so a narrow column in one
 * can lie across the sidebar's edge, and a tooltip held right of that edge would leave the column and
 * be cut off by it
 */
export function getIconTooltipOffset({
  icon,
  tooltipWidth,
  surface,
  page,
  screenWidth,
}: IconTooltipOffsetOptions): number {
  const ownLeft = Math.max(ICON_TOOLTIP_MARGIN, (surface?.left ?? 0) + ICON_TOOLTIP_MARGIN)
  const ownRight = Math.min(screenWidth, surface?.right ?? screenWidth) - ICON_TOOLTIP_MARGIN
  const left = page ? Math.max(ownLeft, Math.min(page.left + ICON_TOOLTIP_MARGIN, ownRight - tooltipWidth)) : ownLeft
  const right = page ? Math.min(ownRight, page.right - ICON_TOOLTIP_MARGIN) : ownRight
  const tooltipLeft = icon.left + icon.width / 2 - tooltipWidth / 2
  const tooltipRight = tooltipLeft + tooltipWidth

  if (tooltipLeft < left) return left - tooltipLeft
  if (tooltipRight > right) return right - tooltipRight
  return 0
}

export type IconTooltipPlacement = 'top' | 'bottom'

type IconTooltipPlacementOptions = {
  preferred: IconTooltipPlacement
  icon: Pick<DOMRect, 'top' | 'bottom'>
  tooltipHeight: number

  /** What the icon explains, marked `data-tooltip-subject` around it, if anything */
  subject?: Pick<DOMRect, 'top' | 'bottom'>

  /** The surface marked `data-tooltip-bounds` around the icon, if any */
  surface?: Pick<DOMRect, 'top' | 'bottom'>

  /** Where the lowest bar the tooltip would be drawn under ends, from `getTooltipCoverBottom` */
  coverBottom: number
  screenHeight: number
}

/**
 * Which side of its icon a tooltip opens on, and how far it moves up or down from the icon's edge on
 * that side, to stay within the screen and the surface around the icon
 *
 * It keeps to the preferred side unless that clips and the other side doesn't. Given what the icon
 * explains, such as a fact whose value sits under its label, it opens beyond the whole of that instead,
 * and goes to the other side whenever the preferred one clips, even where the surface says that side
 * clips too. The surface can be one that cuts nothing off, such as a dialogue's side column once it is
 * stacked above the rest of the dialogue, where a tooltip kept on a side it doesn't fit runs off the
 * dialogue's edge instead
 */
export function getIconTooltipPlacement({
  preferred,
  icon,
  tooltipHeight,
  subject,
  surface,
  coverBottom,
  screenHeight,
}: IconTooltipPlacementOptions): { placement: IconTooltipPlacement; shift: number } {
  const anchor = subject ?? icon
  const top = Math.max(ICON_TOOLTIP_MARGIN, (surface?.top ?? 0) + ICON_TOOLTIP_MARGIN, coverBottom)
  const bottom = Math.min(screenHeight, surface?.bottom ?? screenHeight) - ICON_TOOLTIP_MARGIN
  const clips = { top: anchor.top - tooltipHeight < top, bottom: anchor.bottom + tooltipHeight > bottom }
  const other = preferred === 'top' ? 'bottom' : 'top'
  const flips = subject ? clips[preferred] : clips[preferred] && !clips[other]
  const placement = flips ? other : preferred

  return { placement, shift: placement === 'top' ? anchor.top - icon.top : anchor.bottom - icon.bottom }
}

/**
 * Where the lowest bar marked with `data-tooltip-cover` ends, among those starting above the trigger
 * and reaching across it, such as a sticky toolbar a list scrolls under, or 0 when there is none. A
 * panel opening upwards past it would be drawn under the bar
 *
 * A bar holding the trigger is its own surface rather than one over it, so it is left out. So is
 * every bar for a trigger in a dialogue, since the page behind the dialogue keeps its stuck bars in
 * place under the dialogue rather than over it
 */
export function getTooltipCoverBottom(trigger: HTMLElement, triggerRect: DOMRect): number {
  if (trigger.closest('[role="dialog"]')) return 0

  let coverBottom = 0
  for (const cover of document.querySelectorAll('[data-tooltip-cover]')) {
    if (cover.contains(trigger)) continue
    const rect = cover.getBoundingClientRect()
    const isAcross = rect.left < triggerRect.right && rect.right > triggerRect.left
    if (rect.top < triggerRect.top && isAcross) coverBottom = Math.max(coverBottom, rect.bottom)
  }
  return coverBottom
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
