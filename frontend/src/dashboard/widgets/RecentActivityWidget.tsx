import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { useCategories } from '@/api/categories'
import { useDashboardRecentActivity } from '@/api/dashboard'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { formatCurrency } from '@/utils/formatCurrency'

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
  const categoryMap = useMemo(() => {
    const map = new Map<string, { name: string; kind: 'expense' | 'income' | 'transfer' }>()
    categories?.forEach((category) => {
      map.set(category.id, { name: category.name, kind: category.kind })
    })
    return map
  }, [categories])
  const recentActivity = (dashboardRecentActivity?.recent_transactions ?? []).slice(0, 5)

  return (
    <div className="app-card h-[410px] flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <Activity size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label">Recent Activity</span>
      </div>

      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading recent activity"
        className="flex-1"
        contentClassName="flex h-full min-h-0 flex-col"
      >
        {recentActivity.length === 0 ? (
          <div
            className="flex flex-1 items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            No recent transactions
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1">
              {recentActivity.map((transaction, index) => {
                const category = categoryMap.get(transaction.category_id)
                const merchantName = transaction.merchant_name
                const isIncome = category?.kind === 'income'
                const title = merchantName ?? transaction.notes ?? category?.name ?? 'Transaction'

                return (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between gap-2 py-2.5"
                    style={
                      index < recentActivity.length - 1
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
