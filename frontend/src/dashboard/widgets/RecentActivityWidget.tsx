import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCategories } from '@/api/categories'
import { useDashboardRecentActivity } from '@/api/dashboard'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { RecentActivityHeader } from '@/dashboard/components/RecentActivityHeader'
import { getRecentActivityRows } from '@/dashboard/utils/getRecentActivityRows'
import { formatCurrency } from '@/utils/formatCurrency'

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
        {recentActivityRows.length === 0 ? (
          <div
            className="flex flex-1 items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            No recent transactions
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1">
              {recentActivityRows.map(({ transaction, category, title, isIncome }, index) => {
                return (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between gap-2 py-2.5"
                    style={
                      index < recentActivityRows.length - 1
                        ? { borderBottom: '1px solid var(--app-border)' }
                        : undefined
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium max-[1000px]:text-[0.7875rem]">
                        {title}
                        {category && (
                          <>
                            <span className="mx-1.5" style={{ color: 'var(--app-text-subtle)' }}>·</span>
                            <span style={{ color: 'var(--app-text-muted)' }}>{category.name}</span>
                          </>
                        )}
                      </p>
                      <p
                        className="mt-0.5 text-xs max-[1000px]:text-[0.675rem]"
                        style={{ color: 'var(--app-text-muted)' }}
                      >
                        {new Date(`${transaction.dt}T00:00:00`).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                    <span
                      className="font-financial shrink-0 tabular-nums text-sm font-medium max-[1000px]:text-[0.7875rem]"
                      style={{ color: isIncome ? 'var(--app-positive)' : 'var(--app-text)' }}
                    >
                      {transaction.amount >= 0 ? '+' : '-'}
                      {formatCurrency(Math.abs(transaction.amount), transaction.currency)}
                    </span>
                  </div>
                )
              })}
            </div>
            <Link
              to="/transactions"
              className="app-secondary-button mt-3 h-9 text-xs max-[1000px]:text-[0.675rem]"
            >
              View all transactions
            </Link>
          </>
        )}
      </DashboardWidgetLoadingBody>
    </div>
  )
}
