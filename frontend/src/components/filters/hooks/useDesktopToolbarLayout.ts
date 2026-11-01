import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { MOBILE_NAVIGATION_QUERY, MOBILE_NAVIGATION_TOGGLE_CLEARANCE_PX } from '@/components/navigation/constants/data'

const DESKTOP_SEARCH_MIN_WIDTH = 320

export type DesktopToolbarRefs = {
  toolbarRef: RefObject<HTMLDivElement | null>
  controlsRef: RefObject<HTMLDivElement | null>
  filterGroupRef: RefObject<HTMLDivElement | null>
  createMeasureRef: RefObject<HTMLButtonElement | null>
}

export type DesktopToolbarLayoutState = DesktopToolbarRefs & {
  desktopInlineLayout: boolean
  desktopCreateStacked: boolean

  // Whether the filter group's first part, the bulk actions, sits above the rest instead of beside it.
  // Only ever true once the create button is stacked, and decided from the longest the row can be
  desktopActionsWrapped: boolean
}

/**
 * A control whose width changes with its current word, and the hidden twin that is as wide as its longest
 * word. The layout is decided as if the control always had that width, so which row anything sits on never
 * depends on the word on show, while the control itself stays as wide as its word and no wider
 */
export type LayoutWidthReserve = {
  // The control as drawn, whatever width it has now
  slotRef: RefObject<HTMLElement | null>
  // Its twin at the longest word. Not drawn, and not in the flow
  longestRef: RefObject<HTMLElement | null>
}

type DesktopToolbarWidths = {
  toolbarWidth: number

  // The filter group's items side by side on one row, and the gap between them already counted
  filterWidth: number
  controlsGap: number
  createWidth: number
  toggleClearance: number

  // The room the filter group has once the create button is stacked below it
  stackedGroupWidth: number

  // The part of the filter group that sits above the rest when it wraps, as wide as it is when it shows.
  // Zero while there is none
  actionsWidth: number
}

/**
 * Decides which row everything sits on from the widths it would take
 *
 * `inline` puts the search field, the filter group and the create button on one row. `stacked` puts the
 * create button on a row of its own, and `wrapped` then also puts the bulk actions above the rest of the
 * filter group, because the two together are wider than the room. A wrapped layout is only ever offered
 * once the create button is stacked
 */
export function getDesktopToolbarLayout(widths: DesktopToolbarWidths): {
  inline: boolean
  stacked: boolean
  wrapped: boolean
} {
  const { toolbarWidth, filterWidth, controlsGap, createWidth, toggleClearance } = widths
  const inline =
    DESKTOP_SEARCH_MIN_WIDTH + controlsGap + filterWidth + controlsGap + createWidth + toggleClearance <= toolbarWidth
  const stacked = !inline && filterWidth + controlsGap + createWidth > toolbarWidth
  const wrapped = stacked && widths.actionsWidth > 0 && filterWidth > widths.stackedGroupWidth
  return { inline, stacked, wrapped }
}

/**
 * A row's width as if the control in `slotWidth` were as wide as its longest word, `longestWidth`. The rest
 * of the row is whatever it measures now, so the answer is the same however far the control's own width
 * has eased. A control that is not there, or already longer than the twin, adds nothing
 */
export function getWidthAtLongest(rowWidth: number, slotWidth: number, longestWidth: number): number {
  return rowWidth + (slotWidth > 0 ? Math.max(0, longestWidth - slotWidth) : 0)
}

/**
 * The width of a part of the filter group once it has finished showing. A part marked `data-wrap-above`
 * grows in from nothing inside a clipping box, so its content is measured instead of the box
 */
function getPartWidth(part: Element): number {
  const content = part.hasAttribute('data-wrap-above') ? part.firstElementChild : part
  return (content ?? part).getBoundingClientRect().width
}

/**
 * The width a row takes when every one of its parts is as wide as it will be once shown, and they sit side
 * by side. An item marked `data-natural-row` is measured by its parts, so a row that wraps, or has a part
 * still growing in, is counted as the one row it would be
 */
function getNaturalRowWidth(element: Element): number {
  if (!element.hasAttribute('data-natural-row')) return element.getBoundingClientRect().width
  const gap = parseFloat(getComputedStyle(element).columnGap) || 0
  return Array.from(element.children).reduce(
    (total, part, index) => total + getPartWidth(part) + (index === 0 ? 0 : gap),
    0,
  )
}

/**
 * Measures the desktop toolbar so the search field, filter group, and create button wrap before they collide
 *
 * @param actionsKey Changes whenever the toolbar swaps its own controls, which re-measures. The observers
 *     watch boxes rather than contents, and a wrapped filter group is already stretched to the row, so a
 *     button appearing inside it changes nothing any of them would see
 * @param pauseMeasuring While true, skips re-measuring so a width animation running elsewhere in the
 *     actions row cannot flip the inline and stacked layouts mid-transition and flip them back once the
 *     animation is closer to done. Measures once, immediately, when it turns back to false
 * @param reserve A control that changes width with its word, counted at its longest word so the layout
 *     never changes with the word
 */
