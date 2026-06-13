
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type UIEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { Pencil, Trash2, X } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { useBudgetUtilizations, useDeleteBaseBudget, type BaseBudget, type Budget, type BudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'
import BudgetChartTooltip, { type BudgetChartPoint } from '@/budgets/components/budget-details-modal/BudgetChartTooltip'
import BudgetEditModal from '@/budgets/components/budget-form/BudgetEditModal'
import AttentionIcon from '@/budgets/components/shared/AttentionIcon'
import BudgetFxStatusTooltip from '@/budgets/components/shared/BudgetFxStatusTooltip'
import MarqueeText from '@/components/MarqueeText'
import ScrollableListMoreButton from '@/components/ScrollableListMoreButton'
import { DELETE_BUDGET_MIN_LOADING_MS, EASE, MODAL_SURFACE_TRANSITION_MS, MODAL_SURFACE_TRANSITION_SECONDS } from '@/budgets/constants'
import { budgetCadenceLabel, formatBudgetPeriod } from '@/budgets/utils/budgetPeriods'
import { attentionState } from '@/budgets/utils/budgetStatus'
import { getHistoricalBudgetUtilizationFxStatusMessage } from '@/budgets/utils/fxTooltipMessages'
import {
  BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH,
  BUDGET_CHART_LAYOUT,
  getBudgetChartCategories,
  getBudgetChartGuideMaxWidth,
  getBudgetDetailsChartData,
  getBudgetPeriodHistory,
  getBudgetUtilizationByBudgetId,
  getBudgetUtilizationPercent,
  getLatestBudgetCategories,
  getSortedBudgetPeriods,
} from '@/budgets/utils/budgetDetails'
import { combineFxStatuses } from '@/utils/fxStatus'

const CHART_INITIAL_DIMENSION = { width: 1, height: 192 }

function getBudgetChartTooltipKey(point: BudgetChartPoint) {
  return point.label
}

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
  const trackedCategoryListRef = useRef<HTMLDivElement | null>(null)
  const budgetChartRef = useRef<HTMLDivElement>(null)
  const budgetChartTooltipRef = useRef<DeferredChartTooltipOverlayHandle<BudgetChartPoint>>(null)
  const [historyCanScroll, setHistoryCanScroll] = useState(false)
  const [trackedCategoryListScrollable, setTrackedCategoryListScrollable] = useState(false)
  const [trackedCategoryListAtBottom, setTrackedCategoryListAtBottom] = useState(false)
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
  const utilizationPct = latestPeriod ? Math.round(getBudgetUtilizationPercent(spent, limit)) : null
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
  const showTrackedCategoryListMoreIndicator = trackedCategoryListScrollable && !trackedCategoryListAtBottom
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
  const syncTrackedCategoryListState = useCallback(() => {
    const list = trackedCategoryListRef.current
    if (!list) return
    const isScrollable = list.scrollHeight > list.clientHeight + 4
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
    setTrackedCategoryListScrollable(isScrollable)
    setTrackedCategoryListAtBottom(!isScrollable || atBottom)
  }, [])

  useEffect(() => {
    syncHistoryScrollState()
    window.addEventListener('resize', syncHistoryScrollState)
    return () => window.removeEventListener('resize', syncHistoryScrollState)
  }, [syncHistoryScrollState])

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncTrackedCategoryListState)
    window.addEventListener('resize', syncTrackedCategoryListState)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', syncTrackedCategoryListState)
    }
  }, [baseBudget.id, latestCategories.length, syncTrackedCategoryListState])

  const handleTrackedCategoryListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const isScrollable = target.scrollHeight > target.clientHeight + 4
    const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 4
    setTrackedCategoryListScrollable(isScrollable)
    setTrackedCategoryListAtBottom(!isScrollable || atBottom)
  }

  const handleTrackedCategoryListMoreClick = () => {
    setTrackedCategoryListAtBottom(false)
    window.requestAnimationFrame(() => {
      const list = trackedCategoryListRef.current
      if (!list) return
      list.scrollBy({ top: list.clientHeight * 0.45, behavior: 'smooth' })
    })
  }
  const showBudgetChartTooltip = (
    state: RechartsTooltipState<BudgetChartPoint>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    const point = getRechartsTooltipPoint({
      state,
      data: chartData,
      resolveLabel: (label) => chartData.find((item) => item.label === label),
    })
    const pointer = getRechartsTooltipPointer(state, event)

    if (!point) {
      budgetChartTooltipRef.current?.show(null, pointer)
      return
    }

    budgetChartTooltipRef.current?.show(point, pointer)
  }
  const hideBudgetChartTooltip = () => budgetChartTooltipRef.current?.hide()

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
            <aside
              className="sticky top-0 z-10 flex shrink-0 flex-col gap-5 p-5 min-[750px]:gap-7 min-[750px]:p-7 min-[1050px]:static min-[1050px]:z-auto min-[1050px]:h-full min-[1050px]:min-h-0 min-[1050px]:shrink min-[1050px]:overflow-hidden"
              style={{ background: 'var(--app-accent-soft)', color: 'var(--app-text)' }}
            >
              <header className="relative shrink-0">
                <div className="min-w-0 w-full">
                  <h2 className="pr-11 text-2xl font-semibold min-[1050px]:pr-0">
                    <MarqueeText active>{baseBudget.name}</MarqueeText>
                  </h2>
                  <span
                    className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium"
                    style={{ background: attention.background, color: attention.textColor }}
                  >
                    <AttentionIcon label={attention.label} />
                    {attention.label}
                  </span>
                  <p className="mt-2 min-w-0 truncate text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                    {budgetCadenceLabel(baseBudget)} · {baseBudget.group_id ? 'Shared' : 'Personal'} · {baseBudget.currency}
                  </p>
                </div>
                <button type="button" className="app-icon-button absolute right-0 top-0 shrink-0 min-[1050px]:hidden" aria-label="Close budget details" onClick={onClose}>
                  <X size={20} aria-hidden />
                </button>
              </header>

              <section className="shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
                      Current budget
                    </p>
                    <BudgetFxStatusTooltip
                      fxStatus={latestUtilization?.fx_status}
                      label="Current budget FX status"
                    />
                  </div>
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
                        style={{ width: `${Math.min(Math.max(getBudgetUtilizationPercent(spent, limit), 0), 100)}%`, background: attention.indicatorColor }}
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

              <section className="border-t pt-6 min-[1050px]:flex min-[1050px]:min-h-0 min-[1050px]:flex-1 min-[1050px]:flex-col" style={{ borderColor: 'var(--app-border)' }}>
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
                <div className="relative mt-3 min-[1050px]:min-h-0 min-[1050px]:flex-1">
                  <div
                    ref={trackedCategoryListRef}
                    className="max-h-[15rem] overflow-y-auto pr-2 min-[1050px]:h-full min-[1050px]:max-h-none"
                    onScroll={handleTrackedCategoryListScroll}
                  >
                    {latestCategories.length > 0 ? latestCategories.map((category) => (
                      <div
                        key={category.category_id}
                        className="flex items-center justify-between gap-3 py-2.5 text-sm"
                        style={{ borderTop: '1px solid var(--app-border)' }}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {showStackedCategoryChart && (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ background: categoryColorById.get(category.category_id) ?? 'var(--app-border-strong)' }}
                              aria-hidden
                            />
                          )}
                          <span className="truncate" style={{ color: 'var(--app-text-muted)' }}>{categoryById.get(category.category_id) ?? 'Uncategorized'}</span>
                        </span>
                        <span className="shrink-0 font-medium" style={{ color: 'var(--app-text)' }}>{formatCurrency(category.spent, baseBudget.currency)}</span>
                      </div>
                    )) : (
                      <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                        No category spending for the current period.
                      </p>
                    )}
                  </div>
                  <ScrollableListMoreButton
                    show={showTrackedCategoryListMoreIndicator}
                    onClick={handleTrackedCategoryListMoreClick}
                    ariaLabel="Scroll tracked categories down"
                  />
                </div>
              </section>

              <div className="shrink-0 min-[1050px]:mt-auto">
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
                <div
                  ref={budgetChartRef}
                  className="relative h-48 min-[750px]:h-80"
                  onMouseLeave={hideBudgetChartTooltip}
                >
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
                    <>
                      <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
                        <BarChart
                          data={chartData}
                          margin={BUDGET_CHART_LAYOUT.margin}
                          onMouseMove={(state, event) => showBudgetChartTooltip(state, event)}
                          onMouseLeave={hideBudgetChartTooltip}
                        >
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
                            width={BUDGET_CHART_LAYOUT.yAxisWidth}
                          />
                          {showStackedCategoryChart ? chartCategories.map((category, index) => (
                            <Bar
                              key={category.id}
                              dataKey={category.dataKey}
                              stackId="category-spending"
                              fill={category.color}
                              radius={index === chartCategories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                              barSize={28}
                              animationBegin={MODAL_SURFACE_TRANSITION_MS}
                            />
                          )) : (
                            <Bar
                              dataKey="utilizationPct"
                              fill="var(--app-accent)"
                              radius={[4, 4, 0, 0]}
                              barSize={28}
                              animationBegin={MODAL_SURFACE_TRANSITION_MS}
                            />
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                      <DeferredChartTooltipOverlay
                        ref={budgetChartTooltipRef}
                        chartRef={budgetChartRef}
                        className="min-w-44"
                        guideVariant="bar"
                        guideWidth={BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH}
                        guideMaxWidth={(chartWidth) => getBudgetChartGuideMaxWidth(chartWidth, chartData.length)}
                        getKey={getBudgetChartTooltipKey}
                        renderContent={(point) => (
                          <BudgetChartTooltip
                            point={point}
                            currency={baseBudget.currency}
                          />
                        )}
                      />
                    </>
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

              <section className="min-[1050px]:flex min-[1050px]:min-h-0 min-[1050px]:flex-1 min-[1050px]:flex-col">
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
                <div className="mt-3 hidden overflow-hidden min-[750px]:block min-[1050px]:min-h-0 min-[1050px]:flex-1 min-[1050px]:flex-col" style={{ borderTop: '1px solid var(--app-border)' }}>
                  <div className="max-h-[12rem] overflow-y-auto pr-3 min-[1050px]:h-full min-[1050px]:max-h-none min-[1050px]:min-h-0">
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
