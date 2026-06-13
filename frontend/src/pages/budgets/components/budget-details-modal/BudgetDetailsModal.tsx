import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { useBudgetUtilizations, useDeleteBaseBudget, type BaseBudget, type Budget, type BudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import BudgetDetailsSidebar from '@/pages/budgets/components/budget-details-modal/BudgetDetailsSidebar'
import BudgetHistoryChart from '@/pages/budgets/components/budget-details-modal/BudgetHistoryChart'
import BudgetPeriodHistory from '@/pages/budgets/components/budget-details-modal/BudgetPeriodHistory'
import BudgetEditModal from '@/pages/budgets/components/budget-editor-modal/BudgetEditModal'
import BudgetFxStatusTooltip from '@/pages/budgets/components/shared/BudgetFxStatusTooltip'
import { DELETE_BUDGET_MIN_LOADING_MS, EASE, MODAL_SURFACE_TRANSITION_SECONDS } from '@/pages/budgets/constants'
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
  baseBudget,
  periods,
  categories,
  currencies,
  categoryById,
  initialLatestUtilization,
  onClose,
  onDeleted,
  onSaved,
}: {
  baseBudget: BaseBudget
  periods: Budget[]
  categories: Category[]
  currencies: Currency[]
  categoryById: Map<string, string>
  initialLatestUtilization: BudgetUtilization | undefined
  onClose: () => void
  onDeleted: () => void
  onSaved: () => void
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
  const chartCategories = useMemo(
    () => getBudgetChartCategories({ baseBudget, categoryById, categoryDetailsById }),
    [baseBudget, categoryById, categoryDetailsById],
  )
  const categoryColorById = useMemo(
    () => new Map(chartCategories.map((category) => [category.id, category.color])),
    [chartCategories],
  )
  const sortedPeriods = useMemo(() => getSortedBudgetPeriods(periods), [periods])
  const latestPeriod = sortedPeriods[sortedPeriods.length - 1]
  const periodIds = useMemo(() => periods.map((period) => period.id), [periods])
  const utilizationQueries = useBudgetUtilizations(periodIds)
  const utilizationByBudgetId = useMemo(
    () => getBudgetUtilizationByBudgetId(
      initialLatestUtilization,
      utilizationQueries.map((query) => query.data),
    ),
    [initialLatestUtilization, utilizationQueries],
  )
  const utilizationHistoryLoading = utilizationQueries.some((query) => query.isLoading)
  const utilizationHistoryError = utilizationQueries.some((query) => query.isError)
  const latestUtilization = latestPeriod ? utilizationByBudgetId.get(latestPeriod.id) : undefined
  const utilizationHistoryFxStatus = combineFxStatuses(
    sortedPeriods.map((period) => utilizationByBudgetId.get(period.id)?.fx_status),
  )
  const spent = latestUtilization?.total_spent ?? 0
  const limit = latestPeriod?.overall_limit ?? 0
  const remaining = latestPeriod ? limit - spent : 0
  const isOverBudget = remaining < 0
  const showStackedCategoryChart = chartCategories.length > 1
  const chartData = useMemo(
    () => getBudgetDetailsChartData({ sortedPeriods, utilizationByBudgetId, chartCategories }),
    [chartCategories, sortedPeriods, utilizationByBudgetId],
  )
  const periodHistory = useMemo(
    () => getBudgetPeriodHistory(sortedPeriods, utilizationByBudgetId),
    [sortedPeriods, utilizationByBudgetId],
  )
  const latestCategories = getLatestBudgetCategories(latestUtilization)
  const attention = attentionState(latestPeriod, latestUtilization)
  const isDeleting = deleteBaseBudget.isPending || deleteInProgress

  /**
   * Refreshes every loaded period utilization after budget edits can change historical limits
   */
  const refetchUtilizationHistory = () => {
    utilizationQueries.forEach((query) => {
      void query.refetch()
    })
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

  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden
      />

      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: MODAL_SURFACE_TRANSITION_SECONDS, ease: EASE }}
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="budget-detail-title"
          className="app-modal-panel relative h-[44rem] max-h-[88vh] w-full max-w-6xl overflow-hidden"
          onClick={(event) => event.stopPropagation()}
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
              className={`sticky top-[5.5rem] z-20 h-[calc(100dvh-5.5rem)] shrink-0 space-y-6 p-5 min-[750px]:top-24 min-[750px]:h-[calc(100dvh-6rem)] min-[750px]:space-y-8 min-[750px]:p-7 min-[1050px]:static min-[1050px]:z-auto min-[1050px]:flex min-[1050px]:h-full min-[1050px]:min-h-0 min-[1050px]:shrink min-[1050px]:flex-col min-[1050px]:gap-6 min-[1050px]:space-y-0 min-[1050px]:overflow-hidden ${historyCanScroll ? 'overflow-y-auto' : 'overflow-hidden'}`}
              style={{ background: 'var(--app-surface-soft)' }}
            >
              <header className="flex shrink-0 items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold" style={{ color: 'var(--app-text)' }}>Historical utilization</h3>
                    <BudgetFxStatusTooltip
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
        </div>
      </motion.div>
      <BudgetEditModal
        open={editOpen}
        baseBudget={baseBudget}
        latestPeriod={latestPeriod}
        categories={categories}
        currencies={currencies}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          refetchUtilizationHistory()
          onSaved()
        }}
      />
    </>,
    document.body,
  )
}