export function useDesktopToolbarLayout(
  actionsKey = '',
  pauseMeasuring = false,
  reserve?: LayoutWidthReserve,
): DesktopToolbarLayoutState {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const filterGroupRef = useRef<HTMLDivElement>(null)
  const createMeasureRef = useRef<HTMLButtonElement>(null)
  const [desktopInlineLayout, setDesktopInlineLayout] = useState(false)
  const [desktopCreateStacked, setDesktopCreateStacked] = useState(false)
  const [desktopActionsWrapped, setDesktopActionsWrapped] = useState(false)
  const slotRef = reserve?.slotRef
  const longestRef = reserve?.longestRef

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const controls = controlsRef.current
    const filterGroup = filterGroupRef.current
    const createMeasure = createMeasureRef.current
    if (!toolbar || !controls || !filterGroup || !createMeasure) return undefined
    const toolbarElement = toolbar
    const controlsElement = controls
    const filterGroupElement = filterGroup
    const createMeasureElement = createMeasure

    /**
     * Recomputes the inline and stacked layout against the rendered toolbar widths
     */
    function updateCreateLayout() {
      if (pauseMeasuring) return
      if (!window.matchMedia('(min-width: 750px)').matches) {
        setDesktopInlineLayout(false)
        setDesktopCreateStacked(false)
        setDesktopActionsWrapped(false)
        return
      }

      const toolbarWidth = toolbarElement.getBoundingClientRect().width
      if (toolbarWidth <= 0) return

      const filterItems = Array.from(filterGroupElement.children)
      const filterGap = parseFloat(getComputedStyle(filterGroupElement).columnGap) || 0
      const filterItemsWidth = filterItems.reduce(
        (total, item, index) => total + getNaturalRowWidth(item) + (index === 0 ? 0 : filterGap),
        0,
      )

      // The control that changes width with its word is counted as wide as its longest word
      const slotWidth = slotRef?.current?.getBoundingClientRect().width ?? 0
      const longestWidth = longestRef?.current?.getBoundingClientRect().width ?? 0
      const filterWidth = getWidthAtLongest(filterItemsWidth, slotWidth, longestWidth)

      const controlsGap = parseFloat(getComputedStyle(controlsElement).columnGap) || 0
      const createWidth = createMeasureElement.getBoundingClientRect().width

      // The bulk actions are the first part of the group's one item, which wraps above the rest
      const actionsPart = filterItems[0]?.querySelector(':scope > [data-wrap-above]')
      const actionsWidth = actionsPart ? getPartWidth(actionsPart) : 0

      // Wherever the mobile navigation toggle shows, one row has to fit beside the room it leaves the
      // toggle once docked, counted at rest as well so docking never switches the layout
      const toggleClearance = window.matchMedia(MOBILE_NAVIGATION_QUERY).matches
        ? MOBILE_NAVIGATION_TOGGLE_CLEARANCE_PX
        : 0
      const { inline, stacked, wrapped } = getDesktopToolbarLayout({
        toolbarWidth,
        filterWidth,
        controlsGap,
        createWidth,
        toggleClearance,
        stackedGroupWidth: controlsElement.clientWidth,
        actionsWidth,
      })

      setDesktopInlineLayout((current) => (current === inline ? current : inline))
      setDesktopCreateStacked((current) => (current === stacked ? current : stacked))
      setDesktopActionsWrapped((current) => (current === wrapped ? current : wrapped))
    }

    updateCreateLayout()

    const resizeObserver = new ResizeObserver(updateCreateLayout)
    resizeObserver.observe(toolbarElement)
    resizeObserver.observe(controlsElement)
    resizeObserver.observe(filterGroupElement)
    // The group's own items too, since a button easing to a new width inside an item that is not
    // stretched to the row changes nothing the group's box shows
    for (const item of Array.from(filterGroupElement.children)) resizeObserver.observe(item)
    resizeObserver.observe(createMeasureElement)
    if (slotRef?.current) resizeObserver.observe(slotRef.current)
    if (longestRef?.current) resizeObserver.observe(longestRef.current)
    window.addEventListener('resize', updateCreateLayout)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateCreateLayout)
    }
  }, [actionsKey, pauseMeasuring, slotRef, longestRef])

  return {
    toolbarRef,
    controlsRef,
    filterGroupRef,
    createMeasureRef,
    desktopInlineLayout,
    desktopCreateStacked,
    desktopActionsWrapped,
  }
}
