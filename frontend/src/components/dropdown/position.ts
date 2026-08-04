export interface DropdownAnchorRect {
  bottom: number
  left: number
  top: number
  width: number
}

export interface DropdownViewport {
  /** Height of the part currently on screen, which shrinks when a phone raises its keyboard */
  height: number

  /**
   * Height a `position: fixed` element measures against, which the visible part sits inside
   *
   * The two differ on a zoomed or keyboard-raised phone. Available space is decided against the
   * visible part, and the panel's own lower edge has to be expressed against this one.
   */
  layoutHeight: number

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

// The panel's own border and padding, which its maximum height has to cover before the list gets
// any of it. Mirrors the 1px border and 6px inner padding of .app-dropdown-panel and
// .app-dropdown-panel-inner in tailwind.css, so the two move together
const DROPDOWN_PANEL_CHROME = 14

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

  // Measured from the bottom of the layout viewport, since that is what a fixed element's own
  // `bottom` is measured against, then held so the panel's upper edge cannot leave the visible part.
  // Without that hold a pill low on a short viewport pins a panel taller than the room above it, and
  // the rows above the top edge are clipped with no way to scroll to them
  const highestBottom = viewport.layoutHeight
    - maxHeight
    - viewport.offsetTop
    - DROPDOWN_VIEWPORT_PADDING

  return {
    bottom: Math.max(
      DROPDOWN_VIEWPORT_PADDING,
      Math.min(highestBottom, viewport.layoutHeight - anchorRect.top + DROPDOWN_GAP),
    ),
    left,
    // The panel's border and padding come out of its maximum height before the list is measured
    // against what is left, or the last option is clipped by the panel with no scroll position that
    // reaches it
    listMaxHeight: Math.max(
      96,
      maxHeight - DROPDOWN_PANEL_CHROME - (searchable ? DROPDOWN_SEARCH_HEIGHT : 0),
    ),
    menuMaxHeight: maxHeight,
    openAbove,
    top,
    width,
  }
}
