import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { ModalShell, type ModalLevel } from '@/components/modal/Shell'

// Capped at the viewport so the body scrolls when the content runs tall, such as a long batch of recovery
// codes. The bottom padding clears the device safe area, since viewport-fit=cover lets content sit under
// the home indicator. Below 1050px the close button's row sits above the body, so the body starts closer
const PANEL_CLASS_NAME = 'flex max-h-[86vh] w-full max-w-sm flex-col'
const BODY_CLASS_NAME = 'app-modal-body min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] min-[1050px]:pt-6'

interface ModalContentPanelProps {
  open: boolean
  onClose: () => void
  /** Id given to the heading inside the content, which is what the dialog is labelled by */
  titleId: string
  level?: ModalLevel
  /** Blocks dismissal while an action is in flight */
  closeDisabled?: boolean
  /** Runs once the exit animation has finished, for work that must wait until the modal is fully gone */
  onExitComplete?: () => void
  children: ReactNode
}

/**
 * A modal holding arbitrary content rather than a form, scrolling its body and supplying nothing but the
 * close button
 */
export function ModalContentPanel({
  open,
  onClose,
  titleId,
  level = 'page',
  closeDisabled = false,
  onExitComplete,
  children,
}: ModalContentPanelProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId={titleId}
      panelClassName={`relative ${PANEL_CLASS_NAME}`}
      level={level}
      closeDisabled={closeDisabled}
      onExitComplete={onExitComplete}
    >
      {/* Backdrop tap and Escape close the modal on desktop, but it goes fullscreen below 1050px where
          neither is reachable, so the close button only shows at that width. It has a row of its own
          above the body, since the body would otherwise scroll under it */}
      <div className="flex shrink-0 justify-end px-4 pt-4 min-[1050px]:hidden">
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close"
          className="app-icon-button"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className={BODY_CLASS_NAME}>{children}</div>
    </ModalShell>
  )
}

/**
 * Holds a content dialog's final actions, which stay at the bottom of the panel while the body above
 * them scrolls. Place it last in the content
 */
export function ModalContentFooter({ children }: { children: ReactNode }) {
  return <div className="app-modal-footer">{children}</div>
}
