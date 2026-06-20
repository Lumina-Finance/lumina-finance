import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import { useMobileFilterSheetEffects } from '@/components/filters/hooks/useMobileSheetEffects'
import { FilterPanelBody } from '@/pages/transactions/components/toolbar/FilterPanelBody'
import { FILTER_GLASS_SPRING, useTransactionFilterDraft } from '@/pages/transactions/components/toolbar/useTransactionFilterDraft'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'
import type { TransactionFilterSetter } from '@/pages/transactions/components/toolbar/types'

type MobileFilterPanelProps = {
  isOpen: boolean
  onClose: () => void
  // Fires once the close animation finishes so the parent can unmount and release the scroll lock
  onExitComplete: () => void
  accountOptions: OptionItem[]
  categoryOptions: OptionItem[]
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
}

/**
 * Renders the mobile transaction filter as a bottom sheet, reusing the same draft and body as the
 * desktop pill so both surfaces offer the identical facets and behaviour
 */
export function MobileFilterPanel({
  isOpen,
  onClose,
  onExitComplete,
  accountOptions,
  categoryOptions,
  filters,
  setFilter,
}: MobileFilterPanelProps) {
  const panelRef = useMobileFilterSheetEffects({ isOpen, onClose, dimPageContent: false })
  const shouldReduceMotion = useReducedMotion()
  const draft = useTransactionFilterDraft({ filters, setFilter, accountOptions, categoryOptions, onClose })
  const { activeFacetCount, seedDraftFromFilters } = draft
  const [contentHeight, setContentHeight] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const bodyTransition = shouldReduceMotion ? { duration: 0 } : FILTER_GLASS_SPRING

  // Seed the draft only on the rising edge of opening, so an async data load or a re-render never
  // wipes the edits the user is making in the open sheet
  const wasOpen = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpen.current) seedDraftFromFilters()
    wasOpen.current = isOpen
  }, [isOpen, seedDraftFromFilters])

  // Animate the sheet body to its content height as the property changes, the same way the desktop
  // panel does, so switching facets or toggling selections grows the sheet smoothly instead of
  // snapping
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => setContentHeight(content.offsetHeight))
    observer.observe(content)
    setContentHeight(content.offsetHeight)
    return () => observer.disconnect()
  }, [])

  const sheetInitial = shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 30 }
  const sheetAnimate = shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
  const sheetExit = shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {isOpen && (
        <div className="fixed inset-x-0 -top-[env(safe-area-inset-top)] bottom-0 z-[100] min-[750px]:hidden" onClick={onClose}>
          <motion.div
            className="absolute inset-0 h-full w-full cursor-default"
            style={{ background: 'color-mix(in srgb, var(--app-bg) 35%, transparent)' }}
            aria-hidden
            onPointerDown={onClose}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Transaction filters"
            className="absolute inset-x-0 bottom-0 flex max-h-[86dvh] flex-col overflow-hidden rounded-t-2xl border-t"
            style={{
              background: 'color-mix(in srgb, var(--app-input-bg) 72%, transparent)',
              backdropFilter: 'blur(24px) saturate(160%)',
              WebkitBackdropFilter: 'blur(24px) saturate(160%)',
              borderColor: 'var(--app-border-strong)',
              boxShadow: '0 -18px 44px color-mix(in srgb, var(--app-text) 16%, transparent), inset 0 1px 0 color-mix(in srgb, white 32%, transparent)',
            }}
            initial={sheetInitial}
            animate={sheetAnimate}
            exit={sheetExit}
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
              <div>
                <h2 className="text-base font-semibold">Filters</h2>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {activeFacetCount === 0 ? 'No active filters' : `${activeFacetCount} active`}
                </p>
              </div>
              <button type="button" className="app-secondary-button h-10 w-10 rounded-full px-0" onClick={onClose} aria-label="Close filters">
                <X size={18} aria-hidden />
              </button>
            </div>

            <motion.div
              className="overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
              style={{ maxHeight: '66dvh' }}
              initial={false}
              animate={{ height: contentHeight }}
              transition={bodyTransition}
            >
              <div ref={contentRef} className="px-5 py-4">
                <FilterPanelBody draft={draft} />
              </div>
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
