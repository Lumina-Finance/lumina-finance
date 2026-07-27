import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { useMobileFilterSheetEffects } from '@/components/filters/hooks/useMobileSheetEffects'
import { useModalScrollGuard } from '@/components/filters/hooks/useModalScrollGuard'

type MobileFilterGlassPanelProps = {
  isOpen: boolean
  onClose: () => void
  // Fires once the close animation finishes so the parent can unmount and release the scroll lock
  onExitComplete: () => void
  // Accessible name for the modal dialog, naming the domain being filtered
  ariaLabel: string
  activeFacetCount: number
  seedDraftFromFilters: () => void
  clearAll: () => void
  applyFilters: () => void
  children: ReactNode
}

/**
 * Renders the full-screen mobile filter modal shared by the account and transaction toolbars: the
 * header with the active-count summary, the scrollable body slot, and the clear and apply footer.
 * The facet body is supplied as children so this component owns only the chrome. Full screen keeps
 * the body in a fixed scroll area, so resizing a facet's content never animates the container and
 * the layout stays stable
 */
export function MobileFilterGlassPanel({
  isOpen,
  onClose,
  onExitComplete,
  ariaLabel,
  activeFacetCount,
  seedDraftFromFilters,
  clearAll,
  applyFilters,
  children,
}: MobileFilterGlassPanelProps) {
  // The full-screen modal covers the page, so the page-content dim is left off to keep the glass
  // toolbar from breaking and because nothing behind the modal is visible anyway
  const panelRef = useMobileFilterSheetEffects({ isOpen, onClose, dimPageContent: false, lockScroll: false })
  const shouldReduceMotion = useReducedMotion()

  // Seed the draft only on the rising edge of opening, so an async data load or a re-render never
  // wipes the edits the user is making in the open modal
  const wasOpen = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpen.current) seedDraftFromFilters()
    wasOpen.current = isOpen
  }, [isOpen, seedDraftFromFilters])

  // Hold the page still behind the full-screen modal without overflow: hidden, which would strip the
  // sticky toolbar back to its in-flow position
  useModalScrollGuard(panelRef, isOpen)

  const panelInitial = shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }
  const panelAnimate = shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
  const panelExit = shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {isOpen && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          className="fixed inset-x-0 top-0 z-[100] flex flex-col min-[750px]:hidden"
          style={{
            // 100dvh tracks the dynamic viewport so the modal covers the screen even as the mobile
            // browser chrome shows or hides, leaving no strip of the list peeking below it
            height: '100dvh',
            background: 'color-mix(in srgb, var(--app-input-bg) 88%, transparent)',
            backdropFilter: 'blur(24px) saturate(160%)',
            WebkitBackdropFilter: 'blur(24px) saturate(160%)',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
          initial={panelInitial}
          animate={panelAnimate}
          exit={panelExit}
          transition={{ duration: shouldReduceMotion ? 0.01 : 0.28, ease: [0.22, 1, 0.36, 1] }}
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

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-gutter:stable]">
            {children}
          </div>

          <div className="flex items-center justify-between gap-3 border-t px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
            <button
              type="button"
              className="text-sm"
              style={{ color: 'var(--app-text-muted)' }}
              disabled={activeFacetCount === 0}
              onClick={clearAll}
            >
              Clear all
            </button>
            <button type="button" className="app-glass-button-primary" onClick={applyFilters}>
              Apply filters
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
