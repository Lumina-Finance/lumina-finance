import { useEffect, useId, useRef, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useAsideRoom } from '@/components/modal/asideRoom'
import { useDialogFocus } from '@/components/modal/focus'
import { isModalCovered, registerOpenModal, subscribeToModalStack, unregisterOpenModal } from '@/components/modal/stack'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

const EASE = [0.25, 0.1, 0.25, 1] as const

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
  /** Id of the text explaining what the dialog asks, read out with the title when it opens */
  descriptionId?: string
  /** Size and layout classes for the panel. Its background, border and shadow come from app-modal-panel */
  panelClassName: string
  /** Whether the modal was opened from the page or from another modal, which sets its stacking level and its entrance timing */
  level?: ModalLevel
  /** Blocks Escape and backdrop dismissal while an action is in flight */
  closeDisabled?: boolean
  /** Runs once the exit animation has finished, for work that must wait until the modal is fully gone */
  onExitComplete?: () => void
  /** Keeps tooltips opened inside the panel within its edges, for one whose content would otherwise push them off */
  boundsTooltips?: boolean
  /**
   * Shown beside the panel rather than inside it, as part of the same dialog
   *
   * The panel stays centred and this hangs off its right edge, 18rem wide. It is left out while
   * `useAsideRoom` says there is no room for it, so whatever it holds needs another place in the panel.
   * While shown it describes the dialog, so a screen reader reads it with the title. It is for reading
   * only: focus is kept inside the panel, so Tab never reaches a control placed here
   */
  aside?: ReactNode
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
  descriptionId,
  panelClassName,
  level = 'page',
  closeDisabled = false,
  onExitComplete,
  boundsTooltips = false,
  aside,
  children,
}: ModalShellProps) {
  const token = useId()
  const asideId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const appearance = LEVELS[level]

  useBodyScrollLock(open)

  const covered = useSyncExternalStore(subscribeToModalStack, () => isModalCovered(token))
  const asideHasRoom = useAsideRoom()

  useEffect(() => {
    if (!open) return

    registerOpenModal(token, { panel: panelRef.current })
    return () => unregisterOpenModal(token)
  }, [open, token])

  useDialogFocus(open, panelRef, token, onClose, closeDisabled)

  const dialogAttributes = {
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': titleId,
    tabIndex: -1,
    inert: covered,
    'data-tooltip-bounds': boundsTooltips ? true : undefined,
    className: `app-modal-panel ${covered ? 'app-modal-panel-covered' : ''} ${panelClassName}`,
    onClick: (event: MouseEvent) => event.stopPropagation(),
  } as const

  // No layout animation, and nothing else may put a settled transform or a filter on the panel either.
  // Motion animates a layout change by scaling the element, and a scaled or filtered box becomes what its
  // `position: fixed` descendants measure themselves from, which throws the open dropdown box hundreds of
  // pixels out of place and clips it to the panel for as long as the animation runs. The panel is sized
  // by its content, so it follows anything inside it that animates its own height, which is how a form
  // that reveals whole rows grows
  const entrance = {
    initial: appearance.panelOffset,
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: appearance.panelOffset,
    transition: appearance.panelTransition,
  }

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
          {aside ? (
            // The frame is the panel's size and carries its entrance, so the panel keeps its centred place
            // and the aside hangs off the frame's edge. It takes the panel's size classes but never their
            // clipping, which would cut the aside off. The dialog itself stays the panel, which is what
            // the full-screen rules for narrow viewports and the scroll lock look for
            <motion.div className={`app-modal-frame relative ${panelClassName} !overflow-visible`} {...entrance}>
              <div
                ref={panelRef}
                aria-describedby={
                  [descriptionId, asideHasRoom ? asideId : undefined].filter(Boolean).join(' ') || undefined
                }
                {...dialogAttributes}
              >
                {children}
              </div>
              {asideHasRoom && (
                <div
                  id={asideId}
                  inert={covered}
                  className={`absolute left-full top-0 ml-6 w-72 ${covered ? 'app-modal-panel-covered' : ''}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {aside}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div ref={panelRef} aria-describedby={descriptionId} {...dialogAttributes} {...entrance}>
              {children}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
