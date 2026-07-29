import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { FILTER_GLASS_SPRING, FILTER_PANEL_BODY_TRANSITION, FILTER_PILL_HEAD_STYLE } from '@/components/list-controls/toolbarStyles'
import { isFloatingLayerOpen, isInsideFloatingLayer } from '@/utils/floatingLayer'

// Collapsed footprint used before the head is measured, so the toolbar slot does not jump on mount
const COLLAPSED_FALLBACK = { width: 140, height: 34 }

// Chrome around the measured content span in the collapsed pill: horizontal padding, the gap to the
// chevron, the chevron itself, and the borders, plus a couple of pixels so sub-pixel rounding never
// clips the label. Added to the content width to size the pill
const COLLAPSED_HEAD_CHROME = 64

// The open panel fills to a consistent height with its option list growing to take the space, rather
// than hugging each facet. This caps that height
const OPEN_CONTENT_MAX = 440

// Kept clear below the open panel so it never runs to the bottom edge of the viewport on a short
// window, where the fill height shrinks to whatever space is left
const OPEN_CONTENT_VIEWPORT_MARGIN = 24

// Floor so a very short window still leaves the list usable rather than collapsing the panel
const OPEN_CONTENT_MIN = 220

type FilterGlassPanelProps = {
  // Accessible name for the collapsed pill button, naming the domain being filtered
  ariaLabel: string
  // Open width of the glass, sized by the caller to seat its own facet tabs without crowding
  openWidth: number
  open: boolean
  onOpenChange: (open: boolean) => void
  activeFacetCount: number
  seedDraftFromFilters: () => void
  clearAll: () => void
  children: ReactNode
}

/**
 * Renders the collapsing glass filter pill shared by the account and transaction desktop toolbars:
 * a pill that measures its own collapsed size, opens into an overlay anchored to its right edge so
 * it never shifts the toolbar height or the list below it, and caps its open height to the viewport.
 * The facet body is supplied as children so this component owns only the chrome
 */
export function FilterGlassPanel({
  ariaLabel,
  openWidth,
  open,
  onOpenChange,
  activeFacetCount,
  seedDraftFromFilters,
  clearAll,
  children,
}: FilterGlassPanelProps) {
  const [collapsedSize, setCollapsedSize] = useState(COLLAPSED_FALLBACK)
  const [openContentHeight, setOpenContentHeight] = useState(OPEN_CONTENT_MAX)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLButtonElement>(null)
  const headContentRef = useRef<HTMLSpanElement>(null)
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
  // collapsed head size to hold the toolbar slot. Remeasured while collapsed since the count badge
  // changes the head width
  useLayoutEffect(() => {
    const head = headRef.current
    const content = headContentRef.current
    if (open || !head || !content) return
    // Measure the content span rather than the head, which stretches to the glass width and would
    // otherwise feed its own width back into the next measurement
    setCollapsedSize({
      width: Math.ceil(content.scrollWidth) + COLLAPSED_HEAD_CHROME,
      height: Math.ceil(head.offsetHeight) + 2,
    })
  }, [open, activeFacetCount])

  // The open panel fills to a fixed height so the option list takes the available space instead of
  // the panel hugging each facet. The height is capped at the viewport less a bottom margin, so a
  // short window still leaves the panel clear of the bottom edge, and is remeasured on resize
  useLayoutEffect(() => {
    if (!open) return undefined

    function measureOpenHeight() {
      const head = headRef.current
      if (!head) return
      const available = window.innerHeight - head.getBoundingClientRect().bottom - OPEN_CONTENT_VIEWPORT_MARGIN
      setOpenContentHeight(Math.round(Math.max(OPEN_CONTENT_MIN, Math.min(OPEN_CONTENT_MAX, available))))
    }

    measureOpenHeight()
    window.addEventListener('resize', measureOpenHeight)
    return () => window.removeEventListener('resize', measureOpenHeight)
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

      if (event.key === 'Escape') dismiss()
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

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', marginLeft: 'auto', width: collapsedSize.width, height: collapsedSize.height }}
    >
      <motion.div
        className="app-range-glass"
        style={{ position: 'absolute', top: 0, right: 0, maxWidth: '90vw', zIndex: 50, marginLeft: 0 }}
        initial={false}
        animate={{ width: open ? openWidth : collapsedSize.width }}
        transition={transition}
        whileTap={open || shouldReduceMotion ? undefined : { scale: 0.94 }}
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
            <span>Filters</span>
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
            aria-label="Clear all filters"
            className="app-range-glass-clear absolute inline-flex items-center justify-center"
            style={{ top: 5, right: 8, height: 28, width: 28, zIndex: 2 }}
            onClick={(event) => {
              event.stopPropagation()
              clearAll()
            }}
          >
            <X size={16} aria-hidden />
          </button>
        )}

        <motion.div
          style={{ overflow: 'hidden' }}
          initial={false}
          animate={{ height: open ? openContentHeight : 0, opacity: open ? 1 : 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : FILTER_PANEL_BODY_TRANSITION}
        >
          <div className="flex flex-col" style={{ height: openContentHeight, padding: '0 12px 12px' }}>
            {children}
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
