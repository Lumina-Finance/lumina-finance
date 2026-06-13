import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import type { AccountKind, AccountType } from '@/api/accounts'
import type { OptionItem } from '@/components/FilterOptionList'
import type { AccountFilterValues } from '@/accounts/types/accounts'
import { MobileFilterSection } from './MobileFilterSection'

type MobileFilterSheetProps = {
  isOpen: boolean
  activeFilterCount: number
  filters: AccountFilterValues
  setFilter: (patch: Partial<AccountFilterValues>) => void
  institutionOptions: OptionItem[]
  accountKindOptions: OptionItem[]
  accountTypeOptions: OptionItem[]
  selectedInstitutionLabel: string | null
  selectedKindLabel: string | null
  selectedTypeLabel: string | null
  onClose: () => void
  onExitComplete: () => void
}

/**
 * Renders the mobile filter sheet and owns its page-level modal effects
 */
export function MobileFilterSheet({
  isOpen,
  activeFilterCount,
  filters,
  setFilter,
  institutionOptions,
  accountKindOptions,
  accountTypeOptions,
  selectedInstitutionLabel,
  selectedKindLabel,
  selectedTypeLabel,
  onClose,
  onExitComplete,
}: MobileFilterSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => {
    if (!isOpen) return undefined

    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const panel = panelRef.current
      if (!panel || panel.contains(event.target as Node)) return
      onClose()
    }

    document.addEventListener('pointerdown', dismissOnOutsidePointer)

    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    const root = document.documentElement
    const blurTarget = document.getElementById('app-page-content')
    const mobileNavigationToggle = document.getElementById('app-mobile-navigation-toggle')
    const previousOverflow = document.body.style.overflow
    const previousRootOverflow = root.style.overflow
    const previousRootOverscroll = root.style.overscrollBehavior
    const previousBodyOverscroll = document.body.style.overscrollBehavior
    const previousBlurTargetFilter = blurTarget?.style.filter ?? ''
    const previousBlurTargetOpacity = blurTarget?.style.opacity ?? ''
    const previousBlurTargetTransition = blurTarget?.style.transition ?? ''
    const previousBlurTargetWillChange = blurTarget?.style.willChange ?? ''
    const previousMobileNavigationToggleOpacity = mobileNavigationToggle?.style.opacity ?? ''
    const previousMobileNavigationTogglePointerEvents = mobileNavigationToggle?.style.pointerEvents ?? ''
    const previousMobileNavigationToggleTransition = mobileNavigationToggle?.style.transition ?? ''
    const previousMobileNavigationToggleWillChange = mobileNavigationToggle?.style.willChange ?? ''

    root.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    if (blurTarget) {
      blurTarget.style.transition = 'filter 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)'
      blurTarget.style.willChange = 'filter, opacity'
    }
    if (mobileNavigationToggle) {
      mobileNavigationToggle.style.transition = 'opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)'
      mobileNavigationToggle.style.willChange = 'opacity'
    }

    return () => {
      root.style.overflow = previousRootOverflow
      root.style.overscrollBehavior = previousRootOverscroll
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousBodyOverscroll
      if (blurTarget) {
        blurTarget.style.filter = previousBlurTargetFilter
        blurTarget.style.opacity = previousBlurTargetOpacity
        blurTarget.style.transition = previousBlurTargetTransition
        blurTarget.style.willChange = previousBlurTargetWillChange
      }
      if (mobileNavigationToggle) {
        mobileNavigationToggle.style.opacity = previousMobileNavigationToggleOpacity
        mobileNavigationToggle.style.pointerEvents = previousMobileNavigationTogglePointerEvents
        mobileNavigationToggle.style.transition = previousMobileNavigationToggleTransition
        mobileNavigationToggle.style.willChange = previousMobileNavigationToggleWillChange
      }
    }
  }, [])

  useEffect(() => {
    const blurTarget = document.getElementById('app-page-content')
    const mobileNavigationToggle = document.getElementById('app-mobile-navigation-toggle')
    if (!blurTarget && !mobileNavigationToggle) return undefined

    const frame = window.requestAnimationFrame(() => {
      if (blurTarget) {
        blurTarget.style.filter = isOpen ? 'blur(7px)' : 'blur(0px)'
        blurTarget.style.opacity = isOpen ? '0.76' : '1'
      }
      if (mobileNavigationToggle) {
        mobileNavigationToggle.style.opacity = isOpen ? '0' : '1'
        mobileNavigationToggle.style.pointerEvents = isOpen ? 'none' : 'auto'
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isOpen])

  /**
   * Clears every filter before closing so the exit animation reflects the cleared state
   */
  function clearAllFilters() {
    setFilter({
      institution_id: undefined,
      account_kind: undefined,
      account_type: undefined,
    })
    onClose()
  }

  const sheetInitial = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 30 }
  const sheetAnimate = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0 }
  const sheetExit = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 24 }

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {isOpen && (
        <div
          className="fixed inset-x-0 -top-[env(safe-area-inset-top)] bottom-0 z-[100] min-[730px]:hidden"
          onClick={onClose}
        >
          <motion.div
            className="absolute inset-0 h-full w-full cursor-default"
            style={{
              background: 'color-mix(in srgb, var(--app-bg) 12%, transparent)',
            }}
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
            aria-label="Account filters"
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
                  {activeFilterCount === 0 ? 'No active filters' : `${activeFilterCount} active`}
                </p>
              </div>
              <button
                type="button"
                className="app-secondary-button h-10 w-10 px-0"
                onClick={onClose}
                aria-label="Close filters"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain py-5 pl-5 pr-6 [scrollbar-gutter:stable]">
              <MobileFilterSection
                title="Institution"
                options={institutionOptions}
                selectedValue={filters.institution_id}
                selectedLabel={selectedInstitutionLabel}
                searchPlaceholder="Search institutions..."
                allLabel="All institutions"
                onSelect={(value) => setFilter({ institution_id: value })}
                onClear={() => setFilter({ institution_id: undefined })}
                selectFirstSearchResultOnEnter
              />
              <MobileFilterSection
                title="Category"
                options={accountKindOptions}
                selectedValue={filters.account_kind}
                selectedLabel={selectedKindLabel}
                searchPlaceholder="Search categories..."
                allLabel="All categories"
                onSelect={(value) => setFilter({ account_kind: value as AccountKind })}
                onClear={() => setFilter({ account_kind: undefined })}
                selectFirstSearchResultOnEnter
              />
              <MobileFilterSection
                title="Type"
                options={accountTypeOptions}
                selectedValue={filters.account_type}
                selectedLabel={selectedTypeLabel}
                searchPlaceholder="Search types..."
                allLabel="All types"
                onSelect={(value) => setFilter({ account_type: value as AccountType })}
                onClear={() => setFilter({ account_type: undefined })}
                selectFirstSearchResultOnEnter
              />
            </div>

            <div className="grid grid-cols-2 gap-3 border-t px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
              <button type="button" className="app-secondary-button" onClick={clearAllFilters}>
                Clear
              </button>
              <button type="button" className="app-primary-button" onClick={onClose}>
                Done
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
