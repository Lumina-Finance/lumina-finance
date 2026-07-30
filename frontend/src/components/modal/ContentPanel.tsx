import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { ModalShell, type ModalLevel } from '@/components/modal/Shell'

// Capped at the viewport so the body scrolls when the content runs tall, such as a long batch of recovery
// codes. The bottom padding clears the device safe area, since viewport-fit=cover lets content sit under
// the home indicator
const PANEL_CLASS_NAME = 'flex max-h-[86vh] w-full max-w-sm flex-col'
const BODY_CLASS_NAME = 'min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'

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
          neither is reachable, so the close button only shows at that width */}
      <button
        type="button"
        onClick={onClose}
        disabled={closeDisabled}
        aria-label="Close"
        className="app-icon-button absolute right-4 top-4 z-10 min-[1050px]:hidden"
      >
        <X size={18} aria-hidden />
      </button>

      <div className={BODY_CLASS_NAME}>{children}</div>
    </ModalShell>
  )
}
