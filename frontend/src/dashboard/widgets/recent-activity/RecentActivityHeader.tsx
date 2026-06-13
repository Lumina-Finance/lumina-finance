import { Activity } from 'lucide-react'

/**
 * Renders the recent activity widget label
 */
export function RecentActivityHeader() {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
        <Activity size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
      </div>
      <span className="app-label">Recent Activity</span>
    </div>
  )
}
