import { DROPDOWN_BOX_CHROME, DROPDOWN_MAX_HEIGHT } from '@/components/dropdown/position'

export const EMOJI_PICKER_GAP = 8
export const EMOJI_PICKER_PADDING = 12

// Seven 32px cells. The search row, the headings and the grid all span exactly this
export const EMOJI_PICKER_GRID_WIDTH = 224

// How much room below the button the panel wants before it opens downward instead
const EMOJI_PICKER_DOWNWARD_ROOM = 220
const EMOJI_PICKER_MIN_AVAILABLE_HEIGHT = 180

// The app's own curve over its default duration, for the height following the content and for the
// picker fading in over its loading state
export const EMOJI_PICKER_EASE_TRANSITION = { duration: 0.3, ease: [0.22, 1, 0.36, 1] } as const

export interface EmojiPickerViewport {
  height: number

  // The height of the layout viewport, which a fixed element is positioned against
  layoutHeight: number
  offsetLeft: number
  offsetTop: number
  width: number
}

export interface EmojiPickerPlacement {
  // Set when the panel opens upward, where it is pinned by its lower edge so it shrinks towards the button
  bottom: number | undefined
  left: number
  maxHeight: number
  openAbove: boolean
  top: number | undefined
  width: number
}

/**
 * Works out how wide the panel is
 *
 * The grid's own room is the seven cells, and the scrollbar's gutter is reserved on both sides of it
 * so the grid sits in the middle whether or not a scrollbar is drawn, so the panel is the grid plus
 * two gutters plus its own padding and border. Never wider than the screen leaves room for
 */
export function getEmojiPickerWidth(gutter: number, viewportWidth: number): number {
  const natural = EMOJI_PICKER_GRID_WIDTH + gutter * 2 + DROPDOWN_BOX_CHROME
  return Math.min(natural, viewportWidth - EMOJI_PICKER_PADDING * 2)
}

/**
 * Works out the panel's height from the height its contents want, up to the greatest it may take
 *
 * @param contentHeight - What the search row and the results need between them
 * @param maxHeight - The most the screen leaves it
 */
export function getEmojiPickerPanelHeight(contentHeight: number, maxHeight: number): number {
  return Math.max(0, Math.min(Math.ceil(contentHeight) + DROPDOWN_BOX_CHROME, maxHeight))
}

/**
 * Places the panel against its button or row, below it where there is room and above it otherwise
 */
export function getEmojiPickerPlacement({
  anchorRect,
  preferredLeft,
  viewport,
  width,
}: {
  anchorRect: { bottom: number; top: number }
  preferredLeft: number
  viewport: EmojiPickerViewport
  width: number
}): EmojiPickerPlacement {
  const viewportBottom = viewport.offsetTop + viewport.height
  const viewportRight = viewport.offsetLeft + viewport.width
  const spaceBelow = viewportBottom - anchorRect.bottom - EMOJI_PICKER_GAP - EMOJI_PICKER_PADDING
  const spaceAbove = anchorRect.top - viewport.offsetTop - EMOJI_PICKER_GAP - EMOJI_PICKER_PADDING
  const openAbove = spaceBelow < EMOJI_PICKER_DOWNWARD_ROOM && spaceAbove > spaceBelow
  const available = Math.max(EMOJI_PICKER_MIN_AVAILABLE_HEIGHT, openAbove ? spaceAbove : spaceBelow)
  const maxHeight = Math.min(DROPDOWN_MAX_HEIGHT, available, viewport.height - EMOJI_PICKER_PADDING * 2)
  const left = Math.min(
    Math.max(preferredLeft, viewport.offsetLeft + EMOJI_PICKER_PADDING),
    viewportRight - width - EMOJI_PICKER_PADDING,
  )

  if (openAbove) {
    // The lower edge stays a gap above the button however short the panel gets, and never lets the
    // greatest height leave the top of the screen
    const lowerEdge = Math.max(anchorRect.top - EMOJI_PICKER_GAP, viewport.offsetTop + EMOJI_PICKER_PADDING + maxHeight)
    return { bottom: viewport.layoutHeight - lowerEdge, left, maxHeight, openAbove, top: undefined, width }
  }

  const top = Math.min(anchorRect.bottom + EMOJI_PICKER_GAP, viewportBottom - maxHeight - EMOJI_PICKER_PADDING)
  return { bottom: undefined, left, maxHeight, openAbove, top, width }
}

let cachedScrollbarGutter: number | null = null

/**
 * Measures the room the browser reserves on each side of a thin scrolling box
 *
 * It is the scrollbar's own thickness, which is nothing where scrollbars float over the content and a
 * few pixels where they take room, and no stylesheet can read it. A box built the way the picker's
 * scrolling area is gives it away, so the panel is sized before the picker has drawn
 */
export function measureScrollbarGutter(): number {
  if (cachedScrollbarGutter !== null) return cachedScrollbarGutter

  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;width:100px;height:50px;overflow-y:scroll;scrollbar-width:thin;scrollbar-gutter:stable both-edges'
  document.body.appendChild(probe)
  const gutter = Math.max(0, (probe.offsetWidth - probe.clientWidth) / 2)
  probe.remove()
  cachedScrollbarGutter = gutter
  return gutter
}

/**
 * Reports the height the picker's contents want, now and each time it changes
 *
 * That is everything above the results plus the results themselves, which the restyle lets take their
 * own height. The picker draws after it is attached, so the results are looked for until they exist.
 * Returns the function that stops the watching
 */
export function observePickerContent(host: HTMLElement, report: (contentHeight: number) => void): () => void {
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null

  const attach = () => {
    const scroll = host.shadowRoot?.querySelector<HTMLElement>('.scroll')
    const results = scroll?.firstElementChild as HTMLElement | null | undefined
    if (!scroll || !results) return false

    const measure = () => report(scroll.offsetTop + results.offsetHeight)
    resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(results)
    measure()
    return true
  }

  if (!attach()) {
    mutationObserver = new MutationObserver(() => {
      if (!attach()) return
      mutationObserver?.disconnect()
      mutationObserver = null
    })
    mutationObserver.observe(host.shadowRoot ?? host, { childList: true, subtree: true })
  }

  return () => {
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
  }
}
