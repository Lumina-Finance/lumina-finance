import type { FormEvent, ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import { MODAL_TITLE_CLASS_NAME, ModalRail } from '@/components/modal/Rail'
import { ModalShell, type ModalLevel } from '@/components/modal/Shell'

// Chrome sizing per level. A stacked panel is narrower and its padding tighter, so it reads as the smaller
// thing it is over a modal that is already open
const CHROME = {
  page: {
    panelClassName: 'flex max-h-[86vh] w-full overflow-hidden',
    widthClassName: 'max-w-2xl',
    headerClassName: `shrink-0 pb-5 pt-6 sm:pt-7 ${MODAL_INSET_CLASS_NAME.page}`,
    bodyClassName: `min-h-0 flex-1 overflow-y-auto pb-3 pt-4 ${MODAL_INSET_CLASS_NAME.page}`,
  },
  stacked: {
    panelClassName: 'flex max-h-[84vh] w-full overflow-hidden',
    widthClassName: 'max-w-xl',
    headerClassName: `shrink-0 pb-5 pt-6 ${MODAL_INSET_CLASS_NAME.stacked}`,
    bodyClassName: `min-h-0 flex-1 overflow-y-auto pb-3 pt-4 ${MODAL_INSET_CLASS_NAME.stacked}`,
  },
} as const

interface ModalTitledPanelProps {
  open: boolean
  onClose: () => void
  /** Submits the panel's fields, which also puts them in a form so Enter submits. Left out by a panel that
   *  manages things through their own controls and has nothing of its own to save */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  /** Id given to the heading, which is what the dialog is labelled by */
  titleId: string
  /** Id of the text explaining what the dialog asks, read out with the title when it opens */
  descriptionId?: string
  title: string
  eyebrow: string
  /** Note appended to the eyebrow in warning colour, for something to take in before saving */
  headerStatus?: string
  /** A control for the header, drawn beside the close button */
  headerAction?: ReactNode
  /** Icon for the labelled edge of the panel. Left out together with railLabel by a panel with no rail */
  RailIcon?: LucideIcon
  railLabel?: string
  /** Overrides the level's own panel width, for a body that needs more room than the usual form */
  widthClassName?: string

  /** Added to the panel's own classes, for a panel that limits its height more tightly than the level does */
  extraPanelClassName?: string
  level?: ModalLevel
  /** Blocks dismissal while an action is in flight */
  closeDisabled?: boolean
  /** Runs once the exit animation has finished, for work that must wait until the modal is fully gone */
  onExitComplete?: () => void
  footer: ReactNode
  children: ReactNode
}

/**
 * A modal with a labelled rail, a header carrying the title and close button, a scrolling body, and the
 * actions along the bottom
 */
export function ModalTitledPanel({
  open,
  onClose,
  onSubmit,
  titleId,
  descriptionId,
  title,
  eyebrow,
  headerStatus,
  headerAction,
  RailIcon,
  railLabel,
  widthClassName,
  extraPanelClassName = '',
  level = 'page',
  closeDisabled = false,
  onExitComplete,
  footer,
  children,
}: ModalTitledPanelProps) {
  const chrome = CHROME[level]

  const content = (
    <>
      <div className={chrome.headerClassName} style={{ borderBottom: '1px solid var(--app-border)' }}>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p
              className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase"
              style={{ color: 'var(--app-accent)' }}
            >
              <span>{eyebrow}</span>
              {headerStatus && (
                <>
                  <span aria-hidden style={{ color: 'var(--app-text-subtle)' }}>
                    &middot;
                  </span>
                  <span style={{ color: 'var(--app-warning-text)' }}>{headerStatus}</span>
                </>
              )}
            </p>
            <h2 id={titleId} className={MODAL_TITLE_CLASS_NAME}>
              {title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerAction}
            <button
              type="button"
              onClick={onClose}
              className="app-icon-button shrink-0"
              disabled={closeDisabled}
              aria-label="Close"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <div className={chrome.bodyClassName} data-tooltip-bounds data-dropdown-bounds>
        {children}
      </div>

      {footer}
    </>
  )

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId={titleId}
      descriptionId={descriptionId}
      panelClassName={`${chrome.panelClassName} ${widthClassName ?? chrome.widthClassName} ${extraPanelClassName}`}
      level={level}
      closeDisabled={closeDisabled}
      onExitComplete={onExitComplete}
    >
      {RailIcon && railLabel && <ModalRail level={level} Icon={RailIcon} label={railLabel} />}

      {/* Fields go in a form so Enter submits them. A panel that only manages things through their own
          controls has nothing to submit, and a form there would announce one that does nothing */}
      {onSubmit ? (
        <form onSubmit={onSubmit} className="flex min-h-0 w-full flex-col" noValidate>
          {content}
        </form>
      ) : (
        <div className="flex min-h-0 w-full flex-col">{content}</div>
      )}
    </ModalShell>
  )
}
