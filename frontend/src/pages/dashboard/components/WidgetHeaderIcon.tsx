import type { LucideIcon } from 'lucide-react'

type DashboardWidgetHeaderIconProps = {
  icon: LucideIcon
  background?: string
  color?: string
}

/**
 * Renders the standard decorative icon shell used by dashboard widget headers
 */
export function DashboardWidgetHeaderIcon({
  icon: Icon,
  background = 'var(--app-accent-soft)',
  color = 'var(--app-accent)',
}: DashboardWidgetHeaderIconProps) {
  return (
    <div className="p-2 rounded-xl" style={{ background }}>
      <Icon size={16} style={{ color }} aria-hidden />
    </div>
  )
}
