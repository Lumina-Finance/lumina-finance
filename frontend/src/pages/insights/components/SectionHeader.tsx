import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type InsightSectionHeaderProps = {
  icon: LucideIcon
  label: ReactNode
  action?: ReactNode

  // Placement of the action's slot, for a card whose action takes its own row on a phone
  actionClassName?: string

  // Keeps the icon and the label on one row at every width, the label wrapping inside the space beside
  // the icon, for a card whose label is too long to fit in what is left after the icon on a phone
  keepLabelBesideIcon?: boolean
}

/**
 * Renders the shared insight section header: an accent icon chip, a label, and an optional
 * action pinned to the right edge
 */
export function InsightSectionHeader({
  icon: Icon,
  label,
  action,
  actionClassName = 'ml-auto',
  keepLabelBesideIcon = false,
}: InsightSectionHeaderProps) {
  const chip = (
    <div
      className={`rounded-xl p-2${keepLabelBesideIcon ? ' shrink-0' : ''}`}
      style={{ background: 'var(--app-accent-soft)' }}
    >
      <Icon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
    </div>
  )
  const text = <span className={`app-label${keepLabelBesideIcon ? ' min-w-0' : ''}`}>{label}</span>

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {keepLabelBesideIcon ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 min-[750px]:gap-2">
          {chip}
          {text}
        </div>
      ) : (
        <>
          {chip}
          {text}
        </>
      )}
      {action && <div className={actionClassName}>{action}</div>}
    </div>
  )
}
