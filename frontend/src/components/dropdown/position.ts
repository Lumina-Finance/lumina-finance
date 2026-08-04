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
   * visible part, and the box's own lower edge has to be expressed against this one.
   */
  layoutHeight: number

  offsetLeft: number
  offsetTop: number
  width: number
}

export interface DropdownBoxPosition {
  /** Distance from the bottom of the layout viewport to the box's lower edge, applied when openAbove */
  bottom: number

  /** How tall the whole control may grow, head and list together */
  boxMaxHeight: number

  left: number

  /** What the list itself may take, once the head and any search field have had their share */
  listMaxHeight: number

  /**
   * Whether the list grows upward, above the head
   *
   * The head stays exactly where it sits closed either way. Growing down, the box is pinned by the
   * head's upper edge; growing up, by its lower edge, with the contents stacked in reverse so the
   * list appears above the head rather than pushing it.
   */
  openAbove: boolean

  top: number
  width: number
}

interface DropdownBoxPositionParams {
  anchorRect: DropdownAnchorRect

  /** Height of the collapsed head, which the list has to share the box with */
  headHeight: number

  searchable: boolean
  viewport: DropdownViewport
}

export const DEFAULT_DROPDOWN_BOX_POSITION: DropdownBoxPosition = {
  bottom: 0,
  boxMaxHeight: 208,
  left: 0,
  listMaxHeight: 208,
  openAbove: false,
  top: 0,
  width: 0,
}

// The geometry of the box lives here rather than beside the look in tailwind.css, because placement
// is computed in JavaScript and a second copy in CSS would drift from this one
const DROPDOWN_MAX_HEIGHT = 400
const DROPDOWN_MIN_HEIGHT = 160

// A pill in a narrow import table cell would otherwise open a list too narrow to read its options
const DROPDOWN_MIN_WIDTH = 208

const DROPDOWN_SEARCH_HEIGHT = 56

// The box's own border and the padding around its contents. Mirrors the 1px border of
// .app-dropdown-glass and the 6px padding of .app-dropdown-glass-inner in tailwind.css
const DROPDOWN_BOX_CHROME = 14

const DROPDOWN_VIEWPORT_PADDING = 12

/**
 * Places the whole control and works out how much of it the option list may take
 *
 * The control is one box holding the head and the list, so it is pinned by whichever of the head's
 * own edges the list grows away from, and it never leaves the visible viewport.
 */
export function getDropdownBoxPosition({
  anchorRect,
  headHeight,
  searchable,
  viewport,
}: DropdownBoxPositionParams): DropdownBoxPosition {
  const viewportBottom = viewport.offsetTop + viewport.height
  const viewportRight = viewport.offsetLeft + viewport.width
  const width = Math.max(anchorRect.width, DROPDOWN_MIN_WIDTH)

  // Clamped on the box's own width rather than the head's, so widening it over a narrow head pushes
  // it back inside the viewport instead of off the edge
  const left = Math.min(
    Math.max(anchorRect.left, viewport.offsetLeft + DROPDOWN_VIEWPORT_PADDING),
    viewportRight - width - DROPDOWN_VIEWPORT_PADDING,
  )

  // The box starts at the head and grows one way or the other, so the head's own height counts as
  // room the box already occupies on both sides
  const spaceBelow = viewportBottom - anchorRect.top - DROPDOWN_VIEWPORT_PADDING
  const spaceAbove = anchorRect.bottom - viewport.offsetTop - DROPDOWN_VIEWPORT_PADDING
  // The minimum decides only whether the room below is worth using. The box is never given more than
  // the room it actually has, or it would grow past the edge of the screen and clip its own list
  const openAbove = spaceBelow < DROPDOWN_MIN_HEIGHT && spaceAbove > spaceBelow
  const boxMaxHeight = Math.min(DROPDOWN_MAX_HEIGHT, openAbove ? spaceAbove : spaceBelow)

  return {
    // Pinned by the head's lower edge, so the head stays put and the list grows away above it
    bottom: viewport.layoutHeight - anchorRect.bottom,
    boxMaxHeight,

    left,

    // What is left once the head, any search field and the box's own border and padding are paid for
    listMaxHeight: Math.max(
      0,
      boxMaxHeight - headHeight - DROPDOWN_BOX_CHROME - (searchable ? DROPDOWN_SEARCH_HEIGHT : 0),
    ),

    openAbove,

    // Pinned by the head's upper edge, so the head stays put and the list grows away below it
    top: anchorRect.top,
    width,
  }
}
