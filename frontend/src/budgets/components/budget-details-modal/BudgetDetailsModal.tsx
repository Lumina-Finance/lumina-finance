
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Pencil, Trash2, X } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useBudgetUtilizations, useDeleteBaseBudget, type BaseBudget, type Budget, type BudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'
import BudgetChartTooltip from '@/budgets/components/budget-details-modal/BudgetChartTooltip'
import BudgetEditModal from '@/budgets/components/budget-form/BudgetEditModal'
import AttentionIcon from '@/budgets/components/shared/AttentionIcon'
import { DELETE_BUDGET_MIN_LOADING_MS, EASE, MODAL_SURFACE_TRANSITION_MS, MODAL_SURFACE_TRANSITION_SECONDS } from '@/budgets/constants'
import { budgetCadenceLabel, formatBudgetPeriod } from '@/budgets/utils/budgetPeriods'
import { formatCalendarDate, parseYmd } from '@/budgets/utils/date'
import { attentionState } from '@/budgets/utils/budgetStatus'

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
  const sortedPeriods = periods.slice().sort((a, b) => a.period_start.localeCompare(b.period_start))
  const latestPeriod = sortedPeriods[sortedPeriods.length - 1]
  const periodIds = useMemo(() => periods.map((period) => period.id), [periods])
  const utilizationQueries = useBudgetUtilizations(periodIds)
  const utilizationByBudgetId = useMemo(() => {
    const utilizations = new Map<string, BudgetUtilization>()
    // Seed with the list-level latest utilization so the modal can render useful
    // current-period data before every historical query finishes.
    if (initialLatestUtilization) {
      utilizations.set(initialLatestUtilization.budget_id, initialLatestUtilization)
    }
    utilizationQueries
      .map((query) => query.data)
      .filter((utilization): utilization is BudgetUtilization => Boolean(utilization))
      .forEach((utilization) => {
        utilizations.set(utilization.budget_id, utilization)
      })
    return utilizations
  }, [initialLatestUtilization, utilizationQueries])
  const utilizationHistoryLoading = utilizationQueries.some((query) => query.isLoading)
  const utilizationHistoryError = utilizationQueries.some((query) => query.isError)
  const latestUtilization = latestPeriod ? utilizationByBudgetId.get(latestPeriod.id) : undefined
  const spent = latestUtilization?.total_spent ?? 0
  const limit = latestPeriod?.overall_limit ?? 0
  const remaining = latestPeriod ? limit - spent : 0
  const isOverBudget = remaining < 0
  const utilizationPct = latestPeriod ? Math.round((spent / limit) * 100) : null
  // Keep the chart readable by showing only the most recent budget periods.
  const chartData = sortedPeriods.slice(-6).map((period) => {
    const utilization = utilizationByBudgetId.get(period.id)
    const periodSpent = utilization?.total_spent ?? 0
    return {
      label: formatCalendarDate(parseYmd(period.period_start)),
      spent: periodSpent,
      limit: period.overall_limit,
      utilizationPct: Math.round((periodSpent / period.overall_limit) * 100),
    }
  })
  const periodHistory = sortedPeriods.slice().reverse().map((period) => {
    const utilization = utilizationByBudgetId.get(period.id)
    const spent = utilization?.total_spent ?? 0
    const remaining = period.overall_limit - spent
    return {
      period,
      spent,
      remaining,
    }
  })
  const latestCategories = (latestUtilization?.categories ?? [])
    .slice()
    .sort((a, b) => b.spent - a.spent)
  const attention = attentionState(latestPeriod, latestUtilization)
  const isDeleting = deleteBaseBudget.isPending || deleteInProgress
  const refetchUtilizationHistory = () => {
    utilizationQueries.forEach((query) => {
      void query.refetch()
    })
  }
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
            <aside
              className="sticky top-0 z-10 flex shrink-0 flex-col gap-5 p-5 min-[750px]:gap-7 min-[750px]:p-7 min-[1050px]:static min-[1050px]:z-auto min-[1050px]:min-h-0 min-[1050px]:shrink min-[1050px]:overflow-y-auto"
              style={{ background: 'var(--app-accent-soft)', color: 'var(--app-text)' }}
            >
              <header className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate text-2xl font-semibold">
                    {baseBudget.name}
                  </h2>
                  <p className="mt-2 truncate text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                    {budgetCadenceLabel(baseBudget)} · {baseBudget.group_id ? 'Shared' : 'Personal'} · {baseBudget.currency}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="hidden items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium min-[1050px]:inline-flex"
                    style={{ background: attention.background, color: attention.textColor }}
                  >
                    <AttentionIcon label={attention.label} />
                    {attention.label}
                  </span>
                  <button type="button" className="app-icon-button shrink-0 min-[1050px]:hidden" aria-label="Close budget details" onClick={onClose}>
                    <X size={20} aria-hidden />
                  </button>
                </div>
              </header>

              <section>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
                    Current budget
                  </p>
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium min-[1050px]:hidden"
                    style={{ background: attention.background, color: attention.textColor }}
                  >
                    <AttentionIcon label={attention.label} />
                    {attention.label}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2 min-[750px]:mt-3">
                  <p className="min-w-0 text-3xl font-semibold leading-none tracking-tight min-[750px]:text-4xl">
                    {latestPeriod ? formatCurrency(Math.abs(remaining), baseBudget.currency) : 'Not set'}
                  </p>
                  {latestPeriod && (
                    <span className="shrink-0 text-base font-bold uppercase min-[750px]:text-lg" style={{ color: 'var(--app-text)' }}>
                      {isOverBudget ? 'over' : 'left'}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {latestPeriod
                    ? `${formatCurrency(spent, baseBudget.currency)} used of ${formatCurrency(limit, baseBudget.currency)}`
                    : 'No periods have been created yet.'}
                </p>
                {latestPeriod && (
                  <div className="mt-4 flex items-center gap-3 min-[750px]:mt-5">
                    <div className="h-2 flex-1 rounded-full" style={{ background: 'var(--app-border)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(Math.max((spent / limit) * 100, 0), 100)}%`, background: attention.indicatorColor }}
                      />
                    </div>
                    <span className="shrink-0 text-xs font-semibold" style={{ color: 'var(--app-text-subtle)' }}>
                      {utilizationPct}% used
                    </span>
                  </div>
                )}
                <div className="mt-4 flex justify-between gap-4 border-t pt-3 text-sm min-[750px]:mt-5 min-[750px]:pt-4" style={{ borderColor: 'var(--app-border)' }}>
                  <span style={{ color: 'var(--app-text-subtle)' }}>Current period</span>
                  <span className="text-right" style={{ color: 'var(--app-text-muted)' }}>
                    {latestPeriod ? formatBudgetPeriod(latestPeriod) : 'None'}
                  </span>
                </div>
              </section>

              <section className="border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
                    Tracked categories
                  </h3>
                  {latestCategories.length > 0 && (
                    <span className="text-xs font-medium" style={{ color: 'var(--app-text-muted)' }}>
                      Current period
                    </span>
                  )}
                </div>
                <div className="mt-3 max-h-[15rem] overflow-y-auto pr-2">
                  {latestCategories.length > 0 ? latestCategories.map((category) => (
                    <div
                      key={category.category_id}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                      style={{ borderTop: '1px solid var(--app-border)' }}
                    >
                      <span className="truncate" style={{ color: 'var(--app-text-muted)' }}>{categoryById.get(category.category_id) ?? 'Uncategorized'}</span>
                      <span className="shrink-0 font-medium" style={{ color: 'var(--app-text)' }}>{formatCurrency(category.spent, baseBudget.currency)}</span>
                    </div>
                  )) : (
                    <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                      No category spending for the current period.
                    </p>
                  )}
                </div>
              </section>

              <div className="hidden min-[1050px]:mt-auto min-[1050px]:block">
                {confirmDelete && !isDeleting && (
                  <p className="mb-3 text-sm" style={{ color: 'var(--app-negative)' }}>
                    This will delete all historical data.
                  </p>
                )}
                {deleteError && (
                  <p className="mb-3 text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
                    {deleteError}
                  </p>
                )}
                <div className="flex gap-3">
                  <button type="button" className="app-primary-button flex-1" onClick={() => setEditOpen(true)}>
                    <Pencil size={16} aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`app-danger-button overflow-hidden whitespace-nowrap duration-300 ${isDeleting ? 'app-primary-button-loading shrink-0' : 'flex-1'}`}
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <div className="app-spinner" />
                    ) : (
                      <>
                        <Trash2 size={16} aria-hidden />
                        {confirmDelete ? 'Confirm' : 'Delete'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </aside>

            <section
              className={`sticky top-[5.5rem] z-20 h-[calc(100dvh-5.5rem)] shrink-0 space-y-6 p-5 min-[750px]:top-24 min-[750px]:h-[calc(100dvh-6rem)] min-[750px]:space-y-8 min-[750px]:p-7 min-[1050px]:static min-[1050px]:z-auto min-[1050px]:h-auto min-[1050px]:min-h-0 min-[1050px]:shrink min-[1050px]:overflow-y-auto ${historyCanScroll ? 'overflow-y-auto' : 'overflow-hidden'}`}
              style={{ background: 'var(--app-surface-soft)' }}
            >
              <header className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold" style={{ color: 'var(--app-text)' }}>Historical utilization</h3>
                  <p className="mt-1 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                    Percentage used for each budget period.
                  </p>
                </div>
                <button type="button" className="app-icon-button hidden min-[1050px]:inline-flex" aria-label="Close budget details" onClick={onClose}>
                  <X size={20} aria-hidden />
                </button>
              </header>

              <section>
                <div className="h-48 min-[750px]:h-80">
                  {utilizationHistoryLoading ? (
                    <div
                      className="flex h-full items-center justify-center rounded-xl"
                      style={{ background: 'var(--app-bg)' }}
                    >
                      <div className="app-spinner" />
                    </div>
                  ) : utilizationHistoryError ? (
                    <div
                      className="flex h-full items-center justify-center rounded-xl text-sm"
                      style={{ background: 'var(--app-bg)', color: 'var(--app-negative)' }}
                    >
                      Utilization history could not load.
                    </div>
                  ) : chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="var(--app-border)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--app-text-subtle)', fontSize: 13 }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          domain={[0, (dataMax: number) => Math.max(100, Math.ceil(dataMax / 25) * 25)]}
                          tick={{ fill: 'var(--app-text-subtle)', fontSize: 12 }}
                          tickFormatter={(value) => `${Number(value)}%`}
                          width={48}
                        />
                        <Tooltip
                          cursor={{ fill: 'var(--app-surface-soft)' }}
                          content={<BudgetChartTooltip currency={baseBudget.currency} />}
                        />
                        <Bar
                          dataKey="utilizationPct"
                          fill="var(--app-accent)"
                          radius={[4, 4, 0, 0]}
                          barSize={28}
                          animationBegin={MODAL_SURFACE_TRANSITION_MS}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      className="flex h-full items-center justify-center rounded-xl text-sm"
                      style={{ background: 'var(--app-bg)', color: 'var(--app-text-subtle)' }}
                    >
                      No utilization history yet.
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-base font-semibold" style={{ color: 'var(--app-text)' }}>Period history</h3>
                <div className="mt-3 space-y-3 min-[750px]:hidden">
                  {utilizationHistoryLoading ? (
                    <div className="rounded-xl px-4 py-6 text-center text-sm" style={{ background: 'var(--app-bg)', color: 'var(--app-text-subtle)' }}>
                      Loading utilization history...
                    </div>
                  ) : utilizationHistoryError ? (
                    <div className="rounded-xl px-4 py-6 text-center text-sm" style={{ background: 'var(--app-bg)', color: 'var(--app-negative)' }}>
                      Utilization history could not load.
                    </div>
                  ) : periodHistory.map(({ period, spent, remaining }) => (
                    <div key={period.id} className="rounded-xl px-4 py-3" style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)' }}>
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                          {formatBudgetPeriod(period)}
                        </p>
                        <p className="shrink-0 text-right text-sm font-semibold" style={{ color: remaining < 0 ? 'var(--app-negative)' : 'var(--app-positive)' }}>
                          {remaining < 0 ? 'Over ' : 'Left '}
                          {formatCurrency(Math.abs(remaining), baseBudget.currency)}
                        </p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>Used</p>
                          <p className="mt-1" style={{ color: 'var(--app-text-muted)' }}>{formatCurrency(spent, baseBudget.currency)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>Budgeted</p>
                          <p className="mt-1" style={{ color: 'var(--app-text-muted)' }}>{formatCurrency(period.overall_limit, baseBudget.currency)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 hidden overflow-hidden min-[750px]:block" style={{ borderTop: '1px solid var(--app-border)' }}>
                  <div className="max-h-[12rem] overflow-y-auto pr-3">
                    <table className="w-full text-sm">
                      <thead
                        className="sticky top-0 z-10"
                        style={{ background: 'var(--app-surface-soft)', color: 'var(--app-text-subtle)' }}
                      >
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">Period</th>
                          <th className="px-4 py-3 text-right font-medium">Used</th>
                          <th className="px-4 py-3 text-right font-medium">Budgeted</th>
                          <th className="px-4 py-3 text-right font-medium">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {utilizationHistoryLoading ? (
                          <tr>
                            <td className="px-4 py-6 text-center" colSpan={4} style={{ color: 'var(--app-text-subtle)' }}>
                              Loading utilization history...
                            </td>
                          </tr>
                        ) : utilizationHistoryError ? (
                          <tr>
                            <td className="px-4 py-6 text-center" colSpan={4} style={{ color: 'var(--app-negative)' }}>
                              Utilization history could not load.
                            </td>
                          </tr>
                        ) : periodHistory.map(({ period, spent, remaining }) => (
                          <tr key={period.id} style={{ borderTop: '1px solid var(--app-border)' }}>
                            <td className="px-4 py-3" style={{ color: 'var(--app-text)' }}>
                              {formatBudgetPeriod(period)}
                            </td>
                            <td className="px-4 py-3 text-right" style={{ color: 'var(--app-text-muted)' }}>
                              {formatCurrency(spent, baseBudget.currency)}
                            </td>
                            <td className="px-4 py-3 text-right" style={{ color: 'var(--app-text-muted)' }}>
                              {formatCurrency(period.overall_limit, baseBudget.currency)}
                            </td>
                            <td className="px-4 py-3 text-right" style={{ color: remaining < 0 ? 'var(--app-negative)' : 'var(--app-positive)' }}>
                              {remaining < 0 ? 'Over ' : 'Left '}
                              {formatCurrency(Math.abs(remaining), baseBudget.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section className="min-[1050px]:hidden">
                {confirmDelete && !isDeleting && (
                  <p className="mb-3 text-sm" style={{ color: 'var(--app-negative)' }}>
                    This will delete all historical data.
                  </p>
                )}
                {deleteError && (
                  <p className="mb-3 text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
                    {deleteError}
                  </p>
                )}
                <div className="flex gap-3">
                  <button type="button" className="app-primary-button flex-1" onClick={() => setEditOpen(true)}>
                    <Pencil size={16} aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`app-danger-button overflow-hidden whitespace-nowrap duration-300 ${isDeleting ? 'app-primary-button-loading shrink-0' : 'flex-1'}`}
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <div className="app-spinner" />
                    ) : (
                      <>
                        <Trash2 size={16} aria-hidden />
                        {confirmDelete ? 'Confirm' : 'Delete'}
                      </>
                    )}
                  </button>
                </div>
              </section>
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
    </>
  )
}
