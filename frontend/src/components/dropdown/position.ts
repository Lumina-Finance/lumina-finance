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

  /** How wide the box is once open, which is never less than `width` */
  openWidth: number

  top: number

  /** The width of the slot the box came from, which an open box grows out of and back into */
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
  openWidth: 0,
  top: 0,
  width: 0,
}

// The geometry of the box lives here rather than beside the look in tailwind.css, because placement
// is computed in JavaScript and a second copy in CSS would drift from this one
const DROPDOWN_MAX_HEIGHT = 400
const DROPDOWN_MIN_HEIGHT = 160

// How wide an open box is, wherever its slot is narrower than this. The room left between the box
// and the edge of the screen is taken off it, so a box opened near the edge gets less
const DROPDOWN_MAX_WIDTH = 320

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

  // The width of the slot it came from, which an open box grows up from rather than down to. The
  // head and the list are one box, so a box that opened narrower than its own slot would take the
  // head in with it
  const width = anchorRect.width

  // Only moves the box when the slot itself is partly off the screen, which is the one case where
  // leaving it where it is would put the list somewhere nobody can read it. Worked out from the
  // closed width rather than the grown one, so growing cannot slide the head sideways in front of
  // the user at the moment they opened it
  const left = Math.min(
    Math.max(anchorRect.left, viewport.offsetLeft + DROPDOWN_VIEWPORT_PADDING),
    Math.max(viewport.offsetLeft, viewportRight - width - DROPDOWN_VIEWPORT_PADDING),
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

    // The whole of the room the box has, up to the maximum, so a control in a narrow slot opens to
    // something a list can be read in. Floored at the closed width, which covers both a slot already
    // wider than the maximum and one hanging off the edge of the screen with no room to grow into:
    // either way the box opens exactly as wide as it sits
    openWidth: Math.max(
      width,
      Math.min(DROPDOWN_MAX_WIDTH, viewportRight - left - DROPDOWN_VIEWPORT_PADDING),
    ),

    // Pinned by the head's upper edge, so the head stays put and the list grows away below it
    top: anchorRect.top,
    width,
  }
}
