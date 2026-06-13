import { useMemo } from 'react'
import { useCategories } from '@/api/categories'
import { useDashboardRecentActivity } from '@/api/dashboard'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/pages/dashboard/components/WidgetLoadingBody'
import { RecentActivityHeader } from './RecentActivityHeader'
import { RecentActivityList } from './RecentActivityList'
import { getRecentActivityRows } from '@/pages/dashboard/utils/getRecentActivityRows'

/**
 * Loads recent transactions and category metadata for the dashboard activity list
 */
export function RecentActivityWidget() {
  const { data: incomingDashboardRecentActivity, isFetching: recentActivityLoading } = useDashboardRecentActivity()
  const { data: incomingCategories, isFetching: categoriesLoading } = useCategories()
  const loadingSnapshot = useMemo(
    () => ({
      categories: incomingCategories,
      dashboardRecentActivity: incomingDashboardRecentActivity,
    }),
    [incomingCategories, incomingDashboardRecentActivity],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: recentActivityLoading || categoriesLoading,
    transitionKey: 'recent-activity',
  })
  const { categories, dashboardRecentActivity } = displaySnapshot
  const recentActivityRows = useMemo(
    () => getRecentActivityRows(dashboardRecentActivity?.recent_transactions, categories),
    [categories, dashboardRecentActivity],
  )

  return (
    <div className="app-card h-[410px] flex flex-col">
      <RecentActivityHeader />

      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading recent activity"
        className="flex-1"
        contentClassName="flex h-full min-h-0 flex-col"
      >
        <RecentActivityList rows={recentActivityRows} />
      </DashboardWidgetLoadingBody>
    </div>
  )
}
