import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import {
  FILTER_GLASS_SPRING,
  FILTER_PANEL_BODY_TRANSITION,
  FILTER_PANEL_RETRACT_TRANSITION,
  FILTER_PILL_HEAD_STYLE,
} from '@/components/list-controls/toolbarStyles'
import {
  DEFAULT_FILTER_PANEL_PLACEMENT,
  FILTER_PANEL_MIN_HEIGHT,
  getFilterPanelHorizontalPlacement,
  getFilterPanelPlacement,
  type FilterPanelDirection,
  type FilterPanelHorizontalPlacement,
} from '@/components/list-controls/filterPanelPlacement'
import { useFocusHeadOnClose } from '@/hooks/useFocusHeadOnClose'
import { joinClassNames } from '@/utils/classNames'
import { isFloatingLayerOpen, isInsideFloatingLayer } from '@/utils/floatingLayer'

// Collapsed footprint used before the head is measured, so the toolbar slot does not jump on mount
const COLLAPSED_FALLBACK = { width: 140, height: 34 }

// Lifts the open panel over the controls beside it in the toolbar. It reaches no further than that
// row, which is sticky with a level of its own and so a stacking context, meaning this never competed
// with the navigation or a dialog even before the page content was isolated
const PANEL_Z_INDEX = 50

// The clear control would sit above the glass it is a child of with no level at all. Kept because it
// says the control belongs over the panel rather than among the rows inside it
const CLEAR_BUTTON_Z_INDEX = 2

// Chrome around the measured content span in the collapsed pill: horizontal padding, the gap to the
// chevron, the chevron itself, and the borders, plus a couple of pixels so sub-pixel rounding never
// clips the label. Added to the content width to size the pill
const COLLAPSED_HEAD_CHROME = 64

// Class on the body while a panel is open. The page's floating controls read it to step aside
const FILTER_PANEL_OPEN_CLASS = 'app-filter-panel-open'

// Inner spacing of the open panel body. The top edge only takes it when the panel opens upward,
// where the glass border sits directly above the content instead of the pill head
const BODY_PADDING = 12

type FilterGlassPanelProps = {
  // Accessible name for the collapsed pill button, naming the domain being filtered
  ariaLabel: string
  // Open width of the glass, sized by the caller to seat its own facet tabs without crowding
  openWidth: number

  // A container, such as a dialog's scrolling body, the open panel must stay inside. The panel then
  // takes the height that is left there and its option list scrolls, so its buttons stay on screen
  constrainTo?: RefObject<HTMLElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  activeFacetCount: number
  seedDraftFromFilters: () => void
  clearAll: () => void

  // Wording for a panel that holds one filter. Other panels keep the plural
  label?: string
  clearLabel?: string

  // A panel with only a short list in it ends where its content does, instead of holding the usual
  // opening height of the panels that seat several facet tabs
  fitContent?: boolean
  children: ReactNode
}

/**
 * Renders the collapsing glass filter pill shared by the account and transaction desktop toolbars:
 * a pill that measures its own collapsed size, opens into an overlay anchored to its right edge so
 * it never shifts the toolbar height or the list below it, and opens upward when the space below it
 * cannot hold the panel. The body is supplied as children so this component owns only the pill
 */
