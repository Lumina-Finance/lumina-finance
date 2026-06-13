import { useMemo } from 'react'
import { useLatestBudgetUtilizations } from '@/api/budgets'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { TopBudgetsHeader } from '@/dashboard/components/TopBudgetsHeader'
import { TopBudgetsList } from '@/dashboard/components/TopBudgetsList'
import { combineFxStatuses } from '@/dashboard/utils/fxStatus'
import { getTopBudgets } from '@/dashboard/utils/getTopBudgets'

/**
 * Loads recent budget utilization data and composes the dashboard top budgets list
 */
export function TopBudgetsWidget() {
  const { data: incomingLatestBudgetUtilizations, isFetching: loading } = useLatestBudgetUtilizations()
  const loadingSnapshot = useMemo(
    () => ({ latestBudgetUtilizations: incomingLatestBudgetUtilizations }),
    [incomingLatestBudgetUtilizations],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading,
    transitionKey: 'top-budgets',
  })
  const latestBudgetUtilizations = displaySnapshot.latestBudgetUtilizations
  const budgets = useMemo(
    () => getTopBudgets(latestBudgetUtilizations),
    [latestBudgetUtilizations],
  )
  const fxStatus = useMemo(
    () => combineFxStatuses(budgets.map((budget) => budget.fx_status)),
    [budgets],
  )

  return (
    <div className="app-card h-[410px] flex flex-col">
      <TopBudgetsHeader fxStatus={fxStatus} />

      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading top budgets"
        className="flex-1"
        contentClassName="flex h-full min-h-0 flex-col"
      >
        <TopBudgetsList budgets={budgets} />
      </DashboardWidgetLoadingBody>
    </div>
  )
}
