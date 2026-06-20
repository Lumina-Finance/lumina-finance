import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import { useMobileFilterSheetEffects } from '@/components/filters/hooks/useMobileSheetEffects'
import { FilterPanelBody } from '@/pages/transactions/components/toolbar/FilterPanelBody'
import { useTransactionFilterDraft } from '@/pages/transactions/components/toolbar/useTransactionFilterDraft'
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
  const panelRef = useMobileFilterSheetEffects({ isOpen, onClose })
  const shouldReduceMotion = useReducedMotion()
  const draft = useTransactionFilterDraft({ filters, setFilter, accountOptions, categoryOptions, onClose })
  const { activeFacetCount, seedDraftFromFilters } = draft

  // Seed the draft only on the rising edge of opening, so an async data load or a re-render never
  // wipes the edits the user is making in the open sheet
  const wasOpen = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpen.current) seedDraftFromFilters()
    wasOpen.current = isOpen
  }, [isOpen, seedDraftFromFilters])

  const sheetInitial = shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 30 }
  const sheetAnimate = shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
  const sheetExit = shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {isOpen && (
        <div className="fixed inset-x-0 -top-[env(safe-area-inset-top)] bottom-0 z-[100] min-[750px]:hidden" onClick={onClose}>
          <motion.div
            className="absolute inset-0 h-full w-full cursor-default"
            style={{ background: 'color-mix(in srgb, var(--app-bg) 12%, transparent)' }}
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
              background: 'var(--app-bg)',
              borderColor: 'var(--app-border)',
              boxShadow: '0 -18px 44px color-mix(in srgb, var(--app-text) 16%, transparent)',
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
              <button type="button" className="app-secondary-button h-10 w-10 px-0" onClick={onClose} aria-label="Close filters">
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-gutter:stable]">
              <FilterPanelBody draft={draft} />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
