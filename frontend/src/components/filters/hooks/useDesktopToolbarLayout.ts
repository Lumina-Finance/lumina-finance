import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

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
}

/**
 * Measures the desktop toolbar so the search field, filter group, and create button wrap before they collide
 */
export function useDesktopToolbarLayout(): DesktopToolbarLayoutState {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const filterGroupRef = useRef<HTMLDivElement>(null)
  const createMeasureRef = useRef<HTMLButtonElement>(null)
  const [desktopInlineLayout, setDesktopInlineLayout] = useState(false)
  const [desktopCreateStacked, setDesktopCreateStacked] = useState(false)

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
      if (!window.matchMedia('(min-width: 750px)').matches) {
        setDesktopInlineLayout(false)
        setDesktopCreateStacked(false)
        return
      }

      const toolbarWidth = toolbarElement.getBoundingClientRect().width
      if (toolbarWidth <= 0) return

      const filterItems = Array.from(filterGroupElement.children)
      const filterGap = parseFloat(getComputedStyle(filterGroupElement).columnGap) || 0
      const filterWidth = filterItems.reduce((total, item, index) => (
        total + (item as HTMLElement).getBoundingClientRect().width + (index === 0 ? 0 : filterGap)
      ), 0)
      const controlsGap = parseFloat(getComputedStyle(controlsElement).columnGap) || 0
      const createWidth = createMeasureElement.getBoundingClientRect().width
      const inlineFits = DESKTOP_SEARCH_MIN_WIDTH + controlsGap + filterWidth + controlsGap + createWidth <= toolbarWidth
      const shouldStack = !inlineFits && filterWidth + controlsGap + createWidth > toolbarWidth

      setDesktopInlineLayout((current) => (current === inlineFits ? current : inlineFits))
      setDesktopCreateStacked((current) => (current === shouldStack ? current : shouldStack))
    }

    updateCreateLayout()

    const resizeObserver = new ResizeObserver(updateCreateLayout)
    resizeObserver.observe(toolbarElement)
    resizeObserver.observe(controlsElement)
    resizeObserver.observe(filterGroupElement)
    resizeObserver.observe(createMeasureElement)
    window.addEventListener('resize', updateCreateLayout)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateCreateLayout)
    }
  }, [])

  return {
    toolbarRef,
    controlsRef,
    filterGroupRef,
    createMeasureRef,
    desktopInlineLayout,
    desktopCreateStacked,
  }
}
