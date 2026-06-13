import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type InsightSectionHeaderProps = {
  icon: LucideIcon
  label: ReactNode
  action?: ReactNode
}

export function InsightSectionHeader({
  icon: Icon,
  label,
  action,
}: InsightSectionHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="rounded-xl p-2" style={{ background: 'var(--app-accent-soft)' }}>
        <Icon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
      </div>
      <span className="app-label">{label}</span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}
