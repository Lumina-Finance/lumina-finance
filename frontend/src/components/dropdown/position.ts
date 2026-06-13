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
  left: number
  listMaxHeight: number
  menuMaxHeight: number
  top: number
  width: number
}

interface DropdownListPositionParams {
  anchorRect: DropdownAnchorRect
  searchable: boolean
  viewport: DropdownViewport
}

export const DEFAULT_DROPDOWN_LIST_POSITION: DropdownListPosition = {
  left: 0,
  listMaxHeight: 208,
  menuMaxHeight: 208,
  top: 0,
  width: 0,
}

const DROPDOWN_GAP = 6
const DROPDOWN_MAX_HEIGHT = 336
const DROPDOWN_MIN_HEIGHT = 160
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
  const left = Math.min(
    Math.max(anchorRect.left, viewport.offsetLeft + DROPDOWN_VIEWPORT_PADDING),
    viewportRight - anchorRect.width - DROPDOWN_VIEWPORT_PADDING,
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
    left,
    listMaxHeight: Math.max(96, maxHeight - (searchable ? DROPDOWN_SEARCH_HEIGHT : 0)),
    menuMaxHeight: maxHeight,
    top,
    width: anchorRect.width,
  }
}
