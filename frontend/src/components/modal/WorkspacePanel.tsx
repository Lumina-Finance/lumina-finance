import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { ModalShell } from '@/components/modal/Shell'

type ModalWorkspacePanelProps = {
  open: boolean
  onClose: () => void
  /** Id given to the heading that the dialogue is labelled by */
  titleId: string
  /** The kind of thing being managed, shown above its name */
  eyebrow: string
  /** The thing's name. A panel that renames in place passes its own field here, keeping titleId on the heading */
  title: ReactNode
  /** What the thing is and how it stands, as facts under its name */
  facts: ReactNode
  /** Actions on the thing as a whole, at the foot of its pane */
  actions: ReactNode
  /** What the actions do, under them. Always shown rather than when one is armed, so the buttons never move under the pointer */
  actionsNote?: ReactNode
  /** Heading over the parts, such as their name and count */
  partsLabel: ReactNode
  /** Controls beside the parts' heading, such as a search field */
  partsTools?: ReactNode
  /** Blocks dismissal while an action is in flight */
  closeDisabled?: boolean
  /** Runs once the exit animation has finished, for work that must wait until the modal is fully gone */
  onExitComplete?: () => void
  /** The parts beneath the thing */
  children: ReactNode
}

/**
 * A modal for looking after one thing and the parts beneath it. Every control acts straight away and
 * there is nothing to save. The thing keeps a pane of its own with its name, facts and actions, and its
 * parts fill the rest
 *
 * Side by side from 1050px. The parts scroll on their own and the thing stays in view. Narrower, the
 * modal takes the whole screen as every modal does, and the thing comes first on one scroll with its parts
 * after it
 */
export function ModalWorkspacePanel({
  open,
  onClose,
  titleId,
  eyebrow,
  title,
  facts,
  actions,
  actionsNote,
  partsLabel,
  partsTools,
  closeDisabled = false,
  onExitComplete,
  children,
}: ModalWorkspacePanelProps) {
  const partsHeadingId = `${titleId}-parts`

  // One close button for each layout, since it sits in the thing's pane on one scroll and beside the parts'
  // heading once the two are side by side
  const closeButton = (className: string) => (
    <button
      type="button"
      onClick={onClose}
      className={`app-icon-button shrink-0 ${className}`}
      disabled={closeDisabled}
      aria-label="Close"
    >
      <X size={20} aria-hidden />
    </button>
  )

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId={titleId}
      panelClassName="flex max-h-[86vh] w-full max-w-[60rem] overflow-hidden"
      closeDisabled={closeDisabled}
      onExitComplete={onExitComplete}
    >
      <div className="flex min-h-0 w-full flex-col overflow-y-auto min-[1050px]:grid min-[1050px]:h-[580px] min-[1050px]:max-h-[86vh] min-[1050px]:grid-cols-[18rem_minmax(0,1fr)] min-[1050px]:overflow-hidden">
        {/* Once it is a column, the thing's pane scrolls up and down only. A closed tooltip is faded rather
            than gone, so one centred on an icon near the column's right edge still reaches past it, and
            would otherwise let the column slide sideways from under the icon */}
        <aside
          data-tooltip-bounds
          className="flex min-w-0 shrink-0 flex-col border-b px-4 pb-5 pt-5 sm:px-6 sm:pt-6 min-[1050px]:min-h-0 min-[1050px]:overflow-y-auto min-[1050px]:overflow-x-hidden min-[1050px]:border-b-0 min-[1050px]:border-r min-[1050px]:px-6 min-[1050px]:pb-6 min-[1050px]:pt-7"
          style={{ background: 'var(--app-surface-soft)', borderColor: 'var(--app-border)' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                {eyebrow}
              </p>
              {title}
            </div>
            {closeButton('min-[1050px]:hidden')}
          </div>

          <div className="mt-5 border-t pt-5" style={{ borderColor: 'var(--app-border)' }}>
            {facts}
          </div>

          <div className="mt-6 flex shrink-0 gap-2 min-[1050px]:mt-auto min-[1050px]:pt-6">{actions}</div>
          {actionsNote && <div className="mt-2.5 shrink-0">{actionsNote}</div>}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col min-[1050px]:min-h-0" aria-labelledby={partsHeadingId}>
          <div
            className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 sm:px-6 min-[1050px]:flex-nowrap min-[1050px]:border-b min-[1050px]:py-3"
            style={{ borderColor: 'var(--app-border)' }}
          >
            <h3
              id={partsHeadingId}
              className="min-w-0 flex-1 truncate text-xs font-medium uppercase"
              style={{ color: 'var(--app-text-muted)' }}
            >
              {partsLabel}
            </h3>
            {partsTools && (
              <div className="order-last w-full min-[1050px]:order-none min-[1050px]:w-60">{partsTools}</div>
            )}
            {closeButton('hidden min-[1050px]:inline-flex')}
          </div>
          <div
            className="flex flex-1 flex-col px-4 pb-6 pt-4 sm:px-6 min-[1050px]:min-h-0 min-[1050px]:overflow-y-auto min-[1050px]:py-5"
            data-tooltip-bounds
            data-dropdown-bounds
          >
            {children}
          </div>
        </section>
      </div>
    </ModalShell>
  )
}
