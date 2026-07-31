import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useBaseBudgetUtilizations, useDeleteBaseBudget, type BaseBudget, type Budget, type BudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import BudgetDetailsSidebar from '@/pages/budgets/components/budget-details-modal/Sidebar'
import BudgetHistoryChart from '@/pages/budgets/components/budget-details-modal/HistoryChart'
import BudgetPeriodHistory from '@/pages/budgets/components/budget-details-modal/PeriodHistory'
import BudgetEditModal from '@/pages/budgets/components/budget-editor-modal/EditModal'
import BudgetFxStatusBadge from '@/pages/budgets/components/shared/FxStatusBadge'
import { ModalShell } from '@/components/modal/Shell'
import { DELETE_BUDGET_MIN_LOADING_MS } from '@/pages/budgets/constants'
import { attentionState } from '@/pages/budgets/utils/budgetStatus'
import { getHistoricalBudgetUtilizationFxStatusMessage } from '@/pages/budgets/utils/fxTooltipMessages'
import {
  getBudgetChartCategories,
  getBudgetDetailsChartData,
  getBudgetPeriodHistory,
  getBudgetUtilizationByBudgetId,
  getLatestBudgetCategories,
  getSortedBudgetPeriods,
} from '@/pages/budgets/utils/budgetDetails'
import { combineFxStatuses } from '@/utils/fxStatus'

/**
 * Coordinates budget details data, edit/delete actions, and the responsive details dialog layout
 */
