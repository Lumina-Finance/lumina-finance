import { Activity } from 'lucide-react'
import { DashboardWidgetHeaderIcon } from '@/dashboard/components/DashboardWidgetHeaderIcon'

/**
 * Renders the recent activity widget label
 */
export function RecentActivityHeader() {
  return (
    <div className="flex items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={Activity} />
      <span className="app-label">Recent Activity</span>
    </div>
  )
}
