import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import { FilterPanelBody } from '@/pages/transactions/components/toolbar/FilterPanelBody'
import { FILTER_GLASS_SPRING, useTransactionFilterDraft } from '@/pages/transactions/components/toolbar/useTransactionFilterDraft'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'
import type { TransactionFilterSetter } from '@/pages/transactions/components/toolbar/types'

// Open width of the glass, wide enough to seat the facet tabs without crowding. The glass is
// anchored to its collapsed right edge, so opening grows this width leftward over the toolbar
const OPEN_WIDTH = 468

// Collapsed footprint used before the head is measured, so the toolbar slot does not jump on mount
const COLLAPSED_FALLBACK = { width: 140, height: 34 }

// Chrome around the measured content span in the collapsed pill: horizontal padding, the gap to the
// chevron, the chevron itself, and the borders, plus a couple of pixels so sub-pixel rounding never
// clips the label. Added to the content width to size the pill
const COLLAPSED_HEAD_CHROME = 64

type TransactionFilterPanelProps = {
  accountOptions: OptionItem[]
  categoryOptions: OptionItem[]
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
}

/**
 * Renders the desktop transaction filter control, a collapsing glass pill whose panel opens as an
 * overlay anchored to the pill so it never shifts the toolbar height or the list below it
 */
export function TransactionFilterPanel({
  accountOptions,
  categoryOptions,
  filters,
  setFilter,
}: TransactionFilterPanelProps) {
  const [open, setOpen] = useState(false)
  const [collapsedSize, setCollapsedSize] = useState(COLLAPSED_FALLBACK)
  const [contentHeight, setContentHeight] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLButtonElement>(null)
  const headContentRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const transition = shouldReduceMotion ? { duration: 0 } : FILTER_GLASS_SPRING

  const draft = useTransactionFilterDraft({
    filters,
    setFilter,
    accountOptions,
    categoryOptions,
    onClose: () => setOpen(false),
  })
  const { activeFacetCount, seedDraftFromFilters } = draft

  /**
   * Seeds the draft from the applied filters, then opens the panel so reopening never shows stale
   * selections
   */
  function handleOpen() {
    seedDraftFromFilters()
    setOpen(true)
  }

  /**
   * Closes the panel and reverts the draft to the applied filters, so clicking away or pressing
   * Escape takes no action rather than leaving uncommitted selections showing on the pill
   */
  const dismiss = useCallback(() => {
    seedDraftFromFilters()
    setOpen(false)
  }, [seedDraftFromFilters])

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

  // The body height is animated as a real property rather than a layout transform, so the content
  // never scales and distorts. The observer keeps the target height in step with every content
  // change: switching facets, toggling selections, or filtering a list
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => setContentHeight(content.offsetHeight))
    observer.observe(content)
    setContentHeight(content.offsetHeight)
    return () => observer.disconnect()
  }, [])

  // An outside press or Escape dismisses the panel and discards the draft
  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        dismiss()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
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
        animate={{ width: open ? OPEN_WIDTH : collapsedSize.width }}
        transition={transition}
      >
        <button
          ref={headRef}
          type="button"
          className="app-range-glass-head"
          // Match the Add Transaction button: 40px outer height once the glass border is added
          style={{ height: 38, padding: '0 16px', gap: 8, fontSize: '0.9375rem' }}
          aria-expanded={open}
          aria-label="Transaction filters"
          onClick={() => (open ? setOpen(false) : handleOpen())}
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
              draft.clearAll()
            }}
          >
            <X size={16} aria-hidden />
          </button>
        )}

        <motion.div
          style={{ overflow: 'hidden' }}
          initial={false}
          animate={{ height: open ? contentHeight : 0, opacity: open ? 1 : 0 }}
          transition={transition}
        >
          <div ref={contentRef} style={{ padding: '0 12px 12px' }}>
            <FilterPanelBody draft={draft} />
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
