import type { ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { ModalRail } from '@/components/modal/Rail'
import { ModalShell, type ModalLevel } from '@/components/modal/Shell'

// Capped at the viewport so the body scrolls when the content runs tall, such as a long batch of recovery
// codes. The bottom padding clears the device safe area, since viewport-fit=cover lets content sit under
// the home indicator, and is set in app-modal-body so a footer can take it over
const PANEL_CLASS_NAME = 'flex max-h-[86vh] w-full max-w-sm flex-col'
const BODY_CLASS_NAME = 'app-modal-body min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 pt-6'

// With a rail the panel is widened by the rail's own width, so the content keeps the room it has without
// one. The rail clips to the panel's corners
const RAILED_PANEL_CLASS_NAME = 'flex max-h-[86vh] w-full overflow-hidden'
const RAILED_WIDTH_CLASS_NAME: Record<ModalLevel, string> = {
  page: 'max-w-md',
  stacked: 'max-w-[27rem]',
}

interface ModalContentPanelProps {
  open: boolean
  onClose: () => void
  /** Id given to the heading inside the content, which is what the dialog is labelled by */
  titleId: string
  level?: ModalLevel
  /** Icon and label for the rail along the panel's left edge. Left out together by a panel with no rail */
  RailIcon?: LucideIcon
  railLabel?: string
  /** Blocks dismissal while an action is in flight */
  closeDisabled?: boolean
  /** Set by a dialog whose content draws the form modals' header on a phone, which gives its close button
   *  their bare look in place of the floating frosted one */
  phoneHeader?: boolean
  /** Runs once the exit animation has finished, for work that must wait until the modal is fully gone */
  onExitComplete?: () => void
  children: ReactNode
}

/**
 * A modal holding arbitrary content rather than a form, scrolling its body and supplying nothing but the
 * close button and, when asked for, the labelled rail
 */
export function ModalContentPanel({
  open,
  onClose,
  titleId,
  level = 'page',
  RailIcon,
  railLabel,
  closeDisabled = false,
  phoneHeader = false,
  onExitComplete,
  children,
}: ModalContentPanelProps) {
  const hasRail = Boolean(RailIcon && railLabel)

  const content = (
    <>
      {/* Backdrop tap and Escape close the modal on desktop, but it goes fullscreen below 1050px where
          neither is reachable, so the close button only shows at that width. It floats over the body on
          the frosted glass of the phone menu button, so the content scrolling under it blurs. A dialog
          that draws the form modals' header on a phone takes their bare cross instead */}
      <button
        type="button"
        onClick={onClose}
        disabled={closeDisabled}
        aria-label="Close"
        className={
          phoneHeader
            ? 'app-icon-button absolute right-4 top-5 z-10 min-[1050px]:hidden'
            : 'app-glass-icon-button absolute right-4 top-4 z-10 h-8 w-8 min-[1050px]:hidden'
        }
      >
        <X size={phoneHeader ? 20 : 18} aria-hidden />
      </button>

      <div className={BODY_CLASS_NAME}>{children}</div>
    </>
  )

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId={titleId}
      panelClassName={
        hasRail
          ? `relative ${RAILED_PANEL_CLASS_NAME} ${RAILED_WIDTH_CLASS_NAME[level]}`
          : `relative ${PANEL_CLASS_NAME}`
      }
      level={level}
      closeDisabled={closeDisabled}
      onExitComplete={onExitComplete}
    >
      {RailIcon && railLabel ? (
        <>
          <ModalRail level={level} Icon={RailIcon} label={railLabel} />
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{content}</div>
        </>
      ) : (
        content
      )}
    </ModalShell>
  )
}

/**
 * Holds a content dialog's final actions, which stay at the bottom of the panel while the body above
 * them scrolls. Place it last in the content
 */
export function ModalContentFooter({ children }: { children: ReactNode }) {
  return (
    <div data-toast-keep-clear className="app-modal-footer">
      {children}
    </div>
  )
}
