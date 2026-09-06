import type { FormEvent, ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { ModalShell, type ModalLevel } from '@/components/modal/Shell'

// Chrome sizing per level. A stacked panel is narrower and its padding tighter, so it reads as the smaller
// thing it is over a modal that is already open
const CHROME = {
  page: {
    panelClassName: 'flex max-h-[86vh] w-full overflow-hidden',
    widthClassName: 'max-w-2xl',
    railClassName: 'hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex',
    railStyle: { background: 'var(--app-button-primary-bg)', color: 'var(--app-button-primary-text)' },
    railIconSize: 20,
    railLabelClassName: 'text-xs',
    headerClassName: 'shrink-0 pb-5 pl-4 pr-5 pt-6 sm:pt-7 min-[1050px]:px-8',
    bodyClassName: 'min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-8',
  },
  stacked: {
    panelClassName: 'flex max-h-[84vh] w-full overflow-hidden',
    widthClassName: 'max-w-xl',
    railClassName: 'app-secondary-modal-rail hidden w-12 shrink-0 flex-col items-center justify-between py-5 sm:flex',
    railStyle: {
      background: 'var(--app-surface-soft)',
      borderRight: '1px solid var(--app-border)',
      color: 'var(--app-accent)',
    },
    railIconSize: 18,
    railLabelClassName: 'text-[0.6875rem]',
    headerClassName: 'shrink-0 pb-5 pl-4 pr-5 pt-6 min-[1050px]:px-7',
    bodyClassName: 'min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-7',
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
  title: string
  eyebrow: string
  /** Note appended to the eyebrow in warning colour, for something to take in before saving */
  headerStatus?: string
  /** Icon for the labelled edge of the panel. Left out together with railLabel by a panel with no rail */
  RailIcon?: LucideIcon
  railLabel?: string
  /** Overrides the level's own panel width, for a body that needs more room than the usual form */
  widthClassName?: string
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
  title,
  eyebrow,
  headerStatus,
  RailIcon,
  railLabel,
  widthClassName,
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
            <h2 id={titleId} className="font-serif text-3xl font-normal">
              {title}
            </h2>
          </div>
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

      <div className={chrome.bodyClassName} data-tooltip-bounds>{children}</div>

      {footer}
    </>
  )

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId={titleId}
      panelClassName={`${chrome.panelClassName} ${widthClassName ?? chrome.widthClassName}`}
      level={level}
      closeDisabled={closeDisabled}
      onExitComplete={onExitComplete}
    >
      {RailIcon && railLabel && (
        <div className={chrome.railClassName} style={chrome.railStyle} aria-hidden>
          <RailIcon size={chrome.railIconSize} strokeWidth={2} />
          <span
            className={`${chrome.railLabelClassName} rotate-180 font-semibold uppercase`}
            style={{ writingMode: 'vertical-rl' }}
          >
            {railLabel}
          </span>
        </div>
      )}

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
