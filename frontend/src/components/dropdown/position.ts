export interface DropdownAnchorRect {
  bottom: number
  left: number
  top: number
  width: number
}

export interface DropdownViewport {
  height: number
  offsetLeft: number
  offsetTop: number
  width: number
}

export interface DropdownListPosition {
  /** Distance from the bottom of the viewport to the panel's lower edge, applied when openAbove */
  bottom: number
  left: number
  listMaxHeight: number
  menuMaxHeight: number

  /**
   * Whether the panel sits above the pill
   *
   * A panel opening above is pinned by its lower edge so it grows upward as its height animates,
   * which keeps it touching the pill at every point of the animation. One opening below is pinned
   * by its upper edge and grows downward
   */
  openAbove: boolean
  top: number
  width: number
}

interface DropdownListPositionParams {
  anchorRect: DropdownAnchorRect
  searchable: boolean
  viewport: DropdownViewport
}

export const DEFAULT_DROPDOWN_LIST_POSITION: DropdownListPosition = {
  bottom: 0,
  left: 0,
  listMaxHeight: 208,
  menuMaxHeight: 208,
  openAbove: false,
  top: 0,
  width: 0,
}

// The geometry of the panel lives here rather than beside the look in tailwind.css, because
// placement is computed in JavaScript and a second copy in CSS would drift from this one
const DROPDOWN_GAP = 6
const DROPDOWN_MAX_HEIGHT = 336
const DROPDOWN_MIN_HEIGHT = 160

// A pill in a narrow import table cell would otherwise open a panel too narrow to read its options
const DROPDOWN_MIN_WIDTH = 208

const DROPDOWN_SEARCH_HEIGHT = 56
const DROPDOWN_VIEWPORT_PADDING = 12

/**
 * Calculates the floating menu position while keeping it inside the visual viewport on desktop and mobile browsers
 */
export function getDropdownListPosition({
  anchorRect,
  searchable,
  viewport,
}: DropdownListPositionParams): DropdownListPosition {
  const viewportBottom = viewport.offsetTop + viewport.height
  const viewportRight = viewport.offsetLeft + viewport.width
  const width = Math.max(anchorRect.width, DROPDOWN_MIN_WIDTH)

  // Clamped on the panel's own width rather than the pill's, so widening a panel over a narrow pill
  // pushes it back inside the viewport instead of off the edge
  const left = Math.min(
    Math.max(anchorRect.left, viewport.offsetLeft + DROPDOWN_VIEWPORT_PADDING),
    viewportRight - width - DROPDOWN_VIEWPORT_PADDING,
  )
  const spaceBelow = viewportBottom - anchorRect.bottom - DROPDOWN_GAP - DROPDOWN_VIEWPORT_PADDING
  const spaceAbove = anchorRect.top - viewport.offsetTop - DROPDOWN_GAP - DROPDOWN_VIEWPORT_PADDING
  const openAbove = spaceBelow < DROPDOWN_MIN_HEIGHT && spaceAbove > spaceBelow
  const availableHeight = Math.max(
    DROPDOWN_MIN_HEIGHT,
    openAbove ? spaceAbove : spaceBelow,
  )
  const maxHeight = Math.min(DROPDOWN_MAX_HEIGHT, availableHeight)
  const top = openAbove
    ? Math.max(viewport.offsetTop + DROPDOWN_VIEWPORT_PADDING, anchorRect.top - maxHeight - DROPDOWN_GAP)
    : Math.min(anchorRect.bottom + DROPDOWN_GAP, viewportBottom - maxHeight - DROPDOWN_VIEWPORT_PADDING)

  return {
    bottom: Math.max(
      DROPDOWN_VIEWPORT_PADDING,
      viewportBottom - anchorRect.top + DROPDOWN_GAP,
    ),
    left,
    listMaxHeight: Math.max(96, maxHeight - (searchable ? DROPDOWN_SEARCH_HEIGHT : 0)),
    menuMaxHeight: maxHeight,
    openAbove,
    top,
    width,
  }
}
