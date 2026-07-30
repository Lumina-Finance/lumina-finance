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

interface FilterPanelPlacementParams {
  anchorRect: FilterPanelAnchorRect
  // Direction the panel is already open in, or null when it is being opened
  currentDirection: FilterPanelDirection | null
  viewportHeight: number
}

// The open panel is one height on every window, with the option list taking whatever the open tab's
// own controls leave, rather than being sized to the space that happens to sit below the pill
const OPEN_HEIGHT = 440

// Kept clear beyond the open panel so it never runs to the top or bottom edge of the viewport
const VIEWPORT_MARGIN = 24

export const DEFAULT_FILTER_PANEL_PLACEMENT: FilterPanelPlacement = { direction: 'down', height: OPEN_HEIGHT }

/**
 * Chooses which way the open filter panel grows and how tall it is: downward wherever the full
 * height fits below the pill, upward when only the space above it can hold it, and into whichever
 * side is roomier when neither can
 */
export function getFilterPanelPlacement({
  anchorRect,
  currentDirection,
  viewportHeight,
}: FilterPanelPlacementParams): FilterPanelPlacement {
  const spaceBelow = viewportHeight - anchorRect.bottom - VIEWPORT_MARGIN
  const spaceAbove = anchorRect.top - VIEWPORT_MARGIN
  const fitsBelow = spaceBelow >= OPEN_HEIGHT
  const fitsAbove = spaceAbove >= OPEN_HEIGHT

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
  if (currentDirection === 'up' && fitsAbove) return { direction: 'up', height: OPEN_HEIGHT }
  if (currentDirection === 'down' && fitsBelow) return { direction: 'down', height: OPEN_HEIGHT }

  return { direction: fitsBelow ? 'down' : 'up', height: OPEN_HEIGHT }
}
