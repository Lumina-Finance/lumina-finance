import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { getFocusableElements, getNextTabStop, requestInitialModalFocus } from '@/components/modal/focus'
import { isModalCovered, isTopMostModal, registerOpenModal, subscribeToModalStack, unregisterOpenModal } from '@/components/modal/stack'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

const EASE = [0.25, 0.1, 0.25, 1] as const

// Slightly quicker than the panel's own entrance, so a height change that happens while the modal is open
// reads as the content settling rather than as the panel animating again
const LAYOUT_TRANSITION = { duration: 0.22, ease: EASE } as const

// A modal opened from the page and a modal opened from another modal. Both take their stacking level from
// the named scale in constants/stackingLevels.ts, where the stacked one sits above every page-level modal
// and above the full-screen filter sheet. It also settles a little faster, so the second modal never feels
// slower to arrive than the first
//
// Neither level filters its own backdrop. The frosting comes from blurring whatever the dialog covers, the
// page in app-behind-modal and the panel underneath in app-modal-panel-covered, both of which are inert and
// still while the modal is open. A filter laid over them instead has to run again for every frame in which
// anything above it moves, which took the GPU to saturation whenever a chart in a modal tracked the pointer
const LEVELS = {
  page: {
    className: 'z-modal',
    backdropDuration: 0.2,
    panelOffset: { opacity: 0, scale: 0.96, y: 12 },
    panelTransition: { duration: 0.25, ease: EASE },
  },
  stacked: {
    className: 'z-stacked-modal',
    backdropDuration: 0.15,
    panelOffset: { opacity: 0, scale: 0.94, y: 16 },
    panelTransition: { duration: 0.22, ease: EASE },
  },
} as const

export type ModalLevel = keyof typeof LEVELS

interface ModalShellProps {
  open: boolean
  onClose: () => void
  /** Id of the heading that titles the dialog, so a screen reader announces what opened */
  titleId: string
  /** Size and layout classes for the panel. Its background, border and shadow come from app-modal-panel */
  panelClassName: string
  /** Whether the modal was opened from the page or from another modal, which sets its stacking level, backdrop blur and timing */
  level?: ModalLevel
  /** Blocks Escape and backdrop dismissal while an action is in flight */
  closeDisabled?: boolean
  /** Runs once the exit animation has finished, for work that must wait until the modal is fully gone */
  onExitComplete?: () => void
  /** Animates the panel's height as its content grows, for a form that reveals whole rows as it is filled in */
  animateHeight?: boolean
  /** Keeps tooltips opened inside the panel within its edges, for one whose content would otherwise push them off */
  boundsTooltips?: boolean
  children: ReactNode
}

/**
 * Portal, backdrop, panel, scroll lock, dismissal and focus behaviour for every modal, so each one supplies
 * only its own contents. Focus moves into the panel on open, stays inside while it is open, and returns to
 * whatever opened it on close
 */
export function ModalShell({
  open,
  onClose,
  titleId,
  panelClassName,
  level = 'page',
  closeDisabled = false,
  onExitComplete,
  animateHeight = false,
  boundsTooltips = false,
  children,
}: ModalShellProps) {
  const token = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const appearance = LEVELS[level]

  useBodyScrollLock(open)

  const covered = useSyncExternalStore(subscribeToModalStack, () => isModalCovered(token))

  useEffect(() => {
    if (!open) return

    registerOpenModal(token)
    return () => unregisterOpenModal(token)
  }, [open, token])

  // Runs before the effect that moves focus into the panel, so the control that opened the modal is
  // captured while it still holds focus
  useEffect(() => {
    if (!open) return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    return () => {
      // Waits a frame rather than restoring straight away. Closing a stacked modal leaves the panel beneath
      // it inert until React renders the stack change, and focus cannot land inside an inert subtree
      window.requestAnimationFrame(() => {
        // A trigger the modal's own work removed from the page, such as a row it archived, has nothing to go
        // back to, so focus is left where it falls rather than sent somewhere arbitrary
        if (opener?.isConnected) opener.focus({ preventScroll: true })
      })
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    if (!panel) return

    const frameId = requestInitialModalFocus(panel)
    return () => window.cancelAnimationFrame(frameId)
  }, [open])

  useEffect(() => {
    if (!open || closeDisabled) return

    const closeOnEscape = (event: KeyboardEvent) => {
      // Only the top-most modal reacts, so one press never closes a modal stacked underneath as well
      if (event.key === 'Escape' && isTopMostModal(token)) onClose()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeDisabled, onClose, open, token])

  // Takes every Tab press while this is the top-most modal and moves focus to the next control in the panel
  // itself, rather than letting the browser move focus and only correcting at the edges. Deciding where the
  // edges are means matching the browser's tab order exactly, and any control it reaches that the panel's own
  // list misses would let focus straight out to the browser's toolbar
  useEffect(() => {
    if (!open) return

    const holdFocusInPanel = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      if (!isTopMostModal(token)) return

      const panel = panelRef.current
      if (!panel) return

      event.preventDefault()

      const focusable = getFocusableElements(panel)
      if (focusable.length === 0) {
        panel.focus({ preventScroll: true })
        return
      }

      // Focus that has ended up outside the panel, in an overlay the panel opened or on the page behind, is
      // pulled back to whichever end of the panel it was heading towards
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const from = active && panel.contains(active) ? active : null

      getNextTabStop(focusable, from, event.shiftKey)?.focus()
    }

    // Capture phase, so a control between the panel and the document cannot stop the event before this sees
    // it. Nothing in the app handles Tab itself, and anything added later that wants to would have to be let
    // through here rather than by stopping the event
    document.addEventListener('keydown', holdFocusInPanel, true)
    return () => document.removeEventListener('keydown', holdFocusInPanel, true)
  }, [open, token])

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <motion.div
          className={`app-modal-backdrop ${appearance.className}`}
          onClick={closeDisabled ? undefined : onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: appearance.backdropDuration }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            inert={covered}
            data-tooltip-bounds={boundsTooltips ? true : undefined}
            className={`app-modal-panel ${covered ? 'app-modal-panel-covered' : ''} ${panelClassName}`}
            onClick={(event) => event.stopPropagation()}
            layout={animateHeight}
            initial={appearance.panelOffset}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={appearance.panelOffset}
            transition={animateHeight ? { ...appearance.panelTransition, layout: LAYOUT_TRANSITION } : appearance.panelTransition}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
