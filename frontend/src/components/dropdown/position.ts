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

  /**
   * Width a `position: fixed` element measures its own right edge against
   *
   * Narrower than the window wherever the scrollbar takes a gutter of its own, which this page
   * always reserves. The height has no matching case, since the page never scrolls sideways.
   */
  layoutWidth: number

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

  /**
   * Whether the box grows leftward, pinned by its right edge
   *
   * The mirror of `openAbove`, and for the same reason: the box is pinned by whichever of the
   * slot's own edges it grows away from, so that edge stays exactly where it sits closed.
   */
  openLeftward: boolean

  /** How wide the box is once open, which is never less than `width` */
  openWidth: number

  /** Distance from the right of the layout viewport to the box's right edge, applied when openLeftward */
  right: number

  top: number

  /** The width of the slot the box came from, which an open box grows out of and back into */
  width: number
}

/** Which way the box is growing, held for as long as one opening lasts */
export interface DropdownBoxDirection {
  openAbove: boolean
  openLeftward: boolean
}

interface DropdownBoxPositionParams {
  anchorRect: DropdownAnchorRect

  /** Height of the collapsed head, which the list has to share the box with */
  headHeight: number

  /**
   * The way an already open box is growing, or null when one is being opened
   *
   * The page keeps moving under an open box, and the room each way moves with it, so a box left to
   * choose freely would swap sides part way through being read. Whichever way it opened is kept
   * until it closes, and only how much room it has follows the page.
   */
  held: DropdownBoxDirection | null

  searchable: boolean
  viewport: DropdownViewport
}

export const DEFAULT_DROPDOWN_BOX_POSITION: DropdownBoxPosition = {
  bottom: 0,
  boxMaxHeight: 208,
  left: 0,
  listMaxHeight: 208,
  openAbove: false,
  openLeftward: false,
  openWidth: 0,
  right: 0,
  top: 0,
  width: 0,
}

// The geometry of the box lives here rather than beside the look in tailwind.css, because placement
// is computed in JavaScript and a second copy in CSS would drift from this one
const DROPDOWN_MAX_HEIGHT = 400

// How much room below the slot the box wants before it opens downward. More than its own greatest
// height, so a box that would only just fit underneath opens upward instead, where it has room to
// spare rather than ending against the bottom of the screen
const DROPDOWN_DOWNWARD_ROOM = 480

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
  held,
  searchable,
  viewport,
}: DropdownBoxPositionParams): DropdownBoxPosition {
  const viewportBottom = viewport.offsetTop + viewport.height
  const viewportRight = viewport.offsetLeft + viewport.width

  // The width of the slot it came from, which an open box grows up from rather than down to. The
  // head and the list are one box, so a box that opened narrower than its own slot would take the
  // head in with it
  const width = anchorRect.width
  const anchorRight = anchorRect.left + anchorRect.width

  // Each of the box's two side edges, placed on the matching edge of the slot and moved only when
  // the slot itself is partly off the screen, which is the one case where leaving it where it is
  // would put the list somewhere nobody can read it. Both worked out from the closed width rather
  // than the open one, so opening cannot slide the head sideways in front of the user
  const left = Math.min(
    Math.max(anchorRect.left, viewport.offsetLeft + DROPDOWN_VIEWPORT_PADDING),
    Math.max(viewport.offsetLeft, viewportRight - width - DROPDOWN_VIEWPORT_PADDING),
  )
  const rightEdge = Math.max(
    Math.min(anchorRight, viewportRight - DROPDOWN_VIEWPORT_PADDING),
    Math.min(viewportRight, viewport.offsetLeft + width + DROPDOWN_VIEWPORT_PADDING),
  )

  // The box starts at the slot and grows one way or the other, up or down and left or right, so the
  // slot's own size counts as room the box already occupies on all four sides. Measured from the
  // edge the box would be pinned by rather than from the slot, which are the same thing except for
  // a slot hanging off the screen, where the box has already been moved to sit inside it
  const spaceBelow = viewportBottom - anchorRect.top - DROPDOWN_VIEWPORT_PADDING
  const spaceAbove = anchorRect.bottom - viewport.offsetTop - DROPDOWN_VIEWPORT_PADDING
  const spaceRight = viewportRight - left - DROPDOWN_VIEWPORT_PADDING
  const spaceLeft = rightEdge - viewport.offsetLeft - DROPDOWN_VIEWPORT_PADDING

  // Downward and rightward wherever that side has the room, since a box that opens the same way
  // every time is easier to follow than one picking the roomier side by a few pixels. Otherwise the
  // roomier side wins, which is what gives a field low on a phone a list worth reading instead of
  // the sliver underneath it, and one near the right edge its full width
  const openAbove = held?.openAbove
    ?? (spaceBelow < DROPDOWN_DOWNWARD_ROOM && spaceAbove > spaceBelow)
  const openLeftward = held?.openLeftward
    ?? (spaceRight < DROPDOWN_MAX_WIDTH && spaceLeft > spaceRight)

  // The box is never given more than the room it actually has, or it would grow past the edge of
  // the screen and clip its own list
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
    openLeftward,

    // The whole of the room on whichever side the box is growing into, up to the maximum, so a
    // control in a narrow slot opens to something a list can be read in. Floored at the closed
    // width, which covers both a slot already wider than the maximum and one hanging off the edge
    // of the screen with no room at all: either way the box opens exactly as wide as it sits
    openWidth: Math.max(
      width,
      Math.min(DROPDOWN_MAX_WIDTH, openLeftward ? spaceLeft : spaceRight),
    ),

    // Pinned by the slot's right edge, so that edge stays put and the box grows away to the left of
    // it. Measured against the whole page, as `bottom` is, since that is what a fixed box's own
    // right edge is placed against
    right: viewport.layoutWidth - rightEdge,

    // Pinned by the head's upper edge, so the head stays put and the list grows away below it
    top: anchorRect.top,
    width,
  }
}