export function FilterGlassPanel({
  ariaLabel,
  openWidth,
  constrainTo,
  open,
  onOpenChange,
  activeFacetCount,
  seedDraftFromFilters,
  clearAll,
  label = 'Filters',
  clearLabel = 'Clear all filters',
  fitContent = false,
  children,
}: FilterGlassPanelProps) {
  const [collapsedSize, setCollapsedSize] = useState(COLLAPSED_FALLBACK)
  const [placement, setPlacement] = useState(DEFAULT_FILTER_PANEL_PLACEMENT)
  const [horizontalPlacement, setHorizontalPlacement] = useState<FilterPanelHorizontalPlacement>({
    direction: 'left',
    width: openWidth,
  })
  // The side the body is drawn on, which lags a measured change of direction until the body has
  // pulled back into the pill, so the anchoring never switches under content that is on screen
  const [renderedDirection, setRenderedDirection] = useState(DEFAULT_FILTER_PANEL_PLACEMENT.direction)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLButtonElement>(null)
  const headContentRef = useRef<HTMLSpanElement>(null)
  const bodyViewportRef = useRef<HTMLDivElement>(null)
  const bodyContentRef = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const transition = shouldReduceMotion ? { duration: 0 } : FILTER_GLASS_SPRING

  /**
   * Seeds the draft from the applied filters, then opens the panel so reopening never shows stale
   * selections
   */
  function handleOpen() {
    seedDraftFromFilters()
    onOpenChange(true)
  }

  /**
   * Closes the panel and reverts the draft to the applied filters, so clicking away or pressing
   * Escape takes no action rather than leaving uncommitted selections showing on the pill
   */
  const dismiss = useCallback(() => {
    seedDraftFromFilters()
    onOpenChange(false)
  }, [seedDraftFromFilters, onOpenChange])

  // The glass is taken out of flow so its bloom overlays the page, so the wrapper is pinned to the
  // collapsed head size to hold the toolbar slot. Remeasured while collapsed when the count badge
  // changes the head width, and when the desktop toolbar, hidden on a narrow page where the head
  // measures as nothing, shows once the window widens
  useLayoutEffect(() => {
    const head = headRef.current
    const content = headContentRef.current
    if (open || !head || !content) return undefined

    const measure = () => {
      // Measure the content span rather than the head, which stretches to the glass width and would
      // otherwise feed its own width back into the next measurement
      const next = {
        width: Math.ceil(content.scrollWidth) + COLLAPSED_HEAD_CHROME,
        height: Math.ceil(head.offsetHeight) + 2,
      }
      setCollapsedSize((current) => (current.width === next.width && current.height === next.height ? current : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [open, activeFacetCount])

  // Measure unconstrained content so adding chips grows the pane without feeding the animated
  // viewport height back into its desired size
  useLayoutEffect(() => {
    if (!open) return undefined

    // The body stays mounted while closed, but each new opening starts with the facet controls
    if (bodyViewportRef.current) bodyViewportRef.current.scrollTop = 0

    // Scoped to this open cycle so reopening picks a direction fresh, while a scroll partway
    // through keeps the direction the panel is already open in
    let openDirection: FilterPanelDirection | null = null

    function measurePlacement() {
      const head = headRef.current
      const wrapper = wrapperRef.current
      if (!head || !wrapper) return
      const rect = head.getBoundingClientRect()
      const next = getFilterPanelPlacement({
        anchorRect: { bottom: rect.bottom, top: rect.top },
        currentDirection: openDirection,
        viewportHeight: window.innerHeight,
        contentHeight: constrainTo ? undefined : bodyContentRef.current?.offsetHeight,
        minHeight: fitContent ? 0 : undefined,
        bounds: constrainTo?.current ? constrainTo.current.getBoundingClientRect() : undefined,
      })
      // The first measurement of an open cycle lands before the panel has painted, so opening on
      // the other side from last time is applied whole rather than played as a flip
      if (openDirection === null) setRenderedDirection(next.direction)
      openDirection = next.direction
      // Scrolling calls this on every frame, so an unchanged placement keeps the object it already
      // has rather than re-rendering the panel
      setPlacement((current) =>
        current.direction === next.direction && current.height === next.height ? current : next,
      )

      const anchor = wrapper.getBoundingClientRect()
      const navigation = document.querySelector<HTMLElement>('.app-desktop-nav')
      const navigationRight =
        navigation && getComputedStyle(navigation).display !== 'none' ? navigation.getBoundingClientRect().right : 0
      const horizontal = getFilterPanelHorizontalPlacement({
        anchorLeft: anchor.left,
        anchorRight: anchor.right,
        navigationRight,
        openWidth,
        viewportWidth: document.documentElement.clientWidth,
      })
      setHorizontalPlacement((current) =>
        current.direction === horizontal.direction && current.width === horizontal.width ? current : horizontal,
      )
    }

    measurePlacement()
    const observer = new ResizeObserver(measurePlacement)
    // Flipping upward changes padding without changing the content box
    if (bodyContentRef.current) observer.observe(bodyContentRef.current, { box: 'border-box' })

    // A container the panel stays inside can grow or shrink while the panel is open, such as a dialog
    // opening up to hold it
    if (constrainTo?.current) observer.observe(constrainTo.current)
    window.addEventListener('resize', measurePlacement)
    window.addEventListener('scroll', measurePlacement, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measurePlacement)
      window.removeEventListener('scroll', measurePlacement)
    }
  }, [open, openWidth, constrainTo, fitContent])

  useFocusHeadOnClose(open, bodyViewportRef, headRef)

  // Marks the page while the panel is open, so a control floating over the page, such as the insights
  // range selector, steps aside instead of showing through the translucent glass or covering it. A
  // control portalled to the body always stacks over the page content the glass belongs to
  useEffect(() => {
    if (!open) return undefined
    document.body.classList.add(FILTER_PANEL_OPEN_CLASS)
    return () => document.body.classList.remove(FILTER_PANEL_OPEN_CLASS)
  }, [open])

  // An outside press or Escape dismisses the panel and discards the draft
  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      // A popover this panel opened portals out of the wrapper, so a press on one lands outside the
      // wrapper node while still belonging to the panel
      if (isInsideFloatingLayer(event.target)) return

      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        dismiss()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      // The topmost layer answers Escape, and an open popover closes itself on it wherever focus
      // sits, so the panel only takes the key once nothing is layered over it
      if (isFloatingLayerOpen()) return

      // Escape closes this layer only. Stopping it here keeps a dialog the panel sits in, which listens on the
      // window, from closing with it, so the next press closes the dialog
      if (event.key === 'Escape') {
        event.stopPropagation()
        dismiss()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, dismiss])

  // The collapsed pill swaps the chevron for a clear control once filters are applied, so the user
  // can reset without opening the panel while the rest of the pill still opens it
  const showClearButton = activeFacetCount > 0 && !open
  // Opening upward pins the glass to the bottom of the collapsed footprint and reverses the stack,
  // so the head stays exactly where the pill was while the body grows over the page above it
  const openUpward = renderedDirection === 'up'
  // A measured change of direction retracts the body first, and the pill is the fixed point of both
  // sides, so the flip reads as the panel closing into it and reopening the other way
  const isRetracting = open && renderedDirection !== placement.direction

  /**
   * Switches the anchoring once the body has finished retracting, which is what turns the second
   * half of a flip into an ordinary open on the other side
   */
  function handleBodyAnimationComplete() {
    if (isRetracting) setRenderedDirection(placement.direction)
  }

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', marginLeft: 'auto', width: collapsedSize.width, height: collapsedSize.height }}
    >
      <motion.div
        className={joinClassNames('app-range-glass', openUpward && 'app-range-glass-up')}
        style={{
          position: 'absolute',
          top: openUpward ? undefined : 0,
          bottom: openUpward ? 0 : undefined,
          left: horizontalPlacement.direction === 'right' ? 0 : undefined,
          right: horizontalPlacement.direction === 'left' ? 0 : undefined,
          maxWidth: '90vw',
          zIndex: PANEL_Z_INDEX,
          marginLeft: 0,
        }}
        initial={false}
        animate={{ width: open ? horizontalPlacement.width : collapsedSize.width }}
        transition={transition}
        whileTap={open || shouldReduceMotion ? undefined : { scale: 0.94 }}
        // A press animation makes Motion put the frame in the Tab order unless it already has a
        // place there, and the button inside is the one stop the pill needs
        tabIndex={-1}
      >
        <button
          ref={headRef}
          type="button"
          className="app-range-glass-head"
          style={FILTER_PILL_HEAD_STYLE}
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => (open ? dismiss() : handleOpen())}
        >
          <span ref={headContentRef} className="app-range-glass-cur">
            <SlidersHorizontal size={18} aria-hidden className="shrink-0" />
            <span>{label}</span>
            {activeFacetCount > 0 && (
              <span
                className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium"
                style={{ background: 'var(--app-accent)', color: 'var(--app-button-primary-text)' }}
              >
                {activeFacetCount}
              </span>
            )}
          </span>
          {!showClearButton && (
            <motion.span
              className="app-range-glass-chev"
              style={{ display: 'inline-flex' }}
              animate={{ rotate: open ? 180 : 0 }}
              transition={transition}
            >
              <ChevronDown size={16} aria-hidden />
            </motion.span>
          )}
        </button>

        {showClearButton && (
          <button
            type="button"
            aria-label={clearLabel}
            className="app-range-glass-clear absolute inline-flex items-center justify-center"
            style={{ top: 5, right: 8, height: 28, width: 28, zIndex: CLEAR_BUTTON_Z_INDEX }}
            onClick={(event) => {
              event.stopPropagation()
              clearAll()
            }}
          >
            <X size={16} aria-hidden />
          </button>
        )}

        {/* Closed, the body is still mounted at no height, so it is kept out of focus and the
            accessibility tree until it opens again */}
        <motion.div
          style={{ overflow: 'hidden' }}
          inert={!open}
          initial={false}
          animate={{
            height: open && !isRetracting ? placement.height : 0,
            opacity: open && !isRetracting ? 1 : 0,
          }}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : isRetracting
                ? FILTER_PANEL_RETRACT_TRANSITION
                : FILTER_PANEL_BODY_TRANSITION
          }
          onAnimationComplete={handleBodyAnimationComplete}
        >
          {/* The whole body scrolls only once its natural height reaches the viewport limit */}
          <div ref={bodyViewportRef} className="overflow-y-auto" style={{ height: placement.height }}>
            <div
              ref={bodyContentRef}
              className="flex flex-col"
              style={{
                ...(constrainTo
                  ? { height: placement.height }
                  : { minHeight: fitContent ? undefined : FILTER_PANEL_MIN_HEIGHT }),
                padding: `${openUpward ? BODY_PADDING : 0}px ${BODY_PADDING}px ${BODY_PADDING}px`,
              }}
            >
              {children}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
