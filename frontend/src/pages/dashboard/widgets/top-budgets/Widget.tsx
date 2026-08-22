import { useMemo } from 'react'
import { useLatestBudgetUtilizations } from '@/api/budgets'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/pages/dashboard/components/WidgetLoadingBody'
import { TopBudgetsHeader } from './Header'
import { TopBudgetsList } from './List'
import { combineFxStatuses } from '@/utils/fxStatus'
import { getTopBudgets } from '@/pages/dashboard/utils/getTopBudgets'

/**
 * Loads recent budget utilization data and composes the dashboard top budgets list
 */
export function TopBudgetsWidget() {
  const {
    data: incomingLatestBudgetUtilizations,
    error: budgetsError,
    isError: budgetsFailed,
    isFetching: loading,
  } = useLatestBudgetUtilizations()
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
    <div className="app-card min-h-[410px] flex flex-col">
      <TopBudgetsHeader fxStatus={fxStatus} />

      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        error={budgetsError}
        failed={budgetsFailed}
        hasContent={latestBudgetUtilizations !== undefined}
        subject="Top budgets"
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
