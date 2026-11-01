import { useEffect, useId, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { useMobileFilterSheetEffects } from '@/components/filters/hooks/useMobileSheetEffects'
import { useModalScrollGuard } from '@/components/filters/hooks/useModalScrollGuard'
import { CLEAR_FILTERS_DISABLED_REASON } from '@/components/list-controls/filterReasons'
import { useDialogFocus } from '@/components/modal/focus'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { isModalCovered, registerOpenModal, subscribeToModalStack, unregisterOpenModal } from '@/components/modal/stack'

type MobileFilterSheetProps = {
  isOpen: boolean
  onClose: () => void
  // Fires once the close animation finishes so the parent can unmount and release the scroll lock
  onExitComplete: () => void
  // Accessible name for the modal dialog, naming the domain being filtered
  ariaLabel: string
  activeFacetCount: number
  clearAll: () => void
  applyFilters: () => void

  // Wording for a sheet that holds one filter. Other sheets keep the plural
  title?: string
  applyLabel?: string

  // Greys out Apply, with this as its reason, while the body holds an entry the draft will refuse, so
  // the button never looks live for a commit that cannot happen
  applyDisabledReason?: string

  // Why Clear all is greyed out, for a sheet that holds one filter. Other sheets keep the plural
  clearDisabledReason?: string

  // A line in the body above the footer that the Clear all reason hangs clear of
  clearReasonKeepClearOf?: RefObject<HTMLElement | null>

  // Gives the two footer buttons half of the footer's width each, as a phone modal's footer does, for a sheet
  // that holds one filter. Other sheets keep buttons that fit their labels
  equalFooterButtons?: boolean

  // Opens above a dialog that opened it, such as the picker for linking a transaction, since a dialog reached from
  // another sits above the sheet's own level
  aboveDialog?: boolean
  children: (headingId: string) => ReactNode
}

/**
 * Renders the full-screen mobile filter sheet shared by the account and transaction toolbars: the
 * header with the active-count summary, the scrollable body slot, and the clear and apply footer.
 * The facet body is supplied as children so this component owns only the chrome. Full screen keeps
 * the body in a fixed scroll area, so resizing a facet's content never animates the container and
 * the layout stays stable
 */
export function MobileFilterSheet({
  isOpen,
  onClose,
  onExitComplete,
  ariaLabel,
  activeFacetCount,
  clearAll,
  applyFilters,
  title = 'Filters',
  applyLabel = 'Apply filters',
  applyDisabledReason,
  clearDisabledReason = CLEAR_FILTERS_DISABLED_REASON,
  clearReasonKeepClearOf,
  equalFooterButtons = false,
  aboveDialog = false,
  children,
}: MobileFilterSheetProps) {
  const panelRef = useMobileFilterSheetEffects({ isOpen, onClose, lockScroll: false })
  const token = useId()
  const headingId = useId()
  const shouldReduceMotion = useReducedMotion()
  const covered = useSyncExternalStore(subscribeToModalStack, () => isModalCovered(token))

  useEffect(() => {
    if (!isOpen) return

    registerOpenModal(token, { blurPage: false })
    return () => unregisterOpenModal(token)
  }, [isOpen, token])

  useDialogFocus(isOpen, panelRef, token, onClose)

  // Hold the page still behind the full-screen sheet without overflow: hidden, which would strip the
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
          tabIndex={-1}
          inert={covered}
          className={`fixed inset-x-0 top-0 ${aboveDialog ? 'z-stacked-modal' : 'z-sheet'} flex flex-col min-[750px]:hidden`}
          style={{
            // 100dvh tracks the dynamic viewport so the sheet covers the screen even as the mobile
            // browser chrome shows or hides, leaving no strip of the list peeking below it
            height: '100dvh',
            // Solid rather than translucent, so nothing behind shows through and nothing behind has
            // to be blurred. A backdrop-filter here would be recomputed for every frame of a scroll
            background: 'var(--app-input-bg)',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
          initial={panelInitial}
          animate={panelAnimate}
          exit={panelExit}
          transition={{ duration: shouldReduceMotion ? 0.01 : 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="flex items-center justify-between border-b px-5 py-4"
            style={{ borderColor: 'var(--app-border)' }}
          >
            <div>
              <h2 id={headingId} className="text-base font-semibold">
                {title}
              </h2>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {activeFacetCount === 0 ? `No active ${title.toLowerCase()}` : `${activeFacetCount} active`}
              </p>
            </div>
            <button
              type="button"
              className="app-secondary-button h-10 w-10 rounded-full px-0"
              onClick={onClose}
              aria-label={`Close ${title.toLowerCase()}`}
            >
              <X size={18} aria-hidden />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-gutter:stable]">
            {children(headingId)}
          </div>

          <div
            className={`${equalFooterButtons ? 'grid grid-cols-2' : 'flex items-center justify-between'} gap-3 border-t px-5 py-4`}
            style={{ borderColor: 'var(--app-border)' }}
          >
            <DisabledReasonButton
              className={`app-secondary-button${equalFooterButtons ? ' w-full' : ''}`}
              disabledReason={activeFacetCount === 0 ? clearDisabledReason : undefined}
              keepReasonClearOf={clearReasonKeepClearOf}
              onClick={clearAll}
            >
              Clear all
            </DisabledReasonButton>
            <DisabledReasonButton
              className={`app-glass-button-primary${equalFooterButtons ? ' w-full' : ''}`}
              disabledReason={applyDisabledReason}
              onClick={applyFilters}
            >
              {applyLabel}
            </DisabledReasonButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