export default function BudgetDetailsModal({
  open,
  baseBudget,
  periods,
  categories,
  currencies,
  categoryById,
  initialLatestUtilization,
  today,
  onClose,
  onDeleted,
  onSaved,
  onExitComplete,
}: {
  open: boolean
  baseBudget: BaseBudget
  periods: Budget[]
  categories: Category[]
  currencies: Currency[]
  categoryById: Map<string, string>
  initialLatestUtilization: BudgetUtilization | undefined
  today: string
  onClose: () => void
  onDeleted: () => void
  onSaved: () => void
  /** Runs once the panel has finished leaving, which the page waits on before dropping its budget snapshot */
  onExitComplete: () => void
}) {
  const deleteBaseBudget = useDeleteBaseBudget({ minimumPendingMs: DELETE_BUDGET_MIN_LOADING_MS })
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteInProgress, setDeleteInProgress] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const modalScrollRef = useRef<HTMLDivElement | null>(null)
  const [historyCanScroll, setHistoryCanScroll] = useState(false)
  const categoryDetailsById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const sortedPeriods = useMemo(() => getSortedBudgetPeriods(periods), [periods])
  const latestPeriod = sortedPeriods[sortedPeriods.length - 1]
  const utilizationQuery = useBaseBudgetUtilizations(baseBudget.id)
  const utilizationByBudgetId = useMemo(
    () => getBudgetUtilizationByBudgetId(initialLatestUtilization, utilizationQuery.data ?? []),
    [initialLatestUtilization, utilizationQuery.data],
  )
  const utilizationHistoryLoading = utilizationQuery.isLoading
  const utilizationHistoryError = utilizationQuery.isError
  const latestUtilization = latestPeriod ? utilizationByBudgetId.get(latestPeriod.id) : undefined

  // Declared after the latest utilization because the chart's stack order ranks on that period's spending
  const chartCategories = useMemo(
    () => getBudgetChartCategories({ baseBudget, categoryById, categoryDetailsById, latestUtilization }),
    [baseBudget, categoryById, categoryDetailsById, latestUtilization],
  )
  const categoryColorById = useMemo(
    () => new Map(chartCategories.map((category) => [category.id, category.color])),
    [chartCategories],
  )
  const utilizationHistoryFxStatus = combineFxStatuses(
    sortedPeriods.map((period) => utilizationByBudgetId.get(period.id)?.fx_status),
  )
  const spent = latestUtilization?.total_spent ?? 0
  const limit = latestPeriod?.overall_limit ?? 0
  const remaining = latestPeriod ? limit - spent : 0
  const isOverBudget = remaining < 0
  const showStackedCategoryChart = chartCategories.length > 1
  const chartData = useMemo(
    () => getBudgetDetailsChartData({ sortedPeriods, utilizationByBudgetId, chartCategories, baseBudget, today }),
    [baseBudget, chartCategories, sortedPeriods, today, utilizationByBudgetId],
  )
  const periodHistory = useMemo(
    () => getBudgetPeriodHistory(sortedPeriods, utilizationByBudgetId),
    [sortedPeriods, utilizationByBudgetId],
  )
  const latestCategories = getLatestBudgetCategories(latestUtilization)
  const attention = attentionState(latestPeriod, latestUtilization)
  const isDeleting = deleteBaseBudget.isPending || deleteInProgress

  /**
   * Refreshes the batched utilization history after budget edits can change historical limits
   */
  const refetchUtilizationHistory = () => {
    void utilizationQuery.refetch()
  }

  /**
   * Enables the history pane to take over scrolling only after mobile content reaches the bottom
   */
  const syncHistoryScrollState = useCallback(() => {
    const scrollContainer = modalScrollRef.current
    if (!scrollContainer) return
    const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight
    setHistoryCanScroll(scrollContainer.scrollTop >= maxScrollTop - 1)
  }, [])

  useEffect(() => {
    syncHistoryScrollState()
    window.addEventListener('resize', syncHistoryScrollState)
    return () => window.removeEventListener('resize', syncHistoryScrollState)
  }, [syncHistoryScrollState])

  /**
   * Requires an explicit confirmation step before deleting a budget and its historical periods
   */
  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    setDeleteError(null)
    setDeleteInProgress(true)
    try {
      await deleteBaseBudget.mutateAsync(baseBudget.id)
      onClose()
      onDeleted()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete budget.')
      setDeleteInProgress(false)
    }
  }

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        titleId="budget-detail-title"
        panelClassName="relative h-[44rem] max-h-[88vh] w-full max-w-6xl overflow-hidden"
        onExitComplete={onExitComplete}
      >
        <span id="budget-detail-title" className="sr-only">
          {baseBudget.name}
        </span>
        <div
          ref={modalScrollRef}
          className="flex h-full min-h-0 flex-col overflow-y-auto min-[1050px]:grid min-[1050px]:grid-cols-[22rem_minmax(0,1fr)] min-[1050px]:overflow-hidden"
          onScroll={syncHistoryScrollState}
        >
          <BudgetDetailsSidebar
            baseBudget={baseBudget}
            latestPeriod={latestPeriod}
            latestUtilization={latestUtilization}
            latestCategories={latestCategories}
            categoryById={categoryById}
            categoryColorById={categoryColorById}
            attention={attention}
            spent={spent}
            limit={limit}
            remaining={remaining}
            isOverBudget={isOverBudget}
            showStackedCategoryChart={showStackedCategoryChart}
            confirmDelete={confirmDelete}
            deleteError={deleteError}
            isDeleting={isDeleting}
            onClose={onClose}
            onEdit={() => setEditOpen(true)}
            onDelete={handleDelete}
          />

          <section
            data-tooltip-bounds
            className={`sticky top-[6rem] z-20 h-[calc(100dvh-6rem)] shrink-0 space-y-6 pb-5 px-5 pt-2 min-[750px]:top-24 min-[750px]:h-[calc(100dvh-6rem)] min-[750px]:space-y-8 min-[750px]:p-7 min-[1050px]:static min-[1050px]:z-auto min-[1050px]:flex min-[1050px]:h-full min-[1050px]:min-h-0 min-[1050px]:shrink min-[1050px]:flex-col min-[1050px]:gap-6 min-[1050px]:space-y-0 min-[1050px]:overflow-hidden ${historyCanScroll ? 'overflow-y-auto' : 'overflow-hidden'}`}
            style={{ background: 'var(--app-surface-soft)' }}
          >
            <header className="flex shrink-0 items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-semibold" style={{ color: 'var(--app-text)' }}>Historical utilization</h3>
                  <BudgetFxStatusBadge
                    fxStatus={utilizationHistoryFxStatus}
                    label="Historical utilization FX status"
                    getMessage={getHistoricalBudgetUtilizationFxStatusMessage}
                  />
                </div>
                <p className="mt-1 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  Percentage used for each budget period.
                </p>
              </div>
              <button type="button" className="app-icon-button hidden min-[1050px]:inline-flex" aria-label="Close budget details" onClick={onClose}>
                <X size={20} aria-hidden />
              </button>
            </header>

            <section className="shrink-0">
              <BudgetHistoryChart
                chartData={chartData}
                chartCategories={chartCategories}
                currency={baseBudget.currency}
                loading={utilizationHistoryLoading}
                error={utilizationHistoryError}
              />
            </section>

            <BudgetPeriodHistory
              periodHistory={periodHistory}
              currency={baseBudget.currency}
              loading={utilizationHistoryLoading}
              error={utilizationHistoryError}
            />

          </section>
          </div>
      </ModalShell>

      <BudgetEditModal
        open={editOpen}
        baseBudget={baseBudget}
        latestPeriod={latestPeriod}
        categories={categories}
        currencies={currencies}
        onClose={() => setEditOpen(false)}
        onSaved={(archiveChanged) => {
          refetchUtilizationHistory()
          onSaved()

          // Archiving is the only trigger for the card exit and archived-section animations, so close
          // this full-screen modal on an archive change to let them play on the visible budgets page
          if (archiveChanged) onClose()
        }}
      />
    </>
  )
}
