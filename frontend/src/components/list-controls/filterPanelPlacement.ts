export type FilterPanelDirection = 'down' | 'up'

export interface FilterPanelAnchorRect {
  // Viewport offset of the collapsed pill's bottom edge
  bottom: number
  // Viewport offset of the collapsed pill's top edge
  top: number
}

export interface FilterPanelPlacement {
  direction: FilterPanelDirection
  height: number
}

export interface FilterPanelHorizontalPlacement {
  direction: 'left' | 'right'
  width: number
}

interface FilterPanelPlacementParams {
  anchorRect: FilterPanelAnchorRect
  // Direction the panel is already open in, or null when it is being opened
  currentDirection: FilterPanelDirection | null
  viewportHeight: number
  contentHeight?: number
}

// Retains the usual opening height while letting selected chips expand the pane
export const FILTER_PANEL_MIN_HEIGHT = 440

// Kept clear beyond the open panel so it never runs to the top or bottom edge of the viewport
const VIEWPORT_MARGIN = 24
const NAVIGATION_GAP = 16

export const DEFAULT_FILTER_PANEL_PLACEMENT: FilterPanelPlacement = { direction: 'down', height: FILTER_PANEL_MIN_HEIGHT }

/** Keeps the expanded panel beside the navigation and inside the viewport. */
export function getFilterPanelHorizontalPlacement({
  anchorLeft,
  anchorRight,
  navigationRight,
  openWidth,
  viewportWidth,
}: {
  anchorLeft: number
  anchorRight: number
  navigationRight: number
  openWidth: number
  viewportWidth: number
}): FilterPanelHorizontalPlacement {
  const desiredWidth = Math.min(openWidth, viewportWidth * 0.9)
  const leftBoundary = Math.max(VIEWPORT_MARGIN, navigationRight + NAVIGATION_GAP)
  if (anchorRight - leftBoundary >= desiredWidth) {
    return { direction: 'left', width: desiredWidth }
  }

  return {
    direction: 'right',
    width: Math.max(0, Math.min(desiredWidth, viewportWidth - VIEWPORT_MARGIN - anchorLeft)),
  }
}

/**
 * Chooses which way the open filter panel grows and how tall it is: downward wherever the full
 * height fits below the pill, upward when only the space above it can hold it, and into whichever
 * side is roomier when neither can
 */
export function getFilterPanelPlacement({
  anchorRect,
  currentDirection,
  viewportHeight,
  contentHeight = FILTER_PANEL_MIN_HEIGHT,
}: FilterPanelPlacementParams): FilterPanelPlacement {
  const desiredHeight = Math.max(FILTER_PANEL_MIN_HEIGHT, Math.ceil(contentHeight))
  const spaceBelow = viewportHeight - anchorRect.bottom - VIEWPORT_MARGIN
  const spaceAbove = anchorRect.top - VIEWPORT_MARGIN
  const fitsBelow = spaceBelow >= desiredHeight
  const fitsAbove = spaceAbove >= desiredHeight

  // With no room either way the panel gives up its height rather than running off the window, so
  // the side with more of it wins
  if (!fitsBelow && !fitsAbove) {
    return spaceAbove > spaceBelow
      ? { direction: 'up', height: Math.max(0, Math.round(spaceAbove)) }
      : { direction: 'down', height: Math.max(0, Math.round(spaceBelow)) }
  }

  // The toolbar is sticky, so scrolling moves the pill under an open panel. Keeping the direction
  // it opened in for as long as that side still fits stops it flipping the moment the other side
  // becomes the roomier one
  if (currentDirection === 'up' && fitsAbove) return { direction: 'up', height: desiredHeight }
  if (currentDirection === 'down' && fitsBelow) return { direction: 'down', height: desiredHeight }

  return { direction: fitsBelow ? 'down' : 'up', height: desiredHeight }
}
